import type pg from "pg";
import { type Db, sql, sqlOne, withTransaction } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { tokenHash } from "../lib/session.js";
import { shareToken } from "./share.js";
import type { Currency } from "./money.js";

// Accès aux documents. Toute règle (totaux, numéros, transitions, quota) est décidée en SQL ;
// ce module appelle les fonctions `app.*` avec l'organisation de la session.
// Modèle de la v1 (PARITE_V1.md §1) : sections → lignes, ajustements ordonnés, clauses.

export type LineKind = "priced" | "flat" | "text";
export type ToConfirmField = "label" | "quantity" | "unit" | "unit_price" | "flat_amount";

export interface LineInput {
  label: string;
  description?: string | null;
  quantity: string | null;
  unit: string | null;
  unitPriceMinor: string | null;
  flatAmountMinor?: string | null;
  kind?: LineKind;
  toConfirm?: ToConfirmField[];
  source?: "read" | "typed";
}

export interface SectionInput {
  title: string | null;
  showSubtotal?: boolean;
  lines: LineInput[];
}

export interface AdjustmentInput {
  label: string;
  mode: "percent" | "amount";
  sign?: 1 | -1;
  base?: "items_total" | "section" | "taxable_base";
  /** Position de la section (1, 2…) quand base = section. */
  section?: number | null;
  rateBp?: number | null;
  valueMinor?: string | null;
  toConfirm?: boolean;
  source?: "read" | "typed";
}

/** Champs d'un brouillon (clés SQL de app.update_draft). */
export interface DraftFields {
  type?: string;
  title?: string | null;
  summary?: string | null;
  site?: string | null;
  delivery_text?: string | null;
  warranty_text?: string | null;
  assumptions?: string | null;
  notes?: string | null;
  validity_days?: number | null;
  deposit_bp?: number | null;
  apply_tax?: boolean;
  template?: string;
}

export interface DraftContent extends DraftFields {
  sections?: SectionInput[];
  adjustments?: AdjustmentInput[];
  /** Clauses enregistrées ({clauseId}) ou écrites pour ce document ({title, body}). */
  clauses?: Array<{ clauseId: string } | { title?: string | null; body: string }>;
}

export interface DocumentLine {
  position: number;
  sectionPosition: number;
  kind: LineKind;
  label: string;
  description: string | null;
  quantity: string | null;
  unit: string | null;
  unitPriceMinor: string | null;
  flatAmountMinor: string | null;
  lineTotalMinor: string | null;
  toConfirm: string[];
  source: "read" | "typed";
}

export interface DocumentSection {
  position: number;
  title: string | null;
  showSubtotal: boolean;
  subtotalMinor: string;
  lines: DocumentLine[];
}

export interface DocumentAdjustment {
  position: number;
  label: string;
  mode: "percent" | "amount";
  sign: 1 | -1;
  base: "items_total" | "section" | "taxable_base";
  sectionPosition: number | null;
  rateBp: number | null;
  valueMinor: string | null;
  baseMinor: string | null;
  amountMinor: string | null;
  toConfirm: boolean;
  source: "read" | "typed";
}

export interface DocumentClause {
  position: number;
  clauseId: string | null;
  title: string | null;
  body: string;
}

export interface DocumentView {
  id: string;
  orgId: string;
  type: string;
  typeLabel: string;
  status: string;
  number: string | null;
  manualNumber: boolean;
  revision: number;
  rootDocumentId: string | null;
  title: string | null;
  summary: string | null;
  site: string | null;
  deliveryText: string | null;
  warrantyText: string | null;
  assumptions: string | null;
  notes: string | null;
  validityDays: number | null;
  depositBp: number | null;
  locale: string;
  template: string;
  templateVersion: string | null;
  currency: Currency;
  client: { id: string | null; name: string | null; phone: string | null; email: string | null; address: string | null; legalId: string | null };
  issuer: Record<string, unknown> | null;
  issueDate: string | null;
  validUntil: string | null;
  expired: boolean;
  applyTax: boolean;
  taxLabel: string | null;
  taxRateBp: number;
  subtotalMinor: string;
  adjustmentsTotalMinor: string;
  taxableMinor: string;
  taxMinor: string;
  totalMinor: string;
  depositMinor: string | null;
  paidMinor: string;
  sourceDocumentId: string | null;
  sourceNumber: string | null;
  sourceType: string | null;
  revisesId: string | null;
  acceptable: boolean;
  payable: boolean;
  renderVersion: number;
  sharedAt: string | null;
  viewedAt: string | null;
  views: { first: string; last: string; count: number } | null;
  decidedAt: string | null;
  decisionBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  updatedAt: string;
  issuedAt: string | null;
  sections: DocumentSection[];
  /** Toutes les lignes, dans l'ordre affiché (positions continues). */
  lines: DocumentLine[];
  adjustments: DocumentAdjustment[];
  clauses: DocumentClause[];
  payments: Array<{ id: string; amountMinor: string; paidOn: string; method: string | null; receiptId: string | null }>;
  blockers: string[];
}

