import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import { sql, sqlOne } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { requireStaff, type SessionSigner, type SessionVariables, staffOf, tokenHash } from "../lib/session.js";
import { parseJson, parseQuery } from "../lib/validate.js";

// Console au niveau de la v1 (spec 013, PARITE_V1 §6) : centre de commande, incidents, support,
// listes, recherche, pilotage. Les montants des documents d'un artisan sont masqués tant qu'un
// membre n'a pas donné de motif (P-74) ; toute écriture passe par une règle SQL auditée.

export interface AdminV1Deps {
  pool: pg.Pool;
  signer: SessionSigner;
  webUrl: string;
  /** Lien d'accès à l'espace d'une organisation (support). */
  portalLink: (orgId: string) => Promise<{ token: string; minutes: number }>;
  /** Stockage : médias et logo effacés après une suppression (P-83). */
  files: { delete(key: string): Promise<void> };
}

type Row = Record<string, any>;
const iso = (v: Date | null | undefined) => (v ? v.toISOString() : null);

export function registerAdminV1Routes(app: Hono<{ Variables: SessionVariables }>, d: AdminV1Deps) {
  const staff = requireStaff(d.signer);
  const admin = requireStaff(d.signer, ["admin"]);
  const actor = (c: { get(k: "session"): SessionVariables["session"] }) => staffOf(c.get("session")).userId;
  const reason = z.string().trim().min(5).max(500);

  /** Organisations dont ce membre voit les montants en ce moment. */
  async function revealed(staffId: string, orgIds: string[]): Promise<Set<string>> {
    if (!orgIds.length) return new Set();
    const rows = await sql<{ org_id: string }>(d.pool, "select distinct org_id from public.price_reveals where staff_user_id = $1 and org_id = any($2::uuid[]) and expires_at > now()", [staffId, orgIds]);
    return new Set(rows.map((r) => r.org_id));
  }

  // ------------------------------------------------------------- P-76 session par lien du chat
  app.post("/v1/admin/session/link", async (c) => {
    const { token } = await parseJson(c, z.object({ token: z.string().min(16).max(128) }));
    let userId: string;
    try {
      userId = (await sqlOne<{ id: string }>(d.pool, "select app.consume_admin_link($1)::text as id", [tokenHash(token)])).id;
    } catch {
      throw httpErrors.notFound("lien invalide, expiré ou déjà utilisé");
    }
    const member = await sqlOne<{ role: "admin" | "support"; email: string }>(d.pool, "select role, email from public.staff where user_id = $1", [userId]);
    const hours = (await sqlOne<{ h: number }>(d.pool, "select (app.setting('staff_session_hours') #>> '{}')::int as h")).h;
    const session = await d.signer.sign({ scope: "staff", userId, role: member.role, email: member.email }, hours * 3600);
    return c.json({ token: session, expiresAt: new Date(Date.now() + hours * 3_600_000).toISOString(), role: member.role, email: member.email });
  });

  // ------------------------------------------------------------- P-70 centre de commande
  app.get("/v1/admin/command", staff, async (c) => {
    const { kind } = parseQuery(c, z.object({ kind: z.enum(["all", "audio", "image", "pdf"]).default("all") }));
    const [kpi, queue, services, events, incident] = await Promise.all([
      sqlOne<Row>(d.pool, `select
          -- En cours : tâches lancées ou dues ; les rappels programmés plus tard ne comptent pas.
          (select count(*) from public.jobs where status = 'running' or (status = 'pending' and run_at <= now()))::int as in_progress,
          (select count(*) filter (where kind = 'process_message') from public.jobs where status = 'running' or (status = 'pending' and run_at <= now()))::int as in_progress_messages,
          (select count(*) filter (where kind = 'render_document') from public.jobs where status = 'running' or (status = 'pending' and run_at <= now()))::int as in_progress_pdf,
          (select count(*) from app.open_incidents)::int as incidents,
          (select count(*) from public.webhook_events where received_at > now() - interval '24 hours')::int as webhooks,
          (select count(*) filter (where signature_valid and error is null) from public.webhook_events where received_at > now() - interval '24 hours')::int as webhooks_ok,
          (select percentile_disc(0.95) within group (order by duration_ms) from public.document_renders where created_at > now() - interval '24 hours') as pdf_p95,
          (select count(*) from public.document_renders where created_at > now() - interval '24 hours')::int as pdf_count`),
      sql<Row>(d.pool, `
        select * from (
          select m.created_at as at, m.channel, o.name as org_name, m.org_id,
                 case m.kind when 'audio' then 'audio' when 'image' then 'image' else 'text' end as op,
                 m.status, m.duration_ms, m.id::text as ref, 'message' as ref_type,
                 (select attempts from public.jobs j where j.payload ->> 'message_id' = m.id::text order by j.id desc limit 1) as attempts
          from public.messages m join public.organizations o on o.id = m.org_id
          where m.direction = 'in' and m.created_at > now() - interval '24 hours'
          union all
          select r.created_at, null, o.name, d.org_id, 'pdf', 'processed', r.duration_ms, d.id::text, 'document', null
          from public.document_renders r join public.documents d on d.id = r.document_id join public.organizations o on o.id = d.org_id
          where r.created_at > now() - interval '24 hours'
        ) q where ($1 = 'all' or (op = $1)) order by at desc limit 40`, [kind]),
      sql<Row>(d.pool, `
        select 'channel:' || c.code as id, c.code as label, c.enabled,
               greatest((select max(received_at) from public.webhook_events w where w.source = c.code),
                        (select max(created_at) from public.messages m where m.channel = c.code and m.direction = 'in')) as last_at,
               (select count(*) from public.messages m where m.channel = c.code and m.direction = 'in' and m.created_at > now() - interval '1 hour')::int as volume
        from public.channels c
        union all
        select 'ai:' || task, task, true, max(created_at), count(*) filter (where created_at > now() - interval '1 hour')::int
        from public.ai_usage group by task
        union all
        select 'render', 'typst', true, max(created_at), count(*) filter (where created_at > now() - interval '1 hour')::int
        from public.document_renders`),
      sql<Row>(d.pool, `select e.name, e.created_at, o.name as org_name, e.props from public.analytics_events e left join public.organizations o on o.id = e.org_id order by e.id desc limit 12`),
      sql<Row>(d.pool, `select i.*, o.name as org_name from app.open_incidents i left join public.organizations o on o.id = i.org_id order by i.created_at desc limit 1`),
    ]);
    const latency = await sql<Row>(d.pool, `select task, percentile_disc(0.5) within group (order by duration_ms) as p50, count(*) filter (where not ok)::int as failed, count(*)::int as calls
                                           from public.ai_usage where created_at > now() - interval '1 hour' group by task`);
    return c.json({
      kpi: {
        inProgress: kpi.in_progress, inProgressMessages: kpi.in_progress_messages, inProgressPdf: kpi.in_progress_pdf,
        incidents: kpi.incidents,
        webhookRate: kpi.webhooks ? Math.round((1000 * kpi.webhooks_ok) / kpi.webhooks) / 10 : null, webhooks: kpi.webhooks,
        pdfP95Ms: kpi.pdf_p95, pdfCount: kpi.pdf_count,
      },
      incident: incident[0] ? { type: incident[0].subject_type, id: incident[0].subject_id, orgName: incident[0].org_name, stage: incident[0].stage, error: incident[0].error, at: iso(incident[0].created_at) } : null,
      queue: queue.map((r) => ({ at: iso(r.at), channel: r.channel, orgName: r.org_name, orgId: r.org_id, op: r.op, status: r.status, durationMs: r.duration_ms, attempts: r.attempts, ref: r.ref, refType: r.ref_type })),
      services: services.map((r) => {
        const l = latency.find((x) => `ai:${x.task}` === r.id);
        return { id: r.id, label: r.label, enabled: r.enabled, lastAt: iso(r.last_at), volume: r.volume, p50Ms: l?.p50 ?? null, failed: l?.failed ?? 0 };
      }),
      // Événements récents : nom, organisation, jamais de contenu (les propriétés sont déjà sans donnée personnelle).
      events: events.map((r) => ({ name: r.name, at: iso(r.created_at), orgName: r.org_name, props: r.props })),
    });
  });

  // ------------------------------------------------------------- P-71 incidents
  app.get("/v1/admin/incidents", staff, async (c) => {
    const { state } = parseQuery(c, z.object({ state: z.enum(["open", "resolved"]).default("open") }));
    const rows = state === "open"
      ? await sql<Row>(d.pool, `select i.*, o.name as org_name from app.open_incidents i left join public.organizations o on o.id = i.org_id order by i.created_at desc limit 100`)
      : await sql<Row>(d.pool, `select r.subject_type, r.subject_id, r.note, r.resolved_at as created_at, s.email as by from public.incident_resolutions r left join public.staff s on s.user_id = r.staff_user_id order by r.resolved_at desc limit 100`);
    const total = state === "open" ? (await sqlOne<{ n: number }>(d.pool, "select count(*)::int as n from app.open_incidents")).n : rows.length;
    return c.json({ total, items: rows.map((r) => ({ type: r.subject_type, id: r.subject_id, orgId: r.org_id ?? null, orgName: r.org_name ?? null, channel: r.channel ?? null, stage: r.stage ?? null, error: r.error ?? r.note ?? null, by: r.by ?? null, at: iso(r.created_at) })) });
  });

  app.get("/v1/admin/incidents/:type/:id", staff, async (c) => {
    const type = c.req.param("type");
    const id = c.req.param("id");
    if (type === "job") {
      const j = await sqlOne<Row>(d.pool, "select * from public.jobs where id::text = $1", [id]);
      const res = await sql<Row>(d.pool, "select r.*, s.email from public.incident_resolutions r left join public.staff s on s.user_id = r.staff_user_id where subject_type = 'job' and subject_id = $1", [id]);
      return c.json({
        type, id, kind: j.kind, status: j.status, attempts: j.attempts, maxAttempts: j.max_attempts, error: j.last_error, payload: j.payload,
        createdAt: iso(j.created_at), updatedAt: iso(j.updated_at),
        resolution: res[0] ? { note: res[0].note, by: res[0].email, at: iso(res[0].resolved_at) } : null,
        timeline: [
          { step: "queued", ok: true, at: iso(j.created_at), detail: j.kind },
          { step: "attempts", ok: j.status !== "failed", at: iso(j.updated_at), detail: `${j.attempts}/${j.max_attempts}` },
        ],
      });
    }
    if (type !== "message") throw httpErrors.notFound();
    const m = await sqlOne<Row>(d.pool, `select m.*, o.name as org_name, ci.external_id, ci.display_name from public.messages m
      join public.organizations o on o.id = m.org_id join public.channel_identities ci on ci.id = m.identity_id where m.id::text = $1`, [id]);
    const [jobs, ai, replies, res, webhook] = await Promise.all([
      sql<Row>(d.pool, "select id::text, status, attempts, max_attempts, last_error, created_at, updated_at from public.jobs where payload ->> 'message_id' = $1 order by id", [id]),
      sql<Row>(d.pool, "select task, model, ok, duration_ms, created_at from public.ai_usage where org_id = $1 and created_at between $2::timestamptz - interval '10 seconds' and coalesce($3::timestamptz, $2::timestamptz + interval '10 minutes') order by created_at", [m.org_id, m.created_at, m.processed_at]),
      sql<Row>(d.pool, "select kind, left(text, 200) as text, created_at from public.messages where identity_id = $1 and direction = 'out' and created_at >= $2 order by created_at limit 5", [m.identity_id, m.created_at]),
      sql<Row>(d.pool, "select r.*, s.email from public.incident_resolutions r left join public.staff s on s.user_id = r.staff_user_id where subject_type = 'message' and subject_id = $1", [id]),
      sql<Row>(d.pool, "select signature_valid, received_at from public.webhook_events where source = $1 and received_at between $2::timestamptz - interval '30 seconds' and $2::timestamptz order by received_at desc limit 1", [m.channel, m.created_at]),
    ]);
    const timeline: Array<{ step: string; ok: boolean | null; at: string | null; detail: string | null }> = [
      { step: "received", ok: true, at: iso(m.created_at), detail: webhook[0] ? (webhook[0].signature_valid ? "signature" : "no_signature") : m.channel },
    ];
    if (m.media_ref || m.media_key) timeline.push({ step: "media", ok: Boolean(m.media_key), at: null, detail: m.media_type });
    for (const a of ai) timeline.push({ step: `ai:${a.task}`, ok: a.ok, at: iso(a.created_at), detail: `${a.model} · ${a.duration_ms} ms` });
    if (jobs.length) timeline.push({ step: "attempts", ok: m.status !== "failed", at: iso(jobs.at(-1)!.updated_at), detail: `${jobs.at(-1)!.attempts}/${jobs.at(-1)!.max_attempts}` });
    timeline.push({ step: "result", ok: m.status === "processed" ? true : m.status === "failed" ? false : null, at: iso(m.processed_at), detail: m.status });
    return c.json({
      type, id, orgId: m.org_id, orgName: m.org_name, channel: m.channel, kind: m.kind, status: m.status, error: m.error,
      identity: `${String(m.external_id).slice(0, 6)}…${String(m.external_id).slice(-3)}`,
      input: { kind: m.kind, mediaType: m.media_type, hasMedia: Boolean(m.media_key || m.media_ref), textLength: m.text?.length ?? null, durationMs: m.duration_ms },
      createdAt: iso(m.created_at), processedAt: iso(m.processed_at),
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, attempts: j.attempts, maxAttempts: j.max_attempts, error: j.last_error })),
      replies: replies.map((r) => ({ kind: r.kind, text: r.text, at: iso(r.created_at) })),
      timeline,
      resolution: res[0] ? { note: res[0].note, by: res[0].email, at: iso(res[0].resolved_at) } : null,
    });
  });

  app.post("/v1/admin/incidents/:type/:id/resolve", staff, async (c) => {
    const { note } = await parseJson(c, z.object({ note: z.string().max(500).nullable().optional() }));
    await sql(d.pool, "select app.resolve_incident($1, $2, $3, $4)", [actor(c), c.req.param("type"), c.req.param("id"), note ?? null]);
    return c.json({ ok: true });
  });

  // Relancer : le message repart dans la file (même identifiant, traitement idempotent).
  app.post("/v1/admin/incidents/message/:id/retry", staff, async (c) => {
    const id = c.req.param("id");
    await sql(d.pool, "update public.messages set status = 'received', error = null where id::text = $1 and direction = 'in' and status = 'failed'", [id]);
    await sql(d.pool, "select app.enqueue_job('process_message', jsonb_build_object('message_id', $1::text), 'retry:' || $1 || ':' || extract(epoch from now())::bigint)", [id]);
    await sql(d.pool, "select app.audit('staff', $1, 'retry_message', 'message', $2, null, null)", [actor(c), id]);
    return c.json({ ok: true });
  });

  // Écrire à l'artisan depuis la console (incident : « renvoie ton vocal » ; support : message libre).
  async function messageOrg(staffId: string, orgId: string, text: string, preset: string | null) {
    await sql(d.pool, "select app.enqueue_job('staff_message', jsonb_build_object('org_id', $1::text, 'text', $2::text, 'preset', $3::text))", [orgId, text, preset]);
    await sql(d.pool, "select app.audit('staff', $1, 'staff_message', 'organization', $2, null, jsonb_build_object('preset', $3::text, 'length', length($4)))", [staffId, orgId, preset, text]);
  }
  app.post("/v1/admin/incidents/message/:id/ask-again", staff, async (c) => {
    const m = await sqlOne<{ org_id: string; kind: string }>(d.pool, "select org_id, kind from public.messages where id::text = $1", [c.req.param("id")]);
    await messageOrg(actor(c), m.org_id, "", m.kind === "image" ? "ask_photo_again" : "ask_voice_again");
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- P-72 support d'une organisation
  app.post("/v1/admin/organizations/:id/access-link", admin, async (c) => {
    const id = c.req.param("id");
    const { token, minutes } = await d.portalLink(id);
    await sql(d.pool, "select app.audit('staff', $1, 'support_access_link', 'organization', $2, null, jsonb_build_object('minutes', $3::int))", [actor(c), id, minutes]);
    return c.json({ url: `${d.webUrl.replace(/\/$/, "")}/acces/${token}`, minutes });
  });
  app.post("/v1/admin/organizations/:id/reset-quota", admin, async (c) => {
    const b = await parseJson(c, z.object({ reason }));
    await sql(d.pool, "select app.reset_quota($1, $2, $3)", [c.req.param("id"), actor(c), b.reason]);
    return c.json({ ok: true });
  });
  app.post("/v1/admin/organizations/:id/message", admin, async (c) => {
    const b = await parseJson(c, z.object({ text: z.string().trim().min(2).max(1000) }));
    await messageOrg(actor(c), c.req.param("id"), b.text, null);
    return c.json({ ok: true });
  });
  app.post("/v1/admin/organizations/:id/reveal", staff, async (c) => {
    const b = await parseJson(c, z.object({ reason }));
    const r = await sqlOne<{ until: Date }>(d.pool, "select app.reveal_prices($1, $2, $3) as until", [actor(c), c.req.param("id"), b.reason]);
    return c.json({ until: iso(r.until) });
  });
  app.get("/v1/admin/organizations/:id/audit", staff, async (c) => {
    const id = c.req.param("id");
    const rows = await sql<Row>(d.pool, `select a.id, a.actor_type, a.actor_id, s.email, a.action, a.entity, a.entity_id, a.after, a.created_at
      from public.audit_log a left join public.staff s on s.user_id::text = a.actor_id
      where a.entity_id = $1 or a.entity_id in (select id::text from public.subscriptions where org_id = $1::uuid)
         or a.entity_id in (select id::text from public.documents where org_id = $1::uuid)
         or (a.actor_type = 'org' and a.actor_id = $1)
      order by a.id desc limit 100`, [id]);
    return c.json({ items: rows.map((r) => ({ id: Number(r.id), actor: r.email ?? r.actor_type, action: r.action, entity: r.entity, reason: r.after?.reason ?? null, at: iso(r.created_at) })) });
  });

  // ------------------------------------------------------------- P-73 listes
  app.get("/v1/admin/documents", staff, async (c) => {
    const q = parseQuery(c, z.object({ org: z.string().uuid().optional(), status: z.string().max(20).default(""), type: z.string().max(20).default(""), page: z.coerce.number().int().min(1).default(1) }));
    const rows = await sql<Row>(d.pool, `select d.id, d.org_id, o.name as org_name, d.type_code, d.status, d.number, d.title, d.total_minor::text as total_minor, d.currency_code,
        coalesce(d.client_snapshot ->> 'name', c.name) as client, d.created_at, d.issued_at
      from public.documents d join public.organizations o on o.id = d.org_id left join public.clients c on c.id = d.client_id
      where ($1::uuid is null or d.org_id = $1) and ($2 = '' or d.status = $2) and ($3 = '' or d.type_code = $3)
      order by d.created_at desc limit 50 offset $4`, [q.org ?? null, q.status, q.type, (q.page - 1) * 50]);
    const shown = await revealed(actor(c), [...new Set(rows.map((r) => r.org_id))]);
    return c.json({
      items: rows.map((r) => ({
        id: r.id, orgId: r.org_id, orgName: r.org_name, type: r.type_code, status: r.status, number: r.number, title: r.title, client: r.client,
        // P-74 : le montant n'est envoyé que si ce membre a donné un motif pour cette organisation.
        totalMinor: shown.has(r.org_id) ? r.total_minor : null, currency: r.currency_code,
        createdAt: iso(r.created_at), issuedAt: iso(r.issued_at),
      })),
    });
  });
  app.get("/v1/admin/payments", staff, async (c) => {
    const { status } = parseQuery(c, z.object({ status: z.string().max(20).default("") }));
    const rows = await sql<Row>(d.pool, `select p.id, p.org_id, o.name as org_name, p.reference, p.status, p.kind, p.units, p.amount_minor::text as amount_minor, p.currency_code,
        p.provider_code, p.provider_reference, p.created_at, p.settled_at
      from public.subscription_payments p join public.organizations o on o.id = p.org_id
      where ($1 = '' or p.status = $1) order by p.created_at desc limit 100`, [status]);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, reference: r.reference, status: r.status, kind: r.kind, units: r.units, amountMinor: r.amount_minor, currency: r.currency_code, provider: r.provider_code, providerReference: r.provider_reference, createdAt: iso(r.created_at), settledAt: iso(r.settled_at) })) });
  });
  app.get("/v1/admin/subscriptions", staff, async (c) => {
    const rows = await sql<Row>(d.pool, `select s.id, s.org_id, o.name as org_name, s.kind, s.quota, s.used, s.period_start, s.period_end, s.ended_at, p.code as plan_code, p.version as plan_version, p.grace_days
      from public.subscriptions s join public.organizations o on o.id = s.org_id left join public.plans p on p.id = s.plan_id
      order by s.created_at desc limit 100`);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, kind: r.kind, quota: r.quota, used: r.used, planCode: r.plan_code, planVersion: r.plan_version, graceDays: r.grace_days, periodStart: iso(r.period_start), periodEnd: iso(r.period_end), endedAt: iso(r.ended_at) })) });
  });
  app.get("/v1/admin/clients", staff, async (c) => {
    const rows = await sql<Row>(d.pool, `select c.id, c.org_id, o.name as org_name, c.name, c.created_at,
        (select count(*) from public.documents d where d.client_id = c.id and d.status <> 'draft')::int as documents
      from public.clients c join public.organizations o on o.id = c.org_id order by c.created_at desc limit 100`);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, name: r.name, documents: r.documents, createdAt: iso(r.created_at) })) });
  });
  app.get("/v1/admin/identities", staff, async (c) => {
    const rows = await sql<Row>(d.pool, `select ci.id, ci.org_id, o.name as org_name, ci.channel, ci.display_name, ci.external_id, ci.created_at, ci.last_seen_at,
        si.staff_user_id, s.email as staff_email
      from public.channel_identities ci join public.organizations o on o.id = ci.org_id
      left join public.staff_identities si on si.identity_id = ci.id left join public.staff s on s.user_id = si.staff_user_id
      order by ci.last_seen_at desc limit 200`);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, channel: r.channel, name: r.display_name, externalId: `${String(r.external_id).slice(0, 4)}…${String(r.external_id).slice(-3)}`, staffEmail: r.staff_email, createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at) })) });
  });
  // P-76 : autoriser une identité de messagerie à demander un lien d'administration (« ADMIN »).
  app.post("/v1/admin/identities/:id/staff", admin, async (c) => {
    const b = await parseJson(c, z.object({ staffUserId: z.string().uuid(), allow: z.boolean() }));
    await sql(d.pool, "select app.authorize_staff_identity($1, $2, $3, $4)", [actor(c), b.staffUserId, c.req.param("id"), b.allow]);
    return c.json({ ok: true });
  });

  // Changement de numéro (spec 015) : la nouvelle identité rejoint l'organisation d'origine ;
  // refusé si le nouveau numéro a déjà des documents. Motif obligatoire, inscrit au journal.
  app.post("/v1/admin/identities/:id/move", admin, async (c) => {
    const b = await parseJson(c, z.object({ targetOrgId: z.string().uuid(), reason }));
    await sql(d.pool, "select app.move_identity($1, $2, $3, $4)", [actor(c), c.req.param("id"), b.targetOrgId, b.reason]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- P-83 demandes sur les données
  app.get("/v1/admin/data-requests", staff, async (c) => {
    const rows = await sql<Row>(d.pool, `select r.id, r.org_id, o.name as org_name, o.status as org_status, r.kind, r.status, r.origin, r.note, r.created_at, r.handled_at, s.email as handled_by
      from public.data_requests r join public.organizations o on o.id = r.org_id left join public.staff s on s.user_id::text = r.handled_by
      order by (r.status = 'pending') desc, r.created_at desc limit 100`);
    return c.json({ items: rows.map((r) => ({ id: r.id, orgId: r.org_id, orgName: r.org_name, orgStatus: r.org_status, kind: r.kind, status: r.status, origin: r.origin, note: r.note, createdAt: iso(r.created_at), handledAt: iso(r.handled_at), handledBy: r.handled_by ?? (r.status === "done" && r.kind === "export" ? "self" : null) })) });
  });
  app.post("/v1/admin/data-requests/:id/execute", admin, async (c) => {
    const b = await parseJson(c, z.object({ reason }));
    const r = await sqlOne<{ v: { media_keys: string[]; logo_key: string | null; counts: Record<string, number> } }>(d.pool, "select app.execute_deletion($1, $2, $3) as v", [actor(c), c.req.param("id"), b.reason]);
    // Les fichiers suivent la base : un fichier déjà absent n'empêche rien.
    const keys = [...(r.v.media_keys ?? []), ...(r.v.logo_key ? [r.v.logo_key] : [])];
    let removed = 0;
    for (const k of keys) {
      try {
        await d.files.delete(k);
        removed++;
      } catch {
        // déjà supprimé
      }
    }
    return c.json({ counts: r.v.counts, filesRemoved: removed });
  });
  app.post("/v1/admin/data-requests/:id/reject", admin, async (c) => {
    const b = await parseJson(c, z.object({ reason }));
    await sql(d.pool, "select app.reject_data_request($1, $2, $3)", [actor(c), c.req.param("id"), b.reason]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- P-77 recherche, P-78 pilotage
  app.get("/v1/admin/search", staff, async (c) => {
    const { q } = parseQuery(c, z.object({ q: z.string().max(80).default("") }));
    const r = await sqlOne<{ v: unknown }>(d.pool, "select app.admin_search($1, $2) as v", [actor(c), q]);
    return c.json(r.v);
  });
  app.get("/v1/admin/pilotage", staff, async (c) => {
    const { days } = parseQuery(c, z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }));
    const r = await sqlOne<{ v: unknown }>(d.pool, "select app.admin_pilotage($1) as v", [days]);
    return c.json(r.v);
  });
}
