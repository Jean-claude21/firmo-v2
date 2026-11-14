import type pg from "pg";
import { type Db, sql, sqlOne, withTransaction } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { newToken, tokenHash } from "../lib/session.js";
import type { Currency } from "./money.js";

// Accès aux documents. Toute règle (totaux, numéros, transitions, quota) est décidée en SQL ;
// ce module appelle les fonctions `app.*` avec l'organisation de la session.

export interface LineInput {
  label: string;
  quantity: string | null;
  unit: string | null;
  unitPriceMinor: string | null;
  toConfirm?: Array<"label" | "quantity" | "unit" | "unit_price">;
  source?: "read" | "typed";
}

export interface DocumentLine {
  position: number;
  label: string;
  quantity: string | null;
  unit: string | null;
  unitLabel: string | null;
  unitPriceMinor: string | null;
  lineTotalMinor: string | null;
  toConfirm: string[];
  source: "read" | "typed";
}

export interface DocumentView {
  id: string;
  orgId: string;
  type: string;
  typeLabel: string;
  status: string;
  number: string | null;
  title: string | null;
  notes: string | null;
  locale: string;
  template: string;
  currency: Currency;
  client: { id: string | null; name: string | null; phone: string | null; email: string | null; address: string | null; legalId: string | null };
  issuer: Record<string, unknown> | null;
  issueDate: string | null;
  validUntil: string | null;
  expired: boolean;
  discountBp: number | null;
  discountMinor: string | null;
  applyTax: boolean;
  taxLabel: string | null;
  taxRateBp: number;
  subtotalMinor: string;
  discountTotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  paidMinor: string;
  sourceDocumentId: string | null;
  sourceNumber: string | null;
  revisesId: string | null;
  acceptable: boolean;
  payable: boolean;
  renderVersion: number;
  sharedAt: string | null;
  viewedAt: string | null;
  decidedAt: string | null;
  decisionBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  issuedAt: string | null;
  lines: DocumentLine[];
  payments: Array<{ id: string; amountMinor: string; paidOn: string; method: string | null; receiptId: string | null }>;
  blockers: string[];
}