export interface DocumentSummary {
  id: string;
  type: string;
  typeLabel: string;
  status: string;
  number: string | null;
  title: string | null;
  clientName: string | null;
  totalMinor: string;
  paidMinor: string;
  currencyCode: string;
  issueDate: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  lines: number;
  sections: number;
}

export interface Entitlement {
  kind: string;
  quota: number;
  used: number;
  remaining: number;
  periodEnd: string | null;
  planCode: string | null;
}

export interface Clause {
  id: string;
  title: string | null;
  body: string;
  isDefault: boolean;
  position: number;
  active: boolean;
}

export interface Numbering {
  type: string;
  prefix: string;
  separator: string;
  includeYear: boolean;
  width: number;
  cadence: "annual" | "continuous";
  preview: string;
}

export function lineJson(l: LineInput) {
  return {
    label: l.label,
    description: l.description ?? null,
    quantity: l.quantity,
    unit: l.unit,
    unit_price_minor: l.unitPriceMinor,
    flat_amount_minor: l.flatAmountMinor ?? null,
    kind: l.kind ?? (l.flatAmountMinor != null ? "flat" : "priced"),
    to_confirm: l.toConfirm ?? [],
    source: l.source ?? "typed",
  };
}

export function adjustmentJson(a: AdjustmentInput) {
  return {
    label: a.label,
    mode: a.mode,
    sign: a.sign ?? 1,
    base: a.base ?? "items_total",
    section: a.section ?? null,
    rate_bp: a.mode === "percent" ? (a.rateBp ?? null) : null,
    value_minor: a.mode === "amount" ? (a.valueMinor ?? null) : null,
    to_confirm: a.toConfirm ?? false,
    source: a.source ?? "typed",
  };
}

