import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import type { PaymentProvider } from "../billing/providers.js";
import type { ConversationStore } from "../conversation/store.js";
import { sql, sqlOne } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { orgIdOf, requireOrg, type SessionSigner, type SessionVariables } from "../lib/session.js";
import { parseJson } from "../lib/validate.js";

// Abonnement de l'artisan (ART-6, OFF-3) : offres de sa devise, paiement, confirmation.

export interface BillingDeps {
  pool: pg.Pool;
  signer: SessionSigner;
  providers: PaymentProvider[];
  apiUrl: string;
  webUrl: string;
  conversations: ConversationStore;
}

type Row = Record<string, any>;

export function registerBillingRoutes(app: Hono<{ Variables: SessionVariables }>, d: BillingDeps) {
  const auth = requireOrg(d.signer);
  const provider = (code: string) => d.providers.find((p) => p.code === code);
  const minorUnitsOf = async (currency: string) =>
    (await sqlOne<{ m: number }>(d.pool, "select minor_units as m from public.currencies where code = upper($1)", [currency])).m;

  app.get("/v1/billing", auth, async (c) => {
    const org = orgIdOf(c.get("session"));
    const o = await sqlOne<Row>(d.pool, "select locale, currency_code, email, name from public.organizations where id = $1", [org]);
    const [plans, providers, payments, ent] = await Promise.all([
      sql<Row>(d.pool, `select code, app.label(labels, $2) as label, price_minor::text as price_minor, quota, period_days
                        from public.plans where active and currency_code = $1 order by price_minor`, [o.currency_code, o.locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, simulated from public.payment_providers where enabled order by position", [o.locale]),
      sql<Row>(d.pool, `select p.id, p.reference, p.status, p.amount_minor::text as amount_minor, p.provider_code, p.created_at, p.settled_at,
                               app.label(pl.labels, $2) as plan_label
                        from public.subscription_payments p join public.plans pl on pl.id = p.plan_id
                        where p.org_id = $1 order by p.created_at desc limit 30`, [org, o.locale]),
      sql<Row>(d.pool, "select * from app.entitlement($1)", [org]),
    ]);
    const e = ent[0];
    return c.json({
      email: o.email,
      entitlement: e ? { kind: e.kind, quota: e.quota, used: e.used, remaining: e.remaining, periodEnd: e.period_end?.toISOString?.() ?? null, planCode: e.plan_code } : null,
      plans: plans.map((p) => ({ code: p.code, label: p.label, priceMinor: p.price_minor, quota: p.quota, periodDays: p.period_days })),
      // Un fournisseur n'est proposé que s'il est actif en base ET configuré dans l'API.
      providers: providers.filter((p) => provider(p.code)).map((p) => ({ code: p.code, label: p.label, simulated: p.simulated, needsEmail: provider(p.code)!.needsEmail })),
      payments: payments.map((p) => ({ id: p.id, reference: p.reference, status: p.status, amountMinor: p.amount_minor, provider: p.provider_code, plan: p.plan_label, createdAt: p.created_at.toISOString(), settledAt: p.settled_at?.toISOString?.() ?? null })),
    });
  });

  app.post("/v1/billing/checkout", auth, async (c) => {
    const org = orgIdOf(c.get("session"));
    const b = await parseJson(c, z.object({
      planCode: z.string().max(40),
      provider: z.string().max(40),
      email: z.string().email().max(200).nullable().optional(),
    }));
    const p = provider(b.provider);
    if (!p) throw httpErrors.validation({ provider: "moyen de paiement indisponible" });
    const idempotencyKey = c.req.header("idempotency-key") ?? randomUUID();
    const pay = await sqlOne<Row>(d.pool, "select * from app.start_subscription_payment($1, $2, $3, $4)", [org, b.planCode, b.provider, idempotencyKey]);
    if (pay.checkout_url) return c.json({ id: pay.id, checkoutUrl: pay.checkout_url });
    const o = await sqlOne<Row>(d.pool, "select name, email from public.organizations where id = $1", [org]);
    const email = b.email ?? o.email;
    if (p.needsEmail && !email) throw httpErrors.validation({ email: "e-mail requis pour ce moyen de paiement" });
    if (b.email && !o.email) await sql(d.pool, "update public.organizations set email = $2 where id = $1", [org, b.email]);
    const result = await p.initiate({
      paymentId: pay.id,
      reference: pay.reference,
      amountMinor: BigInt(pay.amount_minor),
      currencyCode: pay.currency_code,
      minorUnits: await minorUnitsOf(pay.currency_code),
      apiUrl: d.apiUrl,
      webUrl: d.webUrl,
      customer: { email: email ?? null, firstName: (o.name ?? "Firmo").slice(0, 60) },
    });
    await sql(d.pool, "select app.set_payment_checkout($1, $2, $3)", [pay.id, result.providerReference, result.checkoutUrl]);
    return c.json({ id: pay.id, checkoutUrl: result.checkoutUrl });
  });

  app.get("/v1/billing/payments/:id", auth, async (c) => {
    const org = orgIdOf(c.get("session"));
    const r = await sqlOne<Row>(d.pool, `select p.id, p.reference, p.status, p.amount_minor::text as amount_minor, p.currency_code, p.provider_code
                                          from public.subscription_payments p where p.id = $1 and p.org_id = $2`, [c.req.param("id"), org]);
    return c.json({ id: r.id, reference: r.reference, status: r.status, amountMinor: r.amount_minor, currencyCode: r.currency_code, provider: r.provider_code });
  });

  // Simulateur : l'artisan connecté choisit l'issue de son propre paiement (hors production).
  app.post("/v1/billing/simulator/:id", auth, async (c) => {
    if (!provider("simulator")) throw httpErrors.forbidden("simulateur désactivé");
    const org = orgIdOf(c.get("session"));
    const { outcome } = await parseJson(c, z.object({ outcome: z.enum(["succeeded", "failed", "cancelled"]) }));
    const pay = await sqlOne<Row>(d.pool, "select * from public.subscription_payments where id = $1 and org_id = $2 and provider_code = 'simulator'", [c.req.param("id"), org]);
    const status = await sqlOne<{ s: string }>(d.pool, "select app.settle_subscription_payment('simulator', $1, $2, $3, $4, $5) as s", [
      `sim:${pay.id}`, pay.id, outcome, pay.amount_minor, pay.currency_code,
    ]);
    await notifyChat(pay.org_id, outcome);
    return c.json({ result: status.s });
  });

  // Retour depuis la page du fournisseur : vers l'espace artisan (le webhook fait foi).
  app.get("/v1/billing/return/:id", (c) => c.redirect(`${d.webUrl.replace(/\/$/, "")}/app/abonnement?paiement=${encodeURIComponent(c.req.param("id"))}`));

  app.post("/v1/billing/webhooks/:provider", async (c) => {
    const p = provider(c.req.param("provider"));
    if (!p || p.code === "simulator") throw httpErrors.notFound();
    const raw = await c.req.text();
    const headers = Object.fromEntries([...c.req.raw.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    const valid = p.verifyWebhook(raw, headers);
    await d.conversations.journal(`billing_${p.code}`, valid, raw);
    if (!valid) throw httpErrors.unauthenticated("signature invalide");
    const event = await p.resolve(raw, minorUnitsOf);
    if (!event) return c.json({ ok: true, applied: false });
    const status = await sqlOne<{ s: string }>(d.pool, "select app.settle_subscription_payment($1, $2, $3, $4, $5, $6) as s", [
      p.code, event.eventId, event.paymentId, event.outcome, event.amountMinor.toString(), event.currencyCode,
    ]);
    if (status.s === "applied") {
      const org = await sqlOne<{ org_id: string }>(d.pool, "select org_id from public.subscription_payments where id = $1", [event.paymentId]);
      await notifyChat(org.org_id, event.outcome);
    }
    return c.json({ ok: true, result: status.s });
  });

  /** Message dans le chat de l'artisan : abonnement actif (ou paiement échoué). */
  async function notifyChat(orgId: string, outcome: string) {
    await sql(d.pool, "select app.enqueue_job('notify_subscription', jsonb_build_object('org_id', $1::text, 'outcome', $2::text))", [orgId, outcome]).catch(() => undefined);
  }
}
