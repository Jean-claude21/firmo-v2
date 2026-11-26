import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import type { PaymentProvider } from "../billing/providers.js";
import type { ConversationStore } from "../conversation/store.js";
import { sql, sqlOne } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { orgIdOf, requireOrg, requireStaff, type SessionSigner, type SessionVariables, staffOf } from "../lib/session.js";
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
    const [plans, providers, payments, ent, topUp] = await Promise.all([
      sql<Row>(d.pool, `select code, app.label(labels, $2) as label, price_minor::text as price_minor, quota, period_days, grace_days
                        from public.plans where active and currency_code = $1 order by price_minor`, [o.currency_code, o.locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, simulated from public.payment_providers where enabled order by position", [o.locale]),
      sql<Row>(d.pool, `select p.id, p.reference, p.status, p.amount_minor::text as amount_minor, p.provider_code, p.created_at, p.settled_at,
                               app.label(pl.labels, $2) as plan_label
                        from public.subscription_payments p join public.plans pl on pl.id = p.plan_id
                        where p.org_id = $1 order by p.created_at desc limit 30`, [org, o.locale]),
      sql<Row>(d.pool, "select * from app.entitlement($1)", [org]),
      // Recharge proposée : offre de la période payée en cours (non échue), si son prix est fixé.
      sql<Row>(d.pool, `select p.top_up_documents, p.top_up_price_minor::text as top_up_price_minor
                        from (select (app.current_subscription($1)).*) s join public.plans p on p.id = s.plan_id
                        where s.kind = 'paid' and s.period_end > now()
                          and p.top_up_price_minor is not null and p.top_up_documents is not null`, [org]),
    ]);
    // Conditions affichées : rappel avant la fin, grâce et fin de grâce de la période en cours.
    const cond = await sqlOne<Row>(d.pool, `select coalesce((app.setting('subscription_warn_days') #>> '{}')::int, 3) as warn_days,
        p.grace_days, s.period_end + make_interval(days => coalesce(p.grace_days, 0)) as grace_end
      from (select 1) one
      left join lateral (select (app.current_subscription($1)).*) s on true
      left join public.plans p on p.id = s.plan_id`, [org]);
    const e = ent[0];
    return c.json({
      email: o.email,
      entitlement: e ? { kind: e.kind, quota: e.quota, used: e.used, remaining: e.remaining, periodEnd: e.period_end?.toISOString?.() ?? null, planCode: e.plan_code } : null,
      plans: plans.map((p) => ({ code: p.code, label: p.label, priceMinor: p.price_minor, quota: p.quota, periodDays: p.period_days, graceDays: p.grace_days })),
      topUp: topUp[0] ? { documents: topUp[0].top_up_documents, priceMinor: topUp[0].top_up_price_minor } : null,
      conditions: {
        warnDays: Number(cond.warn_days),
        graceDays: Number(cond.grace_days ?? plans[0]?.grace_days ?? 0),
        // Période échue mais encore ouverte : jusqu'à la fin de la grâce, puis plus de document final.
        inGrace: Boolean(e?.period_end && new Date(e.period_end) <= new Date()),
        graceEnd: e?.period_end && cond.grace_end ? cond.grace_end.toISOString() : null,
      },
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
      // Recharge : des documents en plus sur la période payée en cours (P-52).
      kind: z.enum(["subscription", "top_up"]).default("subscription"),
    }));
    const p = provider(b.provider);
    if (!p) throw httpErrors.validation({ provider: "moyen de paiement indisponible" });
    const idempotencyKey = c.req.header("idempotency-key") ?? randomUUID();
    const pay = await sqlOne<Row>(d.pool, "select * from app.start_subscription_payment($1, $2, $3, $4, $5)", [org, b.planCode, b.provider, idempotencyKey, b.kind]);
    if (pay.checkout_url) return c.json({ id: pay.id, checkoutUrl: pay.checkout_url });
    // Téléphone : celui de l'organisation, sinon celui de son identité de messagerie.
    const o = await sqlOne<Row>(d.pool, `select o.name, o.email, o.country_code, pl.provider_products,
                                                coalesce(o.phone, (select ci.phone from public.channel_identities ci
                                                                   where ci.org_id = o.id and ci.phone is not null
                                                                   order by ci.created_at limit 1)) as phone
                                         from public.organizations o, public.plans pl where o.id = $1 and pl.id = $2`, [org, pay.plan_id]);
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
      // Téléphone et pays pré-remplis chez le fournisseur qui les accepte (v1, Chariow).
      customer: { email: email ?? null, firstName: (o.name ?? "Firmo").slice(0, 60), phone: o.phone ?? null, countryCode: o.country_code ?? null },
      products: o.provider_products ?? {},
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
    const event = await p.resolve(raw, minorUnitsOf, headers);
    if (!event) return c.json({ ok: true, applied: false });
    // La vente doit être celle de ce paiement, pour le produit de son offre (v1) : sinon rien n'est appliqué.
    const expected = await sqlOne<Row>(d.pool, `select p.provider_reference, pl.provider_products ->> $2 as product
      from public.subscription_payments p join public.plans pl on pl.id = p.plan_id where p.id = $1`, [event.paymentId, p.code]).catch(() => null);
    if (expected && ((event.providerReference && expected.provider_reference && event.providerReference !== expected.provider_reference)
      || (event.productId && expected.product && event.productId !== expected.product))) {
      return c.json({ ok: true, applied: false, result: "mismatch" });
    }
    const status = await sqlOne<{ s: string }>(d.pool, "select app.settle_subscription_payment($1, $2, $3, $4, $5, $6) as s", [
      p.code, event.eventId, event.paymentId, event.outcome, event.amountMinor.toString(), event.currencyCode,
    ]);
    // Le message à l'artisan est mis en file par la confirmation elle-même (P-57).
    return c.json({ ok: true, result: status.s });
  });

  // Rapprochement par l'équipe (P-56) : un paiement resté en attente est relu chez le fournisseur ;
  // seul ce que le fournisseur confirme est appliqué, une fois, avec le motif au journal.
  const admin = requireStaff(d.signer, ["admin"]);
  app.post("/v1/admin/payments/:id/reconcile", admin, async (c) => {
    const staff = staffOf(c.get("session")).userId;
    const { reason } = await parseJson(c, z.object({ reason: z.string().trim().min(3).max(500) }));
    const pay = await sqlOne<Row>(d.pool, "select id, provider_code, provider_reference from public.subscription_payments where id = $1", [c.req.param("id")]);
    const p = provider(pay.provider_code);
    if (!p?.lookup || !pay.provider_reference) throw httpErrors.validation({ provider: "ce fournisseur ne permet pas de relire une vente" });
    const sale = await p.lookup(pay.provider_reference, minorUnitsOf);
    if (!sale?.outcome) return c.json({ result: "not_settled", outcome: null });
    const status = await sqlOne<{ s: string }>(d.pool, "select app.reconcile_payment($1, $2, $3, $4, $5, $6) as s", [
      staff, pay.id, sale.outcome, sale.amountMinor.toString(), sale.currencyCode, reason,
    ]);
    return c.json({ result: status.s, outcome: sale.outcome });
  });
}