/** Contenu → JSON attendu par app.set_content / app.create_draft_content. */
export function contentJson(content: DraftContent): Record<string, unknown> {
  const { sections, adjustments, clauses, ...fields } = content;
  const body: Record<string, unknown> = { ...fields };
  if (sections) {
    body.sections = sections.map((s) => ({
      title: s.title,
      show_subtotal: s.showSubtotal ?? Boolean(s.title),
      lines: s.lines.map(lineJson),
    }));
  }
  if (adjustments) body.adjustments = adjustments.map(adjustmentJson);
  if (clauses) {
    body.clauses = clauses.map((c) => ("clauseId" in c ? { clause_id: c.clauseId } : { title: c.title ?? null, body: c.body }));
  }
  return body;
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
  createDraftContent(orgId: string, type: string, content: DraftContent, origin?: "chat" | "web"): Promise<string>;
  setContent(orgId: string, docId: string, content: DraftContent): Promise<void>;
  setLines(orgId: string, docId: string, lines: LineInput[]): Promise<void>;
  addLines(orgId: string, docId: string, lines: LineInput[], section?: number | null): Promise<void>;
  addSection(orgId: string, docId: string, section: SectionInput): Promise<void>;
  patchSection(orgId: string, docId: string, position: number, patch: { title?: string | null; showSubtotal?: boolean }): Promise<void>;
  removeSection(orgId: string, docId: string, position: number): Promise<void>;
  patchLine(orgId: string, docId: string, position: number, patch: Partial<Omit<LineInput, "toConfirm" | "source">>): Promise<void>;
  removeLine(orgId: string, docId: string, position: number): Promise<void>;
  addAdjustment(orgId: string, docId: string, adjustment: AdjustmentInput): Promise<void>;
  patchAdjustment(orgId: string, docId: string, position: number, patch: Partial<AdjustmentInput>): Promise<void>;
  removeAdjustment(orgId: string, docId: string, position: number): Promise<void>;
  updateDraft(orgId: string, docId: string, patch: DraftFields): Promise<void>;
  setClient(orgId: string, docId: string, name: string | null, details?: Record<string, string | null>): Promise<void>;
  issue(orgId: string, docId: string, number?: string | null): Promise<DocumentView>;
  revise(orgId: string, docId: string): Promise<string>;
  convert(orgId: string, docId: string, type?: string): Promise<string>;
  duplicate(orgId: string, docId: string): Promise<string>;
  cancel(orgId: string, docId: string): Promise<void>;
  decide(orgId: string, docId: string, decision: "accepted" | "refused" | "no_response", note?: string | null): Promise<void>;
  share(orgId: string, docId: string): Promise<{ token: string; expiresAt: string }>;
  markShared(orgId: string, docId: string, via: string): Promise<void>;
  recordPayment(orgId: string, docId: string, amountMinor: string, paidOn?: string | null, method?: string | null, note?: string | null): Promise<string>;
  issueReceipt(orgId: string, paymentId: string): Promise<string>;
  get(orgId: string, docId: string): Promise<DocumentView>;
  getAny(docId: string): Promise<DocumentView>;
  list(orgId: string, filters?: DocumentFilters): Promise<{ items: DocumentSummary[]; total: number }>;
  currentDraft(orgId: string): Promise<string | null>;
  lastIssued(orgId: string, types?: string[]): Promise<string | null>;
  latest(orgId: string): Promise<string | null>;
  findByNumber(orgId: string, number: string): Promise<string | null>;
  entitlement(orgId: string): Promise<Entitlement | null>;
  publicDocument(token: string): Promise<DocumentView>;
  clientDecision(token: string, decision: "accepted" | "refused", note?: string | null): Promise<DocumentView>;
  clauses(orgId: string): Promise<Clause[]>;
  saveClause(orgId: string, id: string | null, patch: Partial<Omit<Clause, "id">>): Promise<string>;
  setDocumentClauses(orgId: string, docId: string, clauses: NonNullable<DraftContent["clauses"]>): Promise<void>;
  numbering(orgId: string): Promise<Numbering[]>;
  setNumbering(orgId: string, type: string, patch: Partial<Omit<Numbering, "type" | "preview">>): Promise<Numbering>;
}

const VIEW_SQL = `
  select d.*, dt.labels as type_labels, dt.acceptable, dt.payable,
         cu.minor_units, cu.symbol, cu.symbol_before, cu.thousands_separator, cu.decimal_separator,
         c.name as c_name, c.phone as c_phone, c.email as c_email, c.address as c_address, c.legal_id as c_legal_id,
         src.number as source_number, src.type_code as source_type,
         v.first_viewed_at, v.last_viewed_at, v.view_count,
         app.issue_blockers(d.org_id, d.id) as blockers
  from public.documents d
  join public.document_types dt on dt.code = d.type_code
  join public.currencies cu on cu.code = d.currency_code
  left join public.clients c on c.id = d.client_id
  left join public.documents src on src.id = d.source_document_id
  left join public.document_views v on v.document_id = d.id
  where d.id = $1`;

type Row = Record<string, any>;

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString?.() ?? null;
}

function toLine(l: Row): DocumentLine {
  return {
    position: l.position,
    sectionPosition: l.section_position,
    kind: l.kind,
    label: l.label,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unitPriceMinor: l.unit_price_minor,
    flatAmountMinor: l.flat_amount_minor,
    lineTotalMinor: l.line_total_minor,
    toConfirm: l.to_confirm,
    source: l.source,
  };
}

