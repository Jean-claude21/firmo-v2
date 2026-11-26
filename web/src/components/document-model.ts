import { type Currency, majorText, quantity as formatQty } from "@/lib/format";
import type { DocumentDetail } from "@/lib/portal";

// Le document tel que l'artisan le tape (textes), envoyé tel quel à l'API qui lit, vérifie et
// calcule (constitution III). Le web ne calcule aucun montant : les totaux reviennent du serveur.

export type LineKind = "priced" | "flat" | "text";

export interface LineDraft {
  key: number;
  label: string;
  description: string;
  kind: LineKind;
  quantity: string;
  unit: string;
  unitPrice: string;
  flatAmount: string;
}

export interface SectionDraft {
  key: number;
  title: string;
  showSubtotal: boolean;
  lines: LineDraft[];
}

export interface AdjustmentDraft {
  key: number;
  label: string;
  mode: "percent" | "amount";
  sign: 1 | -1;
  /** « items_total » ou la position (1…) d'une section. */
  base: "items_total" | number;
  value: string;
}

export interface DocDraft {
  type: string;
  title: string;
  site: string;
  summary: string;
  deliveryText: string;
  warrantyText: string;
  assumptions: string;
  notes: string;
  validityDays: string;
  depositPercent: string;
  template: string;
  applyTax: boolean;
  client: { name: string; phone: string; email: string; address: string };
  sections: SectionDraft[];
  adjustments: AdjustmentDraft[];
  clauses: Array<{ key: number; clauseId: string | null; title: string | null; body: string }>;
}

let seq = 1;
export const nextKey = () => seq++;

export function emptyLine(kind: LineKind = "priced"): LineDraft {
  return { key: nextKey(), label: "", description: "", kind, quantity: kind === "priced" ? "1" : "", unit: "", unitPrice: "", flatAmount: "" };
}

export function percentText(bp: number | null, sep: string): string {
  if (bp === null) return "";
  return String(bp / 100).replace(".", sep);
}

export function fromDocument(doc: DocumentDetail, cur: Currency): DocDraft {
  return {
    type: doc.type,
    title: doc.title ?? "",
    site: doc.site ?? "",
    summary: doc.summary ?? "",
    deliveryText: doc.deliveryText ?? "",
    warrantyText: doc.warrantyText ?? "",
    assumptions: doc.assumptions ?? "",
    notes: doc.notes ?? "",
    validityDays: doc.validityDays ? String(doc.validityDays) : "",
    depositPercent: percentText(doc.depositBp, cur.decimalSeparator),
    template: doc.template,
    applyTax: doc.applyTax,
    client: { name: doc.client.name ?? "", phone: doc.client.phone ?? "", email: doc.client.email ?? "", address: doc.client.address ?? "" },
    sections: (doc.sections.length ? doc.sections : [{ position: 1, title: null, showSubtotal: false, subtotalMinor: "0", lines: [] }]).map((s) => ({
      key: nextKey(),
      title: s.title ?? "",
      showSubtotal: s.showSubtotal,
      lines: s.lines.map((l) => ({
        key: nextKey(),
        label: l.label,
        description: l.description ?? "",
        kind: l.kind,
        quantity: formatQty(l.quantity, cur.decimalSeparator),
        unit: l.unit ?? "",
        unitPrice: majorText(l.unitPriceMinor, cur),
        flatAmount: majorText(l.flatAmountMinor, cur),
      })),
    })),
    adjustments: doc.adjustments.map((a) => ({
      key: nextKey(),
      label: a.label,
      mode: a.mode,
      sign: a.sign,
      base: a.base === "section" && a.sectionPosition ? a.sectionPosition : "items_total",
      value: a.mode === "percent" ? percentText(a.rateBp, cur.decimalSeparator) : majorText(a.valueMinor, cur),
    })),
    clauses: doc.clauses.map((c) => ({ key: nextKey(), clauseId: c.clauseId, title: c.title, body: c.body })),
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

/** Corps du PUT /v1/portal/documents/:id. Les lignes sans libellé ne partent pas. */
export function toInput(d: DocDraft) {
  const sections = d.sections
    .map((s) => ({
      title: orNull(s.title),
      showSubtotal: s.showSubtotal,
      lines: s.lines
        .filter((l) => l.label.trim())
        .map((l) => ({
          label: l.label.trim(),
          description: orNull(l.description),
          kind: l.kind,
          quantity: l.kind === "priced" ? (orNull(l.quantity)?.replace(",", ".") ?? null) : null,
          unit: l.kind === "priced" ? orNull(l.unit) : null,
          unitPrice: l.kind === "priced" ? orNull(l.unitPrice) : null,
          flatAmount: l.kind === "flat" ? orNull(l.flatAmount) : null,
        })),
    }))
    .filter((s) => s.lines.length || s.title);
  // Positions des sections envoyées (celles qui restent) : un ajustement sur une section la suit.
  const kept = d.sections.filter((s) => s.lines.some((l) => l.label.trim()) || s.title.trim());
  return {
    type: d.type,
    title: orNull(d.title),
    site: orNull(d.site),
    summary: orNull(d.summary),
    deliveryText: orNull(d.deliveryText),
    warrantyText: orNull(d.warrantyText),
    assumptions: orNull(d.assumptions),
    notes: orNull(d.notes),
    validityDays: d.validityDays.trim() && /^\d+$/.test(d.validityDays.trim()) ? Number(d.validityDays.trim()) : null,
    depositPercent: orNull(d.depositPercent),
    template: d.template,
    applyTax: d.applyTax,
    client: d.client.name.trim() ? { name: d.client.name.trim(), phone: orNull(d.client.phone), email: orNull(d.client.email), address: orNull(d.client.address) } : null,
    sections,
    adjustments: d.adjustments
      .filter((a) => a.label.trim())
      .map((a) => {
        const sectionIndex = typeof a.base === "number" ? kept.indexOf(d.sections[a.base - 1]!) + 1 : 0;
        return {
          label: a.label.trim(),
          mode: a.mode,
          sign: a.sign,
          base: sectionIndex > 0 ? ("section" as const) : ("items_total" as const),
          section: sectionIndex > 0 ? sectionIndex : null,
          value: orNull(a.value),
        };
      }),
    clauses: d.clauses.map((c) => (c.clauseId ? { clauseId: c.clauseId } : { title: c.title, body: c.body })),
  };
}
