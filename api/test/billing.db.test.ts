import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { monerooProvider, simulatorProvider } from "../src/billing/providers.js";
import { pgConversationStore } from "../src/conversation/store.js";
import { sessionSigner } from "../src/lib/session.js";
import { pgPortalSessionStore } from "../src/routes/portal-session.js";
import { registerBillingRoutes } from "../src/routes/billing.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

describe.skipIf(!hasDatabase)("abonnement", () => {
  const pool = testPool();
  const signer = sessionSigner("s".repeat(40));
  // Moneroo factice : page de paiement et vérification simulées par un faux serveur.
  const verified: Record<string, unknown> = {};
  // Identifiant Moneroo unique par exécution (la base de test locale garde les événements).
  const monId = `mon_${Date.now().toString(36)}`;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/payments/initialize")) {
      const body = JSON.parse(String(init?.body));
      verified.metadata = body.metadata;
      verified.amount = body.amount;
      return new Response(JSON.stringify({ data: { id: monId, checkout_url: `https://checkout.moneroo.test/${monId}` } }), { status: 201 });
    }
    if (url.includes("/verify")) {
      return new Response(JSON.stringify({ data: { status: "success", amount: verified.amount, currency: { code: "XOF" }, metadata: verified.metadata } }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const moneroo = monerooProvider({ secretKey: "sk", webhookSecret: "whsec", fetchImpl: fakeFetch });
  const app = createApp({
    env: "local",
    signer,
    allowedOrigins: [],
    health: { database: async () => true, worker: () => true },
    portalSessions: pgPortalSessionStore(pool),
    modules: [(a) => registerBillingRoutes(a, { pool, signer, providers: [moneroo, simulatorProvider()], apiUrl: "https://api.test", webUrl: "https://firmo.test", conversations: pgConversationStore(pool) })],
  });
  afterAll(() => pool.end());

  async function orgToken() {
    const r = await pool.query<{ org_id: string }>("select org_id from app.ensure_identity('simulator', $1, null, '+22890000000', null)", [uid("bill")]);
    await pool.query("update public.payment_providers set enabled = true where code = 'moneroo'");
    return { orgId: r.rows[0]!.org_id, token: await signer.sign({ scope: "org", orgId: r.rows[0]!.org_id }, 3600) };
  }
  const call = (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });

  it("simulateur : payer active l'abonnement", async () => {
    const { orgId, token } = await orgToken();
    const info = await (await call(token, "GET", "/v1/billing")).json();
    expect(info.plans[0].priceMinor).toBe("2000");
    const checkout = await (await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "simulator" })).json();
    expect(checkout.checkoutUrl).toBe(`https://firmo.test/paiement/simulateur/${checkout.id}`);
    const settle = await (await call(token, "POST", `/v1/billing/simulator/${checkout.id}`, { outcome: "succeeded" })).json();
    expect(settle.result).toBe("applied");
    const ent = await pool.query("select kind, quota from app.entitlement($1)", [orgId]);
    expect(ent.rows[0]).toMatchObject({ kind: "paid", quota: 30 });
  });

  it("Moneroo : e-mail exigé, webhook signé, relu chez Moneroo, appliqué une fois", async () => {
    const { orgId, token } = await orgToken();
    expect((await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "moneroo" })).status).toBe(422);
    const res = await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "moneroo", email: "artisan@example.test" }, { "Idempotency-Key": uid("k") });
    const checkout = await res.json();
    expect(checkout.checkoutUrl).toBe(`https://checkout.moneroo.test/${monId}`);
    expect(verified.amount).toBe(2000);

    const raw = JSON.stringify({ event: "payment.success", data: { id: monId } });
    const bad = await app.request("/v1/billing/webhooks/moneroo", { method: "POST", body: raw, headers: { "x-moneroo-signature": "faux" } });
    expect(bad.status).toBe(401);
    const sig = createHmac("sha256", "whsec").update(raw).digest("hex");
    const ok = await (await app.request("/v1/billing/webhooks/moneroo", { method: "POST", body: raw, headers: { "x-moneroo-signature": sig } })).json();
    expect(ok.result).toBe("applied");
    const again = await (await app.request("/v1/billing/webhooks/moneroo", { method: "POST", body: raw, headers: { "x-moneroo-signature": sig } })).json();
    expect(again.result).toBe("duplicate");
    const ent = await pool.query("select kind from app.entitlement($1)", [orgId]);
    expect(ent.rows[0].kind).toBe("paid");
    await pool.query("update public.payment_providers set enabled = false where code = 'moneroo'");
  });
});
