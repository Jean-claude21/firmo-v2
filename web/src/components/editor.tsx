import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { majorText, money, quantity as formatQty } from "@/lib/format";
import type { DocumentDetail, Me } from "@/lib/portal";
import { useT } from "@/l10n";

// Éditeur d'un brouillon (ART-3). L'artisan tape ses valeurs ; l'API les lit et calcule les totaux.

export interface DraftInput {
  type: string;
  title: string | null;
  notes: string | null;
  template: string;
  applyTax: boolean;
  adjustments: Array<{ label: string; mode: "percent" | "amount"; sign: 1 | -1; base?: string; section?: number | null; value: string | null }>;
  client: { name: string; phone: string | null; email: string | null; address: string | null } | null;
  sections: Array<{ title: string | null; showSubtotal: boolean; lines: Array<{ label: string; description?: string | null; kind?: string; quantity: string | null; unit: string | null; unitPrice: string | null; flatAmount?: string | null }> }>;
}

interface LineState {
  key: number;
  label: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  /** Section d'origine (position) ; les nouvelles lignes vont dans la dernière. */
  section: number | null;
  kind: string;
  description: string | null;
  flatAmount: string;
}

let next = 1;

/** Lignes du formulaire → sections du document (titres et sous-totaux d'origine conservés). */
function groupSections(doc: DocumentDetail | null, lines: LineState[]): DraftInput["sections"] {
  const sections = doc?.sections.length ? doc.sections.map((s) => ({ position: s.position, title: s.title, showSubtotal: s.showSubtotal })) : [{ position: 1, title: null, showSubtotal: false }];
  const last = sections[sections.length - 1]!.position;
  return sections
    .map((s) => ({
      title: s.title,
      showSubtotal: s.showSubtotal,
      lines: lines
        .filter((l) => (l.section ?? last) === s.position)
        .map((l) => ({
          label: l.label.trim(), description: l.description, kind: l.kind,
          quantity: l.kind === "priced" ? l.quantity.trim().replace(",", ".") || null : null,
          unit: l.unit || null,
          unitPrice: l.kind === "priced" ? l.unitPrice.trim() || null : null,
          flatAmount: l.kind === "flat" ? l.flatAmount.trim() || null : null,
        })),
    }))
    .filter((s) => s.lines.length > 0);
}