function toView(row: Row, sections: Row[], lines: Row[], adjustments: Row[], clauses: Row[], payments: Row[]): DocumentView {
  const snapshot = row.client_snapshot as Record<string, string | null> | null;
  const label = (labels: Record<string, string>) => labels[row.locale] ?? labels.fr ?? Object.values(labels)[0] ?? "";
  const allLines = lines.map(toLine);
  return {
    id: row.id,
    orgId: row.org_id,
    type: row.type_code,
    typeLabel: label(row.type_labels),
    status: row.status,
    number: row.number,
    manualNumber: row.manual_number,
    revision: row.revision,
    rootDocumentId: row.root_document_id,
    title: row.title,
    summary: row.summary,
    site: row.site,
    deliveryText: row.delivery_text,
    warrantyText: row.warranty_text,
    assumptions: row.assumptions,
    notes: row.notes,
    validityDays: row.validity_days,
    depositBp: row.deposit_bp,
    locale: row.locale,
    template: row.template_code,
    templateVersion: row.template_version,
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
    expired: ["issued", "no_response"].includes(row.status) && row.valid_until != null && isoDate(row.valid_until) < isoDate(new Date()),
    applyTax: row.apply_tax,
    taxLabel: row.tax_label,
    taxRateBp: row.tax_rate_bp,
    subtotalMinor: row.subtotal_minor,
    adjustmentsTotalMinor: row.adjustments_total_minor,
    taxableMinor: row.taxable_minor,
    taxMinor: row.tax_minor,
    totalMinor: row.total_minor,
    depositMinor: row.deposit_minor,
    paidMinor: row.paid_minor,
    sourceDocumentId: row.source_document_id,
    sourceNumber: row.source_number,
    sourceType: row.source_type,
    revisesId: row.revises_id,
    acceptable: row.acceptable,
    payable: row.payable,
    renderVersion: row.render_version,
    sharedAt: iso(row.shared_at),
    viewedAt: iso(row.viewed_at),
    views: row.view_count ? { first: iso(row.first_viewed_at)!, last: iso(row.last_viewed_at)!, count: row.view_count } : null,
    decidedAt: iso(row.decided_at),
    decisionBy: row.decision_by,
    decisionNote: row.decision_note,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    issuedAt: iso(row.issued_at),
    sections: sections.map((s) => ({
      position: s.position,
      title: s.title,
      showSubtotal: s.show_subtotal,
      subtotalMinor: s.subtotal_minor,
      lines: allLines.filter((l) => l.sectionPosition === s.position),
    })),
    lines: allLines,
    adjustments: adjustments.map((a) => ({
      position: a.position,
      label: a.label,
      mode: a.mode,
      sign: a.sign,
      base: a.base,
      sectionPosition: a.section_position,
      rateBp: a.rate_bp,
      valueMinor: a.value_minor,
      baseMinor: a.base_minor,
      amountMinor: a.amount_minor,
      toConfirm: a.to_confirm,
      source: a.source,
    })),
    clauses: clauses.map((c) => ({ position: c.position, clauseId: c.clause_id, title: c.title, body: c.body })),
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

function linePatchJson(patch: Partial<Omit<LineInput, "toConfirm" | "source">>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.label !== undefined) body.label = patch.label;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.quantity !== undefined) body.quantity = patch.quantity;
  if (patch.unit !== undefined) body.unit = patch.unit;
  if (patch.unitPriceMinor !== undefined) body.unit_price_minor = patch.unitPriceMinor;
  if (patch.flatAmountMinor !== undefined) body.flat_amount_minor = patch.flatAmountMinor;
  if (patch.kind !== undefined) body.kind = patch.kind;
  return body;
}

function adjustmentPatchJson(patch: Partial<AdjustmentInput>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (patch.label !== undefined) body.label = patch.label;
  if (patch.mode !== undefined) body.mode = patch.mode;
  if (patch.sign !== undefined) body.sign = patch.sign;
  if (patch.base !== undefined) body.base = patch.base;
  if (patch.section !== undefined) body.section = patch.section;
  if (patch.rateBp !== undefined) body.rate_bp = patch.rateBp;
  if (patch.valueMinor !== undefined) body.value_minor = patch.valueMinor;
  return body;
}

function toNumbering(r: Row): Numbering {
  return {
    type: r.type_code,
    prefix: r.prefix,
    separator: r.separator,
    includeYear: r.include_year,
    width: r.width,
    cadence: r.cadence,
    preview: r.preview,
  };
}

