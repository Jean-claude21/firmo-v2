import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import { sql, sqlOne } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { requireStaff, type SessionSigner, type SessionVariables, staffOf } from "../lib/session.js";
import { parseJson, parseQuery } from "../lib/validate.js";

// Console d'administration (ADM-1 à ADM-7). Lecture : admin et support ; écriture : admin
// (vérifié aussi en SQL par app.require_staff), toujours auditée.

export interface AdminDeps {
  pool: pg.Pool;
  signer: SessionSigner;
  env: string;
  /** Base Neon Auth (…/neondb/auth) ; vide : connexion de développement locale seulement. */
  neonAuthUrl: string;
  /** Origine envoyée à Neon Auth (doit y être autorisée). */
  webUrl: string;
}

type Row = Record<string, any>;

/** Vérifie e-mail et mot de passe auprès de Neon Auth ; renvoie l'identifiant du compte. */
async function neonAuthSignIn(base: string, origin: string, email: string, password: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/sign-in/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(origin).origin },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw httpErrors.unavailable("service d'identité injoignable");
  }
  if (res.status === 401 || res.status === 400 || res.status === 403) throw httpErrors.unauthenticated("e-mail ou mot de passe incorrect");
  if (!res.ok) throw httpErrors.unavailable(`service d'identité : HTTP ${res.status}`);
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw httpErrors.unauthenticated("e-mail ou mot de passe incorrect");
  return body.user.id;
}

