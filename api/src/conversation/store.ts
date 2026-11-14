import type pg from "pg";
import type { InboundMessage } from "../channels/types.js";
import type { Currency } from "../documents/money.js";
import { sql, sqlOne } from "../lib/db.js";
import { newToken } from "../lib/session.js";

// Données de la conversation : messages, état, livraisons, coûts IA, journal des webhooks.

export interface StoredMessage {
  id: string;
  orgId: string;
  identityId: string;
  channel: string;
  to: string;
  kind: string;
  text: string | null;
  mediaRef: string | null;
  mediaType: string | null;
  status: string;
  form: { name: string; values: Record<string, string> } | null;
  firstMessage: boolean;
}

export interface OrgContext {
  orgId: string;
  name: string | null;
  locale: string;
  currency: Currency;
  trade: string | null;
  units: Array<{ code: string; label: string }>;
  template: string;
}

export interface ConversationState {
  documentId: string | null;
  awaiting: string | null;
  resume: string | null;
}

export interface AiUsageRecord {
  model: string;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  audioSeconds?: number | undefined;
  durationMs: number;
}

export function pgConversationStore(pool: pg.Pool) {
  return {
    async journal(source: string, signatureValid: boolean, body: string, error: string | null = null): Promise<void> {
      await sql(pool, "insert into public.webhook_events (source, signature_valid, body, error) values ($1, $2, $3, $4)", [
        source, signatureValid, body.slice(0, 200_000), error,
      ]);
    },

    async receive(m: InboundMessage): Promise<{ messageId: string; orgId: string; identityId: string; duplicate: boolean }> {
      const text = m.kind === "form" && m.form ? JSON.stringify(m.form) : m.text;
      const r = await sqlOne<{ message_id: string; org_id: string; identity_id: string; duplicate: boolean }>(
        pool,
        "select * from app.receive_message($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [m.channel, m.externalId, m.from.id, m.from.name, m.from.phone, m.from.locale?.slice(0, 2) ?? null, m.kind, text, m.media?.ref ?? null, m.media?.mediaType ?? null],
      );
      return { messageId: r.message_id, orgId: r.org_id, identityId: r.identity_id, duplicate: r.duplicate };
    },

    async load(id: string): Promise<StoredMessage | null> {
      const rows = await sql<Record<string, any>>(
        pool,
        `select m.*, ci.external_id as to_id,
                (select count(*) from public.messages x where x.identity_id = m.identity_id and x.direction = 'in') = 1 as first_message
         from public.messages m join public.channel_identities ci on ci.id = m.identity_id where m.id = $1`,
        [id],
      );
      const r = rows[0];
      if (!r) return null;
      let form: StoredMessage["form"] = null;
      if (r.kind === "form" && r.text) {
        try {
          form = JSON.parse(r.text);
        } catch {
          form = null;
        }
      }
      return {
        id: r.id, orgId: r.org_id, identityId: r.identity_id, channel: r.channel, to: r.to_id, kind: r.kind,
        text: r.kind === "form" ? null : r.text, mediaRef: r.media_ref, mediaType: r.media_type, status: r.status,
        form, firstMessage: r.first_message,
      };
    },

    async setStatus(id: string, status: "received" | "processing" | "processed" | "failed", fields: { error?: string; transcript?: string; documentId?: string | null; durationMs?: number; mediaKey?: string } = {}) {
      await sql(
        pool,
        `update public.messages set status = $2, error = coalesce($3, error), transcript = coalesce($4, transcript),
           document_id = coalesce($5, document_id), duration_ms = coalesce($6, duration_ms), media_key = coalesce($7, media_key),
           processed_at = case when $2 in ('processed', 'failed') then now() else processed_at end
         where id = $1`,
        [id, status, fields.error ?? null, fields.transcript ?? null, fields.documentId ?? null, fields.durationMs ?? null, fields.mediaKey ?? null],
      );
    },

    async recordOutbound(identityId: string, kind: "text" | "image" | "document", text: string | null, mediaKey: string | null, mediaType: string | null, externalId: string | null, documentId: string | null = null, buttons: Array<{ id: string; title: string }> | null = null): Promise<string> {
      const r = await sqlOne<{ id: string }>(
        pool,
        `insert into public.messages (org_id, identity_id, channel, direction, external_id, kind, text, media_key, media_type, status, document_id, buttons)
         select ci.org_id, ci.id, ci.channel, 'out', $2, $3, $4, $5, $6, 'sent', $7, $8::jsonb from public.channel_identities ci where ci.id = $1
         returning id`,
        [identityId, externalId, kind, text, mediaKey, mediaType, documentId, buttons ? JSON.stringify(buttons) : null],
      );
      return r.id;
    },

    async identityByExternal(channel: string, externalId: string): Promise<string | null> {
      const rows = await sql<{ id: string }>(pool, "select id from public.channel_identities where channel = $1 and external_id = $2", [channel, externalId]);
      return rows[0]?.id ?? null;
    },

    async context(orgId: string): Promise<OrgContext> {
      const r = await sqlOne<Record<string, any>>(
        pool,
        `select o.id, o.name, o.locale, o.template_code, cu.code, cu.minor_units, cu.symbol, cu.symbol_before,
                cu.thousands_separator, cu.decimal_separator, app.label(t.labels, o.locale) as trade
         from public.organizations o join public.currencies cu on cu.code = o.currency_code
         left join public.trades t on t.code = o.trade_code where o.id = $1`,
        [orgId],
      );
      const units = await sql<{ code: string; label: string }>(
        pool,
        "select code, app.label(labels, $1) as label from public.units order by position",
        [r.locale],
      );
      return {
        orgId: r.id,
        name: r.name,
        locale: r.locale,
        template: r.template_code,
        trade: r.trade,
        currency: { code: r.code, minorUnits: r.minor_units, symbol: r.symbol, symbolBefore: r.symbol_before, thousandsSeparator: r.thousands_separator, decimalSeparator: r.decimal_separator },
        units,
      };
    },

    async state(identityId: string): Promise<ConversationState> {
      const rows = await sql<{ document_id: string | null; awaiting: string | null; resume: string | null }>(
        pool,
        `select s.document_id, s.awaiting, s.resume from public.conversation_states s
         left join public.documents d on d.id = s.document_id where s.identity_id = $1`,
        [identityId],
      );
      const r = rows[0];
      return { documentId: r?.document_id ?? null, awaiting: r?.awaiting ?? null, resume: r?.resume ?? null };
    },

    async setState(identityId: string, documentId: string | null, awaiting: string | null = null, resume: string | null = null) {
      await sql(pool, "select app.set_conversation($1, $2, $3, $4)", [identityId, documentId, awaiting, resume]);
    },

    async setBusinessName(orgId: string, name: string) {
      await sql(pool, "update public.organizations set name = $2 where id = $1", [orgId, name.trim().slice(0, 120)]);
    },

    async setTemplate(orgId: string, template: string) {
      await sql(pool, "update public.organizations set template_code = $2 where id = $1", [orgId, template]);
    },

    async addDelivery(documentId: string, identityId: string) {
      await sql(pool, "insert into public.document_deliveries (document_id, identity_id) values ($1, $2) on conflict do nothing", [documentId, identityId]);
    },

    async pendingDeliveries(documentId: string): Promise<Array<{ id: string; identityId: string; channel: string; to: string }>> {
      const rows = await sql<{ id: string; identity_id: string; channel: string; external_id: string }>(
        pool,
        `select d.id, d.identity_id, ci.channel, ci.external_id from public.document_deliveries d
         join public.channel_identities ci on ci.id = d.identity_id where d.document_id = $1 and d.delivered_at is null`,
        [documentId],
      );
      return rows.map((r) => ({ id: r.id, identityId: r.identity_id, channel: r.channel, to: r.external_id }));
    },

    async markDelivered(id: string) {
      await sql(pool, "update public.document_deliveries set delivered_at = now() where id = $1", [id]);
    },

    async lastPaymentWithoutReceipt(orgId: string): Promise<string | null> {
      const rows = await sql<{ id: string }>(
        pool,
        `select p.id from public.document_payments p join public.documents d on d.id = p.document_id
         where d.org_id = $1 and p.receipt_id is null order by p.created_at desc limit 1`,
        [orgId],
      );
      return rows[0]?.id ?? null;
    },

    async lastOpenInvoice(orgId: string): Promise<string | null> {
      const rows = await sql<{ id: string }>(
        pool,
        `select d.id from public.documents d join public.document_types t on t.code = d.type_code
         where d.org_id = $1 and t.payable and d.status in ('issued', 'partially_paid') order by d.issued_at desc limit 1`,
        [orgId],
      );
      return rows[0]?.id ?? null;
    },

    async lastQuote(orgId: string, statuses: string[]): Promise<string | null> {
      const rows = await sql<{ id: string }>(
        pool,
        `select d.id from public.documents d join public.document_types t on t.code = d.type_code
         where d.org_id = $1 and t.acceptable and d.status = any($2) order by d.issued_at desc limit 1`,
        [orgId, statuses],
      );
      return rows[0]?.id ?? null;
    },

    async aiModel(task: string): Promise<{ model: string; enabled: boolean }> {
      const r = await sqlOne<{ model: string; enabled: boolean }>(pool, "select model, enabled from public.ai_tasks where task = $1", [task]);
      return r;
    },

    /** Coût : prix configurés dans `ai_tasks.pricing` (micro-dollars), sinon inconnu (null). */
    async recordAi(orgId: string | null, task: string, ok: boolean, u: AiUsageRecord): Promise<number | null> {
      const r = await sqlOne<{ cost: string | null }>(
        pool,
        `with p as (select pricing from public.ai_tasks where task = $2)
         insert into public.ai_usage (org_id, task, model, ok, input_tokens, output_tokens, audio_seconds, cost_micro_usd, duration_ms)
         select $1::uuid, $2::text, $3::text, $4::boolean, $5::int, $6::int, $7::numeric,
           case when p.pricing = '{}'::jsonb then null else round(
             coalesce($5::int, 0) * coalesce((p.pricing ->> 'input_per_mtok')::numeric, 0) / 1e6
           + coalesce($6::int, 0) * coalesce((p.pricing ->> 'output_per_mtok')::numeric, 0) / 1e6
           + coalesce($7::numeric, 0) * coalesce((p.pricing ->> 'per_minute')::numeric, 0) / 60)::bigint end,
           $8::int
         from p returning cost_micro_usd::text as cost`,
        [orgId, task, u.model, ok, u.inputTokens ?? null, u.outputTokens ?? null, u.audioSeconds ?? null, u.durationMs],
      );
      return r.cost === null ? null : Number(r.cost);
    },

    async recordReading(orgId: string, kind: string, lines: number, toConfirm: number, durationMs: number, cost: number | null) {
      await sql(pool, "select app.record_reading($1, $2, $3, $4, $5, $6)", [orgId, kind, lines, toConfirm, durationMs, cost]);
    },

    async flag(key: string): Promise<boolean> {
      const rows = await sql<{ enabled: boolean }>(pool, "select enabled from public.feature_flags where key = $1", [key]);
      return rows[0]?.enabled ?? false;
    },

    /** Lien à usage unique vers l'espace artisan (ART-1) ; renvoie le jeton et sa durée. */
    async accessLink(orgId: string, purpose: string, target: string | null): Promise<{ token: string; minutes: number }> {
      const { token, hash } = newToken();
      await sql(pool, "select app.create_access_link($1, $2, $3, $4)", [orgId, hash, purpose, target]);
      const m = await sqlOne<{ minutes: number }>(pool, "select (app.setting('portal_link_minutes') #>> '{}')::int as minutes");
      return { token, minutes: m.minutes };
    },
  };
}

export type ConversationStore = ReturnType<typeof pgConversationStore>;