export function pgDocumentStore(pool: pg.Pool, options: { shareSecret: string }): DocumentStore {
  const db: Db = pool;

  async function load(docId: string, orgId?: string): Promise<DocumentView> {
    const row = await sqlOne<Row>(db, VIEW_SQL, [docId]);
    if (orgId && row.org_id !== orgId) {
      throw httpErrors.notFound("document introuvable");
    }
    const [sections, lines, adjustments, clauses, payments] = await Promise.all([
      sql<Row>(db, "select * from public.document_sections where document_id = $1 order by position", [docId]),
      sql<Row>(
        db,
        `select l.*, s.position as section_position from public.document_lines l
         join public.document_sections s on s.id = l.section_id
         where l.document_id = $1 order by l.position`,
        [docId],
      ),
      sql<Row>(
        db,
        `select a.*, s.position as section_position from public.document_adjustments a
         left join public.document_sections s on s.id = a.section_id
         where a.document_id = $1 order by a.position`,
        [docId],
      ),
      sql<Row>(db, "select * from public.document_clauses where document_id = $1 order by position", [docId]),
      sql<Row>(db, "select * from public.document_payments where document_id = $1 order by paid_on, created_at", [docId]),
    ]);
    return toView(row, sections, lines, adjustments, clauses, payments);
  }

  async function numberingFor(orgId: string, type: string): Promise<Numbering> {
    const r = await sqlOne<Row>(
      db,
      "select (n).*, app.preview_number($1, $2) as preview from (select app.numbering($1, $2) as n) x",
      [orgId, type],
    );
    return toNumbering(r);
  }

  const store: DocumentStore = {
    async createDraft(orgId, type, lines, origin = "chat", title = null) {
      return store.createDraftContent(orgId, type, { title, sections: lines.length ? [{ title: null, lines }] : [] }, origin);
    },
    async createDraftContent(orgId, type, content, origin = "chat") {
      const r = await sqlOne<{ id: string }>(db, "select app.create_draft_content($1, $2, $3::jsonb, $4) as id", [
        orgId, type, JSON.stringify(contentJson(content)), origin,
      ]);
      return r.id;
    },
    async setContent(orgId, docId, content) {
      await sql(db, "select app.set_content($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(contentJson(content))]);
    },
    async setLines(orgId, docId, lines) {
      await sql(db, "select app.set_lines($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(lines.map(lineJson))]);
    },
    async addLines(orgId, docId, lines, section = null) {
      await sql(db, "select app.add_lines($1, $2, $3::jsonb, $4)", [orgId, docId, JSON.stringify(lines.map(lineJson)), section]);
    },
    async addSection(orgId, docId, section) {
      await sql(db, "select app.add_section($1, $2, $3::jsonb)", [
        orgId, docId,
        JSON.stringify({ title: section.title, show_subtotal: section.showSubtotal ?? Boolean(section.title), lines: section.lines.map(lineJson) }),
      ]);
    },
    async patchSection(orgId, docId, position, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.showSubtotal !== undefined) body.show_subtotal = patch.showSubtotal;
      await sql(db, "select app.patch_section($1, $2, $3, $4::jsonb)", [orgId, docId, position, JSON.stringify(body)]);
    },
    async removeSection(orgId, docId, position) {
      await sql(db, "select app.remove_section($1, $2, $3)", [orgId, docId, position]);
    },
    async patchLine(orgId, docId, position, patch) {
      await sql(db, "select app.patch_line($1, $2, $3, $4::jsonb)", [orgId, docId, position, JSON.stringify(linePatchJson(patch))]);
    },
    async removeLine(orgId, docId, position) {
      await sql(db, "select app.remove_line($1, $2, $3)", [orgId, docId, position]);
    },
    async addAdjustment(orgId, docId, adjustment) {
      await sql(db, "select app.add_adjustment($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(adjustmentJson(adjustment))]);
    },
    async patchAdjustment(orgId, docId, position, patch) {
      await sql(db, "select app.patch_adjustment($1, $2, $3, $4::jsonb)", [orgId, docId, position, JSON.stringify(adjustmentPatchJson(patch))]);
    },
    async removeAdjustment(orgId, docId, position) {
      await sql(db, "select app.remove_adjustment($1, $2, $3)", [orgId, docId, position]);
    },
    async updateDraft(orgId, docId, patch) {
      await sql(db, "select app.update_draft($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(patch)]);
    },
    async setClient(orgId, docId, name, details = {}) {
      await sql(db, "select app.set_document_client($1, $2, $3, $4::jsonb)", [orgId, docId, name, JSON.stringify(details)]);
    },
    async issue(orgId, docId, number = null) {
      await sql(db, "select app.issue_document($1, $2, $3)", [orgId, docId, number]);
      return load(docId, orgId);
    },
    async revise(orgId, docId) {
      return (await sqlOne<{ id: string }>(db, "select app.revise_document($1, $2) as id", [orgId, docId])).id;
    },
    async convert(orgId, docId, type = "invoice") {
      return (await sqlOne<{ id: string }>(db, "select app.convert_document($1, $2, $3) as id", [orgId, docId, type])).id;
    },
    async duplicate(orgId, docId) {
      return (await sqlOne<{ id: string }>(db, "select app.duplicate_document($1, $2) as id", [orgId, docId])).id;
    },
    async cancel(orgId, docId) {
      await sql(db, "select app.cancel_document($1, $2)", [orgId, docId]);
    },
    async decide(orgId, docId, decision, note = null) {
      await sql(db, "select app.decide_document($1, $2, $3, $4)", [orgId, docId, decision, note]);
    },
    async share(orgId, docId) {
      // Jeton dérivé (QR code, chat, web) ; la base n'en garde que l'empreinte.
      const token = shareToken(options.shareSecret, docId);
      const r = await sqlOne<{ expires: Date }>(db, "select app.share_document($1, $2, $3) as expires", [orgId, docId, tokenHash(token)]);
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
        const p = `$${values.length}`;
        where.push(`(lower(coalesce(d.number, '')) like ${p} or lower(coalesce(d.client_snapshot ->> 'name', c.name, '')) like ${p}
          or lower(coalesce(d.title, '')) like ${p} or lower(coalesce(d.site, '')) like ${p}
          or exists (select 1 from public.document_lines l where l.document_id = d.id and lower(l.label) like ${p}))`);
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
                d.title, coalesce(d.client_snapshot ->> 'name', c.name) as client_name, d.total_minor, d.paid_minor,
                d.currency_code, d.issue_date, d.valid_until, d.created_at, d.updated_at,
                (select count(*)::int from public.document_lines l where l.document_id = d.id) as line_count,
                (select count(*)::int from public.document_sections s where s.document_id = d.id) as section_count
         ${base} order by d.updated_at desc limit $${values.length - 1} offset $${values.length}`,
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
          title: r.title,
          clientName: r.client_name,
          totalMinor: r.total_minor,
          paidMinor: r.paid_minor,
          currencyCode: r.currency_code,
          issueDate: r.issue_date ? isoDate(r.issue_date) : null,
          validUntil: r.valid_until ? isoDate(r.valid_until) : null,
          createdAt: r.created_at.toISOString(),
          updatedAt: r.updated_at.toISOString(),
          lines: r.line_count,
          sections: r.section_count,
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
    async latest(orgId) {
      const rows = await sql<{ id: string }>(
        db,
        `select id from public.documents where org_id = $1 and status not in ('cancelled', 'replaced') and type_code <> 'receipt'
         order by updated_at desc limit 1`,
        [orgId],
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
    async clauses(orgId) {
      const rows = await sql<Row>(
        db,
        "select * from public.clauses where org_id = $1 and active order by position, created_at",
        [orgId],
      );
      return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, isDefault: r.is_default, position: r.position, active: r.active }));
    },
    async saveClause(orgId, id, patch) {
      const body: Record<string, unknown> = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.body !== undefined) body.body = patch.body;
      if (patch.isDefault !== undefined) body.is_default = patch.isDefault;
      if (patch.position !== undefined) body.position = patch.position;
      if (patch.active !== undefined) body.active = patch.active;
      return (await sqlOne<{ id: string }>(db, "select app.save_clause($1, $2, $3::jsonb) as id", [orgId, id, JSON.stringify(body)])).id;
    },
    async setDocumentClauses(orgId, docId, clauses) {
      const body = clauses.map((c) => ("clauseId" in c ? { clause_id: c.clauseId } : { title: c.title ?? null, body: c.body }));
      await sql(db, "select app.set_document_clauses($1, $2, $3::jsonb)", [orgId, docId, JSON.stringify(body)]);
    },
    async numbering(orgId) {
      const types = await sql<{ code: string }>(
        db,
        "select code from public.document_types where active and code <> 'receipt' order by position",
      );
      return Promise.all(types.map((t) => numberingFor(orgId, t.code)));
    },
    async setNumbering(orgId, type, patch) {
      const body: Record<string, unknown> = {};
      if (patch.prefix !== undefined) body.prefix = patch.prefix;
      if (patch.separator !== undefined) body.separator = patch.separator;
      if (patch.includeYear !== undefined) body.include_year = patch.includeYear;
      if (patch.width !== undefined) body.width = patch.width;
      if (patch.cadence !== undefined) body.cadence = patch.cadence;
      await sql(db, "select app.set_numbering($1, $2, $3::jsonb)", [orgId, type, JSON.stringify(body)]);
      return numberingFor(orgId, type);
    },
  };
  return store;
}