export function DraftEditor({ me, doc, onSave, saving, error }: { me: Me; doc: DocumentDetail | null; onSave: (input: DraftInput) => void; saving: boolean; error: ApiError | null }) {
  const t = useT();
  const E = t.app.editor;
  const cur = me.currency;
  const [type, setType] = useState(doc?.type ?? "quote");
  const [title, setTitle] = useState(doc?.title ?? "");
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [template, setTemplate] = useState(doc?.template ?? me.org.templateCode);
  const [applyTax, setApplyTax] = useState(doc?.applyTax ?? me.org.taxRegistered);
  // La remise de ce formulaire est l'ajustement négatif du document ; les autres ajustements
  // (main-d'œuvre, transport…) sont conservés tels quels.
  const existingDiscount = doc?.adjustments.find((a) => a.sign === -1) ?? null;
  const [discountMode, setDiscountMode] = useState<"none" | "percent" | "amount">(existingDiscount ? existingDiscount.mode : "none");
  const [discount, setDiscount] = useState(
    existingDiscount?.mode === "percent" && existingDiscount.rateBp ? String(existingDiscount.rateBp / 100).replace(".", cur.decimalSeparator)
      : existingDiscount?.valueMinor ? majorText(existingDiscount.valueMinor, cur) : "");
  const [client, setClient] = useState({ name: doc?.client.name ?? "", phone: doc?.client.phone ?? "", email: doc?.client.email ?? "", address: doc?.client.address ?? "" });
  const [lines, setLines] = useState<LineState[]>(
    doc?.lines.length
      ? doc.lines.map((l) => ({ key: next++, label: l.label, quantity: formatQty(l.quantity, cur.decimalSeparator), unit: l.unit ?? "", unitPrice: majorText(l.unitPriceMinor, cur), section: l.sectionPosition, kind: l.kind, description: l.description, flatAmount: majorText(l.flatAmountMinor, cur) }))
      : [{ key: next++, label: "", quantity: "1", unit: "", unitPrice: "", section: null, kind: "priced", description: null, flatAmount: "" }],
  );
  const fieldError = (name: string) => error?.fields[name];

  const update = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      type,
      title: title.trim() || null,
      notes: notes.trim() || null,
      template,
      applyTax,
      adjustments: [
        ...(doc?.adjustments ?? []).filter((a) => a.sign !== -1).map((a) => ({
          label: a.label, mode: a.mode, sign: a.sign, base: a.base, section: a.sectionPosition,
          value: a.mode === "percent" ? (a.rateBp ? String(a.rateBp / 100) : null) : majorText(a.valueMinor, cur) || null,
        })),
        ...(discountMode !== "none" && discount.trim() ? [{ label: E.discount, mode: discountMode, sign: -1 as const, value: discount.trim() }] : []),
      ],
      client: client.name.trim() ? { name: client.name.trim(), phone: client.phone || null, email: client.email || null, address: client.address || null } : null,
      sections: groupSections(doc, lines.filter((l) => l.label.trim())),
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label={E.type}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {me.reference.documentTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </Field>
        <Field label={E.template}>
          <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
            {me.reference.templates.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label={E.title} optional>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={E.titlePlaceholder} maxLength={200} />
          </Field>
        </div>
      </div>

      <fieldset className="card grid gap-4 p-5 sm:grid-cols-2">
        <legend className="sr-only">{E.client}</legend>
        <p className="font-semibold sm:col-span-2">{E.client}</p>
        <Field label={E.clientName} optional><Input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} maxLength={160} /></Field>
        <Field label={E.clientPhone} optional><Input type="tel" value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} maxLength={32} /></Field>
        <Field label={E.clientEmail} optional><Input type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} /></Field>
        <Field label={E.clientAddress} optional><Input value={client.address} onChange={(e) => setClient({ ...client, address: e.target.value })} maxLength={300} /></Field>
      </fieldset>

      <section className="card p-5">
        <p className="mb-3 font-semibold">{E.lines}</p>
        <div className="space-y-4">
          <datalist id="firmo-units">{me.reference.units.map((u) => <option key={u.code} value={u.short} />)}</datalist>
          {lines.map((l, i) => {
            const saved = doc?.lines[i];
            return (
              <div key={l.key} className="grid grid-cols-6 gap-2 rounded-[var(--radius-field)] border border-line p-3 sm:grid-cols-12 sm:border-0 sm:p-0">
                <div className="col-span-6 sm:col-span-5">
                  <Field label={`${i + 1}. ${E.label}`} error={fieldError(`lines.${i}.label`)}>
                    <Input value={l.label} onChange={(e) => update(l.key, { label: e.target.value })} maxLength={300} />
                  </Field>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Field label={E.quantity} error={fieldError(`lines.${i}.quantity`)}>
                    <Input inputMode="decimal" value={l.kind === "priced" ? l.quantity : ""} onChange={(e) => update(l.key, { quantity: e.target.value })} className="text-right" disabled={l.kind !== "priced"} />
                  </Field>
                </div>
                <div className="col-span-4 sm:col-span-2">
                  <Field label={E.unit}>
                    {/* Unité telle que l'artisan l'écrit (« barre », « m² ») ; la liste ne fait que proposer. */}
                    <Input value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} maxLength={24} list="firmo-units" disabled={l.kind !== "priced"} />
                  </Field>
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <Field label={`${E.unitPrice} (${cur.symbol})`} error={fieldError(`lines.${i}.unitPrice`)}>
                    {/* Ligne au forfait : le montant de la ligne ; ligne descriptive : aucun montant. */}
                    <Input inputMode="decimal" value={l.kind === "flat" ? l.flatAmount : l.unitPrice} disabled={l.kind === "text"}
                      onChange={(e) => update(l.key, l.kind === "flat" ? { flatAmount: e.target.value } : { unitPrice: e.target.value })} className="text-right tabular-nums" />
                  </Field>
                </div>
                <div className="col-span-2 flex items-end justify-end sm:col-span-1">
                  <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} disabled={lines.length === 1} aria-label={E.removeLine} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-30">
                    <Trash2 className="size-4" />
                  </button>
                </div>
                {saved?.lineTotalMinor && saved.label === l.label && (
                  <p className="col-span-6 text-right text-sm text-muted sm:col-span-12">{E.lineTotal} : {money(saved.lineTotalMinor, cur)}</p>
                )}
              </div>
            );
          })}
        </div>
        <Button type="button" variant="outline" className="mt-4" icon={<Plus className="size-4" />} onClick={() => setLines((ls) => [...ls, { key: next++, label: "", quantity: "1", unit: "", unitPrice: "", section: null, kind: "priced", description: null, flatAmount: "" }])}>
          {E.addLine}
        </Button>
      </section>

      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label={E.discount}>
          <div className="flex gap-2">
            <Select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as typeof discountMode)} className="w-40 shrink-0">
              <option value="none">{E.noDiscount}</option>
              <option value="percent">{E.discountPercent}</option>
              <option value="amount">{E.discountAmount}</option>
            </Select>
            {discountMode !== "none" && <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} aria-label={E.discount} />}
          </div>
        </Field>
        {me.reference.taxes.length > 0 && (
          <label className="flex min-h-11 items-center gap-3 self-end">
            <input type="checkbox" className="size-5 accent-ink" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} />
            <span>{E.tax}</span>
          </label>
        )}
        <div className="sm:col-span-2">
          <Field label={E.notes} optional>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={E.notesPlaceholder} maxLength={1000} />
          </Field>
        </div>
      </section>

      {doc && (
        <div className="card flex items-center justify-between p-5">
          <span className="text-muted">{E.total}</span>
          <span className="text-xl font-bold tabular-nums">{money(doc.totalMinor, cur)}</span>
        </div>
      )}
      <p className="text-sm text-muted">{E.totalsNote}</p>
      {error && !Object.keys(error.fields).length && <Notice tone="warn">{error.message}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={saving}>{E.saveDraft}</Button>
      </div>
    </form>
  );
}