export interface DocumentSummary {
  id: string;
  type: string;
  typeLabel: string;
  status: string;
  number: string | null;
  clientName: string | null;
  totalMinor: string;
  paidMinor: string;
  currencyCode: string;
  issueDate: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface Entitlement {
  kind: string;
  quota: number;
  used: number;
  remaining: number;
  periodEnd: string | null;
  planCode: string | null;
}

function linesJson(lines: LineInput[]) {
  return JSON.stringify(
    lines.map((l) => ({
      label: l.label,
      quantity: l.quantity,
      unit: l.unit,
      unit_price_minor: l.unitPriceMinor,
      to_confirm: l.toConfirm ?? [],
      source: l.source ?? "typed",
    })),
  );
}

export interface DocumentFilters {
  type?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface DocumentStore {
  createDraft(orgId: string, type: string, lines: LineInput[], origin?: "chat" | "web", title?: string | null): Promise<string>;
  setLines(orgId: string, docId: string, lines: LineInput[]): Promise<void>;
  addLines(orgId: string, docId: string, lines: LineInput[]): Promise<void>;
  patchLine(orgId: string, docId: string, position: number, patch: Partial<Omit<LineInput, "toConfirm" | "source">>): Promise<void>;
  removeLine(orgId: string, docId: string, position: number): Promise<void>;
  updateDraft(orgId: string, docId: string, patch: Record<string, unknown>): Promise<void>;
  setClient(orgId: string, docId: string, name: string | null, details?: Record<string, string | null>): Promise<void>;
  issue(orgId: string, docId: string): Promise<DocumentView>;
  revise(orgId: string, docId: string): Promise<string>;
  convert(orgId: string, docId: string): Promise<string>;
  cancel(orgId: string, docId: string): Promise<void>;
  decide(orgId: string, docId: string, decision: "accepted" | "refused", note?: string | null): Promise<void>;
  share(orgId: string, docId: string): Promise<{ token: string; expiresAt: string }>;
  markShared(orgId: string, docId: string, via: string): Promise<void>;
  recordPayment(orgId: string, docId: string, amountMinor: string, paidOn?: string | null, method?: string | null, note?: string | null): Promise<string>;
  issueReceipt(orgId: string, paymentId: string): Promise<string>;
  get(orgId: string, docId: string): Promise<DocumentView>;
  getAny(docId: string): Promise<DocumentView>;
  list(orgId: string, filters?: DocumentFilters): Promise<{ items: DocumentSummary[]; total: number }>;
  currentDraft(orgId: string): Promise<string | null>;
  lastIssued(orgId: string, types?: string[]): Promise<string | null>;
  findByNumber(orgId: string, number: string): Promise<string | null>;
  entitlement(orgId: string): Promise<Entitlement | null>;
  publicDocument(token: string): Promise<DocumentView>;
  clientDecision(token: string, decision: "accepted" | "refused", note?: string | null): Promise<DocumentView>;
}

const VIEW_SQL = `
  select d.*, dt.labels as type_labels, dt.acceptable, dt.payable,
         cu.minor_units, cu.symbol, cu.symbol_before, cu.thousands_separator, cu.decimal_separator,
         c.name as c_name, c.phone as c_phone, c.email as c_email, c.address as c_address, c.legal_id as c_legal_id,
         src.number as source_number,
         app.issue_blockers(d.org_id, d.id) as blockers
  from public.documents d
  join public.document_types dt on dt.code = d.type_code
  join public.currencies cu on cu.code = d.currency_code
  left join public.clients c on c.id = d.client_id
  left join public.documents src on src.id = d.source_document_id
  where d.id = $1`;

type Row = Record<string, any>;

function toView(row: Row, lines: Row[], payments: Row[]): DocumentView {
  const snapshot = row.client_snapshot as Record<string, string | null> | null;
  const label = (labels: Record<string, string>) => labels[row.locale] ?? labels.fr ?? Object.values(labels)[0] ?? "";
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type_code,
    typeLabel: label(row.type_labels),
    status: row.status,
    number: row.number,
    title: row.title,
    notes: row.notes,
    locale: row.locale,
    template: row.template_code,
    currency: {
      code: row.currency_code,
      minorUnits: row.minor_units,
      symbol: row.symbol,
      symbolBefore: row.symbol_before,
      thousandsSeparator: row.thousands_separator,
      decimalSeparator: row.decimal_separator,
    },
    client: snapshot
      ? { id: row.client_id, name: snapshot.name ?? null, phone: snapshot.phone ?? null, email: snapshot.email ?? null, address: snapshot.address ?? null, legalId: snapshot.legal_id ?? null }
      : { id: row.client_id, name: row.c_name, phone: row.c_phone, email: row.c_email, address: row.c_address, legalId: row.c_legal_id },
    issuer: row.issuer_snapshot,
    issueDate: row.issue_date ? isoDate(row.issue_date) : null,
    validUntil: row.valid_until ? isoDate(row.valid_until) : null,
    expired: row.status === "issued" && row.valid_until != null && isoDate(row.valid_until) < isoDate(new Date()),
    discountBp: row.discount_bp,
    discountMinor: row.discount_minor,
    applyTax: row.apply_tax,
    taxLabel: row.tax_label,
    taxRateBp: row.tax_rate_bp,
    subtotalMinor: row.subtotal_minor,
    discountTotalMinor: row.discount_total_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    paidMinor: row.paid_minor,
    sourceDocumentId: row.source_document_id,
    sourceNumber: row.source_number,
    revisesId: row.revises_id,
    acceptable: row.acceptable,
    payable: row.payable,
    renderVersion: row.render_version,
    sharedAt: row.shared_at?.toISOString?.() ?? null,
    viewedAt: row.viewed_at?.toISOString?.() ?? null,
    decidedAt: row.decided_at?.toISOString?.() ?? null,
    decisionBy: row.decision_by,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    issuedAt: row.issued_at?.toISOString?.() ?? null,
    lines: lines.map((l) => ({
      position: l.position,
      label: l.label,
      quantity: l.quantity,
      unit: l.unit_code,
      unitLabel: l.unit_label,
      unitPriceMinor: l.unit_price_minor,
      lineTotalMinor: l.line_total_minor,
      toConfirm: l.to_confirm,
      source: l.source,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amountMinor: p.amount_minor,
      paidOn: isoDate(p.paid_on),
      method: p.method,
      receiptId: p.receipt_id,
    })),
    blockers: row.blockers ?? [],
  };
}

function isoDate(value: Date | string): string {
  if (typeof value === "string") return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function pgDocumentStore(pool: pg.Pool): DocumentStore {
  const db: Db = pool;

  async function load(docId: string, orgId?: string): Promise<DocumentView> {
    const row = await sqlOne<Row>(db, VIEW_SQL, [docId]);
    if (orgId && row.org_id !== orgId) {
      throw httpErrors.notFound("document introuvable");
    }
    const lines = await sql<Row>(
      db,
      `select l.*, coalesce(u.short_labels ->> $2, u.short_labels ->> 'fr') as unit_label
       from public.document_lines l left join public.units u on u.code = l.unit_code
       where l.document_id = $1 order by l.position`,
      [docId, row.locale],
    );
    const payments = await sql<Row>(
      db,
      "select * from public.document_payments where document_id = $1 order by paid_on, created_at",
      [docId],
    );
    return toView(row, lines, payments);
  }

  const store: DocumentStore = {
    async createDraft(orgId, type, lines, origin = "chat", title = null) {
      const r = await sqlOne<{ id: string }>(db, "select app.create_draft($1, $2, $3::jsonb, $4, $5) as id", [
        orgId, type, linesJson(lines), origin, title,
      ]);
      return r.id;
    },
    async setLines(orgId, docId, lines) {
      await sql(db, "select app.set_lines($1, $2, $3::jsonb)", [orgId, docId, linesJson(lines)]);
    },
    async addLines(orgId, docId, lines) {
      await sql(db, "select app.add_lines($1, $2, $3::jsonb)", [orgId, docId, linesJson(lines)]);
    },
    async patchLine(orgId, docId, position, patch) {
      const body: Record<string, unknown> = {};
      if (patch.label !== undefined) body.label = patch.label;
      if (patch.quantity !== undefined) body.quantity = patch.quantity;
      if (patch.unit !== undefined) body.unit = patch.unit;
      if (patch.unitPriceMinor !== undefined) body.unit_price_minor = patch.unitPriceMinor;
      await sql(db, "select app.patch_line($1, $2, $3, $4::jsonb)", [orgId, docId, position, JSON.stringify(body)]);
    },
    async removeLine(orgId, docId, position) {
      await sql(db, "select app.remove_line($1, $2, $3)", [orgId, docId, position]);
    },
    async updateDraft(orgId, docId, patch) {
      await sql(db, "select app.update_draft($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(patch)]);
    },
    async setClient(orgId, docId, name, details = {}) {
      await sql(db, "select app.set_document_client($1, $2, $3, $4::jsonb)", [orgId, docId, name, JSON.stringify(details)]);
    },
    async issue(orgId, docId) {
      await sql(db, "select app.issue_document($1, $2)", [orgId, docId]);
      return load(docId, orgId);
    },
    async revise(orgId, docId) {
      return (await sqlOne<{ id: string }>(db, "select app.revise_document($1, $2) as id", [orgId, docId])).id;
    },
    async convert(orgId, docId) {
      return (await sqlOne<{ id: string }>(db, "select app.convert_document($1, $2) as id", [orgId, docId])).id;
    },
    async cancel(orgId, docId) {
      await sql(db, "select app.cancel_document($1, $2)", [orgId, docId]);
    },
    async decide(orgId, docId, decision, note = null) {
      await sql(db, "select app.decide_document($1, $2, $3, $4)", [orgId, docId, decision, note]);
    },
    async share(orgId, docId) {
      const { token, hash } = newToken(24);
      const r = await sqlOne<{ expires: Date }>(db, "select app.share_document($1, $2, $3) as expires", [orgId, docId, hash]);
      return { token, expiresAt: r.expires.toISOString() };
    },
    async markShared(orgId, docId, via) {
      await sql(db, "select app.mark_shared($1, $2, $3)", [orgId, docId, via]);
    },
    async recordPayment(orgId, docId, amountMinor, paidOn = null, method = null, note = null) {
      const r = await sqlOne<{ id: string }>(
        db,
        "select app.record_payment($1, $2, $3::bigint, coalesce($4::date, current_date), $5, $6) as id",
        [orgId, docId, amountMinor, paidOn, method, note],
      );
      return r.id;
    },
    async issueReceipt(orgId, paymentId) {
      return (await sqlOne<{ id: string }>(db, "select app.issue_receipt($1, $2) as id", [orgId, paymentId])).id;
    },
    get: (orgId, docId) => load(docId, orgId),
    getAny: (docId) => load(docId),
    async list(orgId, filters = {}) {
      const where = ["d.org_id = $1", "d.status <> 'replaced'"];
      const values: unknown[] = [orgId];
      if (filters.type) {
        values.push(filters.type);
        where.push(`d.type_code = $${values.length}`);
      }
      if (filters.status) {
        values.push(filters.status);
        where.push(`d.status = $${values.length}`);
      }
      if (filters.search) {
        values.push(`%${filters.search.toLowerCase()}%`);
        where.push(`(lower(coalesce(d.number, '')) like $${values.length} or lower(coalesce(c.name, '')) like $${values.length} or lower(coalesce(d.title, '')) like $${values.length})`);
      }
      const base = `from public.documents d left join public.clients c on c.id = d.client_id
                    join public.document_types dt on dt.code = d.type_code
                    join public.organizations o on o.id = d.org_id
                    where ${where.join(" and ")}`;
      const total = await sqlOne<{ n: string }>(db, `select count(*)::text as n ${base}`, values);
      values.push(Math.min(filters.limit ?? 50, 200), filters.offset ?? 0);
      const rows = await sql<Row>(
        db,
        `select d.id, d.type_code, coalesce(dt.labels ->> o.locale, dt.labels ->> 'fr') as type_label, d.status, d.number,
                coalesce(d.client_snapshot ->> 'name', c.name) as client_name, d.total_minor, d.paid_minor,
                d.currency_code, d.issue_date, d.valid_until, d.created_at
         ${base} order by d.created_at desc limit $${values.length - 1} offset $${values.length}`,
        values,
      );
      return {
        total: Number(total.n),
        items: rows.map((r) => ({
          id: r.id,
          type: r.type_code,
          typeLabel: r.type_label,
          status: r.status,
          number: r.number,
          clientName: r.client_name,
          totalMinor: r.total_minor,
          paidMinor: r.paid_minor,
          currencyCode: r.currency_code,
          issueDate: r.issue_date ? isoDate(r.issue_date) : null,
          validUntil: r.valid_until ? isoDate(r.valid_until) : null,
          createdAt: r.created_at.toISOString(),
        })),
      };
    },
    async currentDraft(orgId) {
      const rows = await sql<{ id: string }>(
        db,
        "select id from public.documents where org_id = $1 and status = 'draft' and origin = 'chat' order by updated_at desc limit 1",
        [orgId],
      );
      return rows[0]?.id ?? null;
    },
    async lastIssued(orgId, types) {
      const rows = await sql<{ id: string }>(
        db,
        `select id from public.documents where org_id = $1 and status not in ('draft', 'cancelled', 'replaced')
           and ($2::text[] is null or type_code = any($2)) order by issued_at desc limit 1`,
        [orgId, types ?? null],
      );
      return rows[0]?.id ?? null;
    },
    async findByNumber(orgId, number) {
      const rows = await sql<{ id: string }>(
        db,
        "select id from public.documents where org_id = $1 and upper(number) = upper($2) and status <> 'replaced'",
        [orgId, number.trim()],
      );
      return rows[0]?.id ?? null;
    },
    async entitlement(orgId) {
      const rows = await sql<Row>(db, "select * from app.entitlement($1)", [orgId]);
      const r = rows[0];
      if (!r) return null;
      return {
        kind: r.kind,
        quota: r.quota,
        used: r.used,
        remaining: r.remaining,
        periodEnd: r.period_end?.toISOString?.() ?? null,
        planCode: r.plan_code,
      };
    },
    async publicDocument(token) {
      const r = await sqlOne<{ id: string }>(db, "select app.document_by_share($1) as id", [tokenHash(token)]);
      return load(r.id);
    },
    async clientDecision(token, decision, note = null) {
      return withTransaction(pool, async (client) => {
        const r = await sqlOne<{ id: string }>(client, "select app.client_decision($1, $2, $3) as id", [tokenHash(token), decision, note]);
        return r.id;
      }).then((id) => load(id));
    },
  };
  return store;
}
