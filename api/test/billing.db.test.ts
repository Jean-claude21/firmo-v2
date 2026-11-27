import { createHmac } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { chariowProvider, monerooProvider, simulatorProvider } from "../src/billing/providers.js";
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
  // Chariow factice : passage en caisse, puis vente relue (statut, montant, devise, produit).
  const sales: Record<string, { status: string; value: number; product: string; metadata?: unknown; phone?: unknown }> = {};
  const chariowFetch = (async (url: string, init?: RequestInit) => {
    if (url.endsWith("/checkout")) {
      const body = JSON.parse(String(init?.body));
      const id = `sal_${Object.keys(sales).length}_${Date.now().toString(36)}`;
      sales[id] = { status: "pending", value: 2000, product: body.product_id, metadata: body.custom_metadata, phone: body.phone };
      return new Response(JSON.stringify({ data: { step: "payment", purchase: { id }, payment: { checkout_url: `https://pay.chariow.test/${id}` } } }), { status: 201 });
    }
    const m = /\/sales\/([^/]+)$/.exec(url);
    if (m && sales[m[1]!]) {
      const sale = sales[m[1]!]!;
      return new Response(JSON.stringify({ data: { id: m[1], status: sale.status, amount: { value: sale.value, currency: "XOF" }, product: { id: sale.product } } }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  const chariow = chariowProvider({ apiKey: "ck", webhookSecret: "pulse", apiUrl: "https://api.chariow.test/v1", fetchImpl: chariowFetch });
  const app = createApp({
    env: "local",
    signer,
    allowedOrigins: [],
    health: { database: async () => true, worker: () => true },
    portalSessions: pgPortalSessionStore(pool),
    modules: [(a) => registerBillingRoutes(a, { pool, signer, providers: [moneroo, chariow, simulatorProvider()], apiUrl: "https://api.test", webUrl: "https://firmo.test", conversations: pgConversationStore(pool) })],
  });
  // Les fournisseurs activés par ces tests sont remis comme ils étaient (la base locale est partagée).
  afterAll(async () => {
    await pool.query("update public.payment_providers set enabled = false where code in ('moneroo', 'chariow')");
    await pool.end();
  });

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
    expect(ent.rows[0]).toMatchObject({ kind: "paid", quota: 15 });
    // P-57 : le message à l'artisan est en file avec le paiement.
    const jobs = await pool.query("select count(*)::int as n from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = $1", [checkout.id]);
    expect(jobs.rows[0].n).toBe(1);
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

  it("recharge : proposée seulement avec un prix, ajoutée à la période en cours", async () => {
    const { orgId, token } = await orgToken();
    const pay = await (await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "simulator" })).json();
    await call(token, "POST", `/v1/billing/simulator/${pay.id}`, { outcome: "succeeded" });
    let info = await (await call(token, "GET", "/v1/billing")).json();
    expect(info.topUp).toBeNull();
    expect(info.conditions).toMatchObject({ warnDays: 3, graceDays: 3, inGrace: false });
    await pool.query("update public.plans set top_up_price_minor = 1000 where code = 'standard' and currency_code = 'XOF' and active");
    try {
      info = await (await call(token, "GET", "/v1/billing")).json();
      expect(info.topUp).toEqual({ documents: 10, priceMinor: "1000" });
      const top = await (await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "simulator", kind: "top_up" }, { "Idempotency-Key": uid("k") })).json();
      expect((await (await call(token, "POST", `/v1/billing/simulator/${top.id}`, { outcome: "succeeded" })).json()).result).toBe("applied");
      const ent = await pool.query("select quota from app.entitlement($1)", [orgId]);
      expect(ent.rows[0].quota).toBe(25);
    } finally {
      await pool.query("update public.plans set top_up_price_minor = null where code = 'standard' and currency_code = 'XOF' and active");
    }
  });

  it("Chariow : produit, téléphone et pays pré-remplis, avis signé, vente relue, rapprochement", async () => {
    const { orgId, token } = await orgToken();
    await pool.query("update public.payment_providers set enabled = true where code = 'chariow'");
    try {
      const checkout = await (await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "chariow", email: "artisan@example.test" })).json();
      const saleId = checkout.checkoutUrl.split("/").at(-1);
      expect(sales[saleId]).toMatchObject({ product: "prd_s1bcdqkm", phone: { number: "+22890000000", country_code: "TG" } });

      const event = (id: string, payment: string) => JSON.stringify({ event: "successful.sale", sale: { id, custom_metadata: { firmo_payment_id: payment } } });
      const sign = (raw: string) => `sha256=${createHmac("sha256", "pulse").update(raw).digest("hex")}`;
      const hook = (raw: string, headers: Record<string, string>) => app.request("/v1/billing/webhooks/chariow", { method: "POST", body: raw, headers });
      const raw = event(saleId, checkout.id);
      expect((await hook(raw, { "x-chariow-signature": "sha256=faux", "x-pulse-event": "successful.sale" })).status).toBe(401);
      // L'événement annoncé en en-tête doit être celui du corps.
      expect((await hook(raw, { "x-chariow-signature": sign(raw), "x-pulse-event": "failed.sale" })).status).toBe(401);
      // Vente encore en attente chez Chariow : rien n'est appliqué.
      expect((await (await hook(raw, { "x-chariow-signature": sign(raw), "x-pulse-event": "successful.sale" })).json()).applied).toBe(false);
      sales[saleId]!.status = "completed";
      const delivery = uid("dl");
      const ok = await (await hook(raw, { "x-chariow-signature": sign(raw), "x-pulse-event": "successful.sale", "x-pulse-delivery-id": delivery })).json();
      expect(ok.result).toBe("applied");
      const again = await (await hook(raw, { "x-chariow-signature": sign(raw), "x-pulse-event": "successful.sale", "x-pulse-delivery-id": delivery })).json();
      expect(again.result).toBe("duplicate");
      expect((await pool.query("select kind from app.entitlement($1)", [orgId])).rows[0].kind).toBe("paid");

      // Avis d'une autre vente pour un autre paiement : refusé.
      const second = await (await call(token, "POST", "/v1/billing/checkout", { planCode: "standard", provider: "chariow", email: "artisan@example.test" }, { "Idempotency-Key": uid("k") })).json();
      const secondSale = second.checkoutUrl.split("/").at(-1);
      sales["sal_autre"] = { status: "completed", value: 2000, product: "prd_s1bcdqkm" };
      const other = event("sal_autre", second.id);
      expect((await (await hook(other, { "x-chariow-signature": sign(other), "x-pulse-event": "successful.sale" })).json()).result).toBe("mismatch");

      // Rapprochement : l'avis n'est jamais arrivé, l'équipe relit la vente chez Chariow.
      const email = `${uid("adm")}@firmo.test`;
      const user = (await pool.query(`insert into neon_auth."user" (name, email, "emailVerified") values ('a', $1, true) returning id`, [email])).rows[0].id;
      await pool.query("insert into public.staff (user_id, email, role) values ($1, $2, 'admin')", [user, email]);
      const staffToken = await signer.sign({ scope: "staff", userId: user, role: "admin", email }, 3600);
      const reconcile = (t: string, reason: string) => call(t, "POST", `/v1/admin/payments/${second.id}/reconcile`, { reason });
      expect((await (await reconcile(staffToken, "avis jamais reçu")).json()).result).toBe("not_settled");
      sales[secondSale]!.status = "completed";
      expect((await (await reconcile(staffToken, "avis jamais reçu, vente vue chez Chariow")).json()).result).toBe("applied");
      expect((await reconcile(token, "artisan")).status).toBe(403);
    } finally {
      await pool.query("update public.payment_providers set enabled = false where code = 'chariow'");
    }
  });
});