export function registerAdminRoutes(app: Hono<{ Variables: SessionVariables }>, d: AdminDeps) {
  const staff = requireStaff(d.signer);
  const admin = requireStaff(d.signer, ["admin"]);
  const actor = (c: { get(k: "session"): SessionVariables["session"] }) => staffOf(c.get("session")).userId;

  // ------------------------------------------------------------- session
  app.post("/v1/admin/session", async (c) => {
    const { email, password } = await parseJson(c, z.object({ email: z.string().email().max(200), password: z.string().max(200).default("") }));
    let userId: string;
    if (d.neonAuthUrl) {
      userId = await neonAuthSignIn(d.neonAuthUrl, d.webUrl, email, password);
    } else if (d.env === "local") {
      // Développement local sans Neon Auth : l'e-mail d'un membre suffit (jamais en ligne).
      const r = await sql<{ id: string }>(d.pool, 'select id::text from neon_auth."user" where lower(email) = lower($1)', [email]);
      if (!r[0]) throw httpErrors.unauthenticated("compte inconnu");
      userId = r[0].id;
    } else {
      throw httpErrors.unavailable("connexion de l'équipe non configurée");
    }
    const member = await sql<{ role: "admin" | "support"; email: string }>(d.pool, "select role, email from public.staff where user_id = $1", [userId]);
    if (!member[0]) throw httpErrors.forbidden("ce compte ne fait pas partie de l'équipe Firmo");
    const hours = (await sqlOne<{ h: number }>(d.pool, "select (app.setting('staff_session_hours') #>> '{}')::int as h")).h;
    const token = await d.signer.sign({ scope: "staff", userId, role: member[0].role, email: member[0].email }, hours * 3600);
    return c.json({ token, expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(), role: member[0].role, email: member[0].email });
  });

  app.get("/v1/admin/me", staff, (c) => {
    const s = staffOf(c.get("session"));
    return c.json({ email: s.email, role: s.role, env: d.env });
  });

  // ------------------------------------------------------------- tableau de bord
  app.get("/v1/admin/dashboard", staff, async (c) => {
    const { days } = parseQuery(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
    const r = await sqlOne<{ v: unknown }>(d.pool, "select app.admin_dashboard($1) as v", [days]);
    const currencies = await sql<Row>(d.pool, "select code, minor_units, symbol, symbol_before, thousands_separator, decimal_separator from public.currencies");
    return c.json({ ...(r.v as object), currencies: Object.fromEntries(currencies.map((x) => [x.code, { code: x.code, minorUnits: x.minor_units, symbol: x.symbol, symbolBefore: x.symbol_before, thousandsSeparator: x.thousands_separator, decimalSeparator: x.decimal_separator }])) });
  });

  // ------------------------------------------------------------- organisations
  app.get("/v1/admin/organizations", staff, async (c) => {
    const q = parseQuery(c, z.object({ search: z.string().max(80).default(""), status: z.string().max(20).default(""), page: z.coerce.number().int().min(1).default(1) }));
    const values = [`%${q.search.toLowerCase()}%`, q.status, 25, (q.page - 1) * 25];
    const where = `where (lower(coalesce(o.name, '')) like $1 or exists (select 1 from public.channel_identities ci where ci.org_id = o.id and ci.external_id like $1))
                   and ($2 = '' or o.status = $2)`;
    const total = await sqlOne<{ n: string }>(d.pool, `select count(*)::text as n from public.organizations o ${where}`, values.slice(0, 2));
    const rows = await sql<Row>(d.pool, `
      select o.id, o.name, o.status, o.country_code, o.currency_code, o.created_at,
             (select count(*) from public.documents x where x.org_id = o.id and x.status <> 'draft') as documents,
             (select max(created_at) from public.messages m where m.org_id = o.id and m.direction = 'in') as last_message,
             (select string_agg(distinct channel, ',') from public.channel_identities ci where ci.org_id = o.id) as channels,
             (select kind from app.entitlement(o.id)) as plan
      from public.organizations o ${where} order by o.created_at desc limit $3 offset $4`, values);
    return c.json({
      total: Number(total.n),
      items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, country: r.country_code, currency: r.currency_code, createdAt: r.created_at.toISOString(), documents: Number(r.documents), lastMessage: r.last_message?.toISOString?.() ?? null, channels: r.channels?.split(",") ?? [], plan: r.plan })),
    });
  });

  app.get("/v1/admin/organizations/:id", staff, async (c) => {
    const id = c.req.param("id");
    const o = await sqlOne<Row>(d.pool, "select * from public.organizations where id = $1", [id]);
    const [identities, documents, messages, subscriptions, payments, stats] = await Promise.all([
      sql<Row>(d.pool, "select channel, display_name, created_at, last_seen_at from public.channel_identities where org_id = $1", [id]),
      sql<Row>(d.pool, `select d.id, d.type_code, d.status, d.number, d.total_minor::text as total_minor, d.created_at,
                               coalesce(d.client_snapshot ->> 'name', c.name) as client
                        from public.documents d left join public.clients c on c.id = d.client_id
                        where d.org_id = $1 order by d.created_at desc limit 20`, [id]),
      sql<Row>(d.pool, "select id, direction, kind, left(coalesce(transcript, text), 300) as text, status, error, created_at from public.messages where org_id = $1 order by created_at desc limit 30", [id]),
      sql<Row>(d.pool, "select kind, quota, used, period_start, period_end, ended_at from public.subscriptions where org_id = $1 order by created_at desc", [id]),
      sql<Row>(d.pool, "select id, reference, status, kind, amount_minor::text as amount_minor, currency_code, provider_code, provider_reference, created_at from public.subscription_payments where org_id = $1 order by created_at desc limit 10", [id]),
      sqlOne<{ v: unknown }>(d.pool, "select app.org_dashboard($1) as v", [id]),
    ]);
    return c.json({
      org: { id: o.id, name: o.name, status: o.status, country: o.country_code, currency: o.currency_code, locale: o.locale, trade: o.trade_code, phone: o.phone, email: o.email, template: o.template_code, createdAt: o.created_at.toISOString() },
      stats: stats.v,
      identities: identities.map((r) => ({ channel: r.channel, name: r.display_name, createdAt: r.created_at.toISOString(), lastSeenAt: r.last_seen_at.toISOString() })),
      documents: documents.map((r) => ({ id: r.id, type: r.type_code, status: r.status, number: r.number, totalMinor: r.total_minor, client: r.client, createdAt: r.created_at.toISOString() })),
      messages: messages.map((r) => ({ id: r.id, direction: r.direction, kind: r.kind, text: r.text, status: r.status, error: r.error, createdAt: r.created_at.toISOString() })),
      subscriptions: subscriptions.map((r) => ({ kind: r.kind, quota: r.quota, used: r.used, periodStart: r.period_start.toISOString(), periodEnd: r.period_end?.toISOString?.() ?? null, endedAt: r.ended_at?.toISOString?.() ?? null })),
      payments: payments.map((r) => ({ id: r.id, reference: r.reference, status: r.status, kind: r.kind, amountMinor: r.amount_minor, currency: r.currency_code, provider: r.provider_code, providerReference: r.provider_reference, createdAt: r.created_at.toISOString() })),
    });
  });

  app.post("/v1/admin/organizations/:id/status", admin, async (c) => {
    const { status } = await parseJson(c, z.object({ status: z.enum(["active", "suspended"]) }));
    await sql(d.pool, "select app.set_org_status($1, $2, $3)", [c.req.param("id"), status, actor(c)]);
    return c.json({ ok: true });
  });

  app.post("/v1/admin/organizations/:id/grant", admin, async (c) => {
    const { planCode } = await parseJson(c, z.object({ planCode: z.string().max(40) }));
    await sql(d.pool, "select app.grant_period($1, $2, $3)", [c.req.param("id"), planCode, actor(c)]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- conversations et tâches (ADM-4)
  app.get("/v1/admin/messages", staff, async (c) => {
    const q = parseQuery(c, z.object({ status: z.string().max(20).default(""), channel: z.string().max(20).default(""), page: z.coerce.number().int().min(1).default(1) }));
    const rows = await sql<Row>(d.pool, `
      select m.id, m.org_id, o.name as org_name, m.channel, m.direction, m.kind, left(coalesce(m.transcript, m.text), 400) as text,
             m.status, m.error, m.duration_ms, m.created_at, m.document_id
      from public.messages m join public.organizations o on o.id = m.org_id
      where ($1 = '' or m.status = $1) and ($2 = '' or m.channel = $2)
      order by m.created_at desc limit 50 offset $3`, [q.status, q.channel, (q.page - 1) * 50]);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, channel: r.channel, direction: r.direction, kind: r.kind, text: r.text, status: r.status, error: r.error, durationMs: r.duration_ms, documentId: r.document_id, createdAt: r.created_at.toISOString() })) });
  });

  app.get("/v1/admin/jobs", staff, async (c) => {
    const { status } = parseQuery(c, z.object({ status: z.enum(["pending", "running", "done", "failed"]).default("failed") }));
    const counts = await sql<{ status: string; n: string }>(d.pool, "select status, count(*)::text as n from public.jobs group by status");
    const rows = await sql<Row>(d.pool, "select id::text, kind, status, attempts, max_attempts, last_error, run_at, updated_at, payload from public.jobs where status = $1 order by updated_at desc limit 50", [status]);
    return c.json({
      counts: Object.fromEntries(counts.map((r) => [r.status, Number(r.n)])),
      items: rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, attempts: r.attempts, maxAttempts: r.max_attempts, lastError: r.last_error, runAt: r.run_at.toISOString(), updatedAt: r.updated_at.toISOString(), payload: r.payload })),
    });
  });

  app.post("/v1/admin/jobs/:id/retry", staff, async (c) => {
    await sql(d.pool, "select app.retry_job($1, $2)", [c.req.param("id"), actor(c)]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- configuration (ADM-5)
  const TABLES: Record<string, string> = {
    countries: "code", currencies: "code", trades: "code", units: "code", document_types: "code", templates: "code",
    channels: "code", ai_tasks: "task", feature_flags: "key", settings: "key", payment_providers: "code",
  };

  app.get("/v1/admin/config", staff, async (c) => {
    const out: Record<string, unknown> = {};
    for (const [table, key] of Object.entries(TABLES)) {
      out[table] = await sql(d.pool, `select * from public.${table} order by ${table === "units" || table === "trades" || table === "document_types" || table === "templates" || table === "payment_providers" ? "position" : key}`);
    }
    out.taxes = await sql(d.pool, "select * from public.taxes order by country_code, code");
    out.plans = await sql(d.pool, `select id, code, version, labels, currency_code, price_minor::text as price_minor, quota, period_days, active, created_at,
                                          grace_days, top_up_documents, top_up_price_minor::text as top_up_price_minor, provider_products
                                   from public.plans order by code, currency_code, version desc`);
    return c.json(out);
  });

  app.patch("/v1/admin/config/:table/:key", admin, async (c) => {
    const table = c.req.param("table");
    if (!(table in TABLES)) throw httpErrors.notFound("table inconnue");
    const patch = await parseJson(c, z.record(z.string(), z.unknown()));
    await sql(d.pool, "select app.admin_update_reference($1, $2, $3::jsonb, $4)", [table, c.req.param("key"), JSON.stringify(patch), actor(c)]);
    return c.json({ ok: true });
  });

  app.post("/v1/admin/plans", admin, async (c) => {
    const b = await parseJson(c, z.object({
      code: z.string().regex(/^[a-z0-9_]+$/).max(40),
      currency: z.string().regex(/^[A-Z]{3}$/),
      labels: z.record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(80)),
      priceMinor: z.string().regex(/^\d{1,15}$/),
      quota: z.number().int().min(1).max(100000),
      periodDays: z.number().int().min(1).max(366),
      // Spec 011 : grâce, recharge (taille et prix) et produits chez les fournisseurs ; absents, la
      // version précédente est reprise.
      graceDays: z.number().int().min(0).max(60).optional(),
      topUpDocuments: z.number().int().min(1).max(10000).optional(),
      topUpPriceMinor: z.string().regex(/^\d{1,15}$/).optional(),
      providerProducts: z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().min(1).max(80)).optional(),
    }));
    const r = await sqlOne<{ id: string }>(d.pool, "select app.publish_plan($1, $2, $3::jsonb, $4::bigint, $5, $6, $7, $8, $9, $10::bigint, $11::jsonb) as id", [
      b.code, b.currency, JSON.stringify(b.labels), b.priceMinor, b.quota, b.periodDays, actor(c),
      b.graceDays ?? null, b.topUpDocuments ?? null, b.topUpPriceMinor ?? null, b.providerProducts ? JSON.stringify(b.providerProducts) : null,
    ]);
    return c.json({ id: r.id }, 201);
  });

  app.post("/v1/admin/plans/:id/retire", admin, async (c) => {
    await sql(d.pool, "select app.retire_plan($1, $2)", [c.req.param("id"), actor(c)]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- équipe, journal, IA
  app.get("/v1/admin/staff", staff, async (c) => {
    const rows = await sql<Row>(d.pool, "select user_id, email, role, created_at from public.staff order by created_at");
    return c.json({ items: rows.map((r) => ({ userId: r.user_id, email: r.email, role: r.role, createdAt: r.created_at.toISOString() })) });
  });

  app.post("/v1/admin/staff", admin, async (c) => {
    const b = await parseJson(c, z.object({ email: z.string().email(), role: z.enum(["admin", "support"]) }));
    await sql(d.pool, "select app.grant_staff_by_email($1, $2, $3)", [b.email, b.role, actor(c)]);
    return c.json({ ok: true }, 201);
  });

  app.delete("/v1/admin/staff/:userId", admin, async (c) => {
    await sql(d.pool, "select app.revoke_staff($1, $2)", [c.req.param("userId"), actor(c)]);
    return c.json({ ok: true });
  });

  app.get("/v1/admin/audit", staff, async (c) => {
    const { page } = parseQuery(c, z.object({ page: z.coerce.number().int().min(1).default(1) }));
    const rows = await sql<Row>(d.pool, `
      select a.id, a.actor_type, coalesce(s.email, a.actor_id) as actor, a.action, a.entity, a.entity_id, a.before, a.after, a.created_at
      from public.audit_log a left join public.staff s on s.user_id::text = a.actor_id
      order by a.id desc limit 50 offset $1`, [(page - 1) * 50]);
    return c.json({ items: rows.map((r) => ({ id: Number(r.id), actorType: r.actor_type, actor: r.actor, action: r.action, entity: r.entity, entityId: r.entity_id, before: r.before, after: r.after, createdAt: r.created_at.toISOString() })) });
  });

  app.get("/v1/admin/ai", staff, async (c) => {
    const rows = await sql<Row>(d.pool, `
      select task, model, count(*) as calls, count(*) filter (where not ok) as failures,
             sum(cost_micro_usd)::text as cost, count(*) filter (where cost_micro_usd is null) as unknown_cost,
             round(avg(duration_ms)) as avg_ms, percentile_cont(0.95) within group (order by duration_ms) as p95_ms
      from public.ai_usage where created_at >= now() - interval '30 days' group by task, model order by task, model`);
    const docs = await sqlOne<{ n: string }>(d.pool, "select count(*)::text as n from public.documents where issued_at >= now() - interval '30 days' and type_code <> 'receipt'");
    return c.json({
      documents: Number(docs.n),
      items: rows.map((r) => ({ task: r.task, model: r.model, calls: Number(r.calls), failures: Number(r.failures), costMicroUsd: r.cost === null ? null : Number(r.cost), unknownCost: Number(r.unknown_cost), avgMs: Number(r.avg_ms), p95Ms: Math.round(Number(r.p95_ms)) })),
    });
  });
}
