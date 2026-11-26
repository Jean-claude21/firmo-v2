import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronUp, Loader2, MoreVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { type AdjustmentDraft, type DocDraft, emptyLine, type LineDraft, type LineKind, nextKey, type SectionDraft } from "@/components/document-model";
import { type Currency, figure, quantity as formatQty } from "@/lib/format";
import type { DocumentDetail, Me } from "@/lib/portal";
import { useI18n } from "@/l10n";

// Détail, conditions et totaux d'un document (P-63, maquette v1 « client/editor »). En brouillon,
// tout s'édite et part tout seul ; une fois émis, la même page se lit sans rien modifier.

type Server = DocumentDetail;

/** Montant serveur d'une ligne locale : même ordre de lignes nommées dans les sections gardées. */
function serverLine(server: Server, d: DocDraft, sIdx: number, lIdx: number) {
  const keptSections = d.sections.map((s, i) => ({ s, i })).filter(({ s }) => s.lines.some((l) => l.label.trim()) || s.title.trim());
  const pos = keptSections.findIndex(({ i }) => i === sIdx);
  if (pos < 0) return null;
  const named = d.sections[sIdx]!.lines.slice(0, lIdx + 1).filter((l) => l.label.trim()).length - 1;
  if (!d.sections[sIdx]!.lines[lIdx]!.label.trim()) return null;
  return server.sections[pos]?.lines[named] ?? null;
}

function serverSection(server: Server, d: DocDraft, sIdx: number) {
  const keptSections = d.sections.map((s, i) => ({ s, i })).filter(({ s }) => s.lines.some((l) => l.label.trim()) || s.title.trim());
  const pos = keptSections.findIndex(({ i }) => i === sIdx);
  return pos < 0 ? null : (server.sections[pos] ?? null);
}

export function Amount({ minor, cur, strong = false }: { minor: string | null | undefined; cur: Currency; strong?: boolean }) {
  if (minor === null || minor === undefined) return <span className="font-mono text-[14px] text-muted">—</span>;
  return (
    <span className={`whitespace-nowrap font-mono ${strong ? "text-[16px] font-semibold" : "text-[15px]"}`}>
      {figure(minor, cur)} <span className="text-[11px] font-normal text-muted">{cur.symbol}</span>
    </span>
  );
}

// ---------------------------------------------------------------- ligne

function LineEditor({ line, onChange, onRemove, onMove, cur, units, canUp, canDown, onClose }: {
  line: LineDraft; onChange: (l: LineDraft) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void; onClose: () => void;
  cur: Currency; units: Me["reference"]["units"]; canUp: boolean; canDown: boolean;
}) {
  const { t } = useI18n();
  const E = t.app.editor;
  const set = (patch: Partial<LineDraft>) => onChange({ ...line, ...patch });
  const kinds: Array<{ k: LineKind; label: string }> = [{ k: "priced", label: E.kindPriced }, { k: "flat", label: E.kindFlat }, { k: "text", label: E.kindText }];
  return (
    <div className="space-y-3 border-y border-ink/20 bg-surface px-4 py-4 sm:px-6">
      <Field label={E.label}><Input autoFocus value={line.label} onChange={(e) => set({ label: e.target.value })} maxLength={300} /></Field>
      <Field label={E.description} optional><Input value={line.description} onChange={(e) => set({ description: e.target.value })} maxLength={300} placeholder={E.descriptionPlaceholder} /></Field>
      <div role="radiogroup" aria-label={E.kind} className="grid grid-cols-3 gap-1 rounded-[var(--radius-field)] border-[1.5px] border-line p-1">
        {kinds.map((k) => (
          <button key={k.k} type="button" role="radio" aria-checked={line.kind === k.k} onClick={() => set({ kind: k.k })}
            className={`min-h-10 rounded-[3px] text-[14px] font-semibold ${line.kind === k.k ? "bg-ink text-paper" : "text-ink-soft hover:bg-paper"}`}>
            {k.label}
          </button>
        ))}
      </div>
      {line.kind === "priced" && (
        <div className="grid grid-cols-6 gap-2">
          <div className="col-span-2"><Field label={E.quantity}><Input inputMode="decimal" value={line.quantity} onChange={(e) => set({ quantity: e.target.value })} className="text-right font-mono" /></Field></div>
          <div className="col-span-4"><Field label={E.unit} optional><Input value={line.unit} onChange={(e) => set({ unit: e.target.value })} maxLength={24} list="firmo-units" /></Field></div>
          <div className="col-span-6"><Field label={`${E.unitPrice} (${cur.symbol})`}><Input inputMode="decimal" value={line.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} className="text-right font-mono" /></Field></div>
        </div>
      )}
      {line.kind === "flat" && <Field label={`${E.flatAmount} (${cur.symbol})`}><Input inputMode="decimal" value={line.flatAmount} onChange={(e) => set({ flatAmount: e.target.value })} className="text-right font-mono" /></Field>}
      <datalist id="firmo-units">{units.map((u) => <option key={u.code} value={u.short} />)}</datalist>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-field)] bg-ink px-4 font-semibold text-paper"><Check className="size-4" aria-hidden /> {E.done}</button>
        <button type="button" onClick={() => onMove(-1)} disabled={!canUp} aria-label={E.moveUp} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] border-[1.5px] border-line disabled:opacity-30"><ArrowUp className="size-4" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={!canDown} aria-label={E.moveDown} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] border-[1.5px] border-line disabled:opacity-30"><ArrowDown className="size-4" /></button>
        <button type="button" onClick={onRemove} className="ml-auto inline-flex min-h-11 items-center gap-2 px-3 font-semibold text-danger"><Trash2 className="size-4" aria-hidden /> {E.removeLine}</button>
      </div>
    </div>
  );
}

function LineRow({ line, total, cur, toConfirm, onEdit, readOnly }: { line: LineDraft; total: string | null | undefined; cur: Currency; toConfirm?: string[]; onEdit?: () => void; readOnly: boolean }) {
  const { t } = useI18n();
  const E = t.app.editor;
  const missing = line.kind === "priced" && (!line.unitPrice.trim() || !line.quantity.trim());
  const sub = line.kind === "priced"
    ? `${line.quantity || "?"}${line.unit ? ` ${line.unit}` : ""} × ${line.unitPrice ? `${line.unitPrice} ${cur.symbol}` : E.toComplete}`
    : line.kind === "flat" ? E.kindFlat : E.kindText;
  return (
    <div className="flex min-h-[68px] items-center gap-3 border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-semibold leading-6">{line.label || <span className="text-muted">{E.untitledLine}</span>}</p>
        {line.description && <p className="text-[14px] text-ink-soft">{line.description}</p>}
        <p className={`text-[14px] ${missing ? "font-semibold text-warn" : "text-muted"}`}>{sub}{toConfirm?.length ? ` · ${E.toConfirm}` : ""}</p>
      </div>
      {line.kind !== "text" && <Amount minor={total} cur={cur} />}
      {!readOnly && (
        <button type="button" onClick={onEdit} aria-label={`${E.editLine} ${line.label}`} className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5">
          <Pencil className="size-[18px]" aria-hidden />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- section

function SectionBlock({ draft, sIdx, server, cur, me, readOnly, update, editing, setEditing }: {
  draft: DocDraft; sIdx: number; server: Server; cur: Currency; me: Me; readOnly: boolean;
  update: (fn: (d: DocDraft) => DocDraft) => void; editing: number | null; setEditing: (k: number | null) => void;
}) {
  const { t } = useI18n();
  const E = t.app.editor;
  const section = draft.sections[sIdx]!;
  const srv = serverSection(server, draft, sIdx);
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const many = draft.sections.length > 1;
  const setSection = (patch: Partial<SectionDraft>) => update((d) => ({ ...d, sections: d.sections.map((s, i) => (i === sIdx ? { ...s, ...patch } : s)) }));
  const setLines = (fn: (ls: LineDraft[]) => LineDraft[]) => setSection({ lines: fn(section.lines) });
  const moveSection = (dir: -1 | 1) => update((d) => {
    const s = [...d.sections];
    const [x] = s.splice(sIdx, 1);
    s.splice(sIdx + dir, 0, x!);
    return { ...d, sections: s };
  });

  return (
    <section>
      {(many || section.title) && (
        <div className="flex min-h-[64px] items-center gap-2 border-b border-line bg-paper-alt px-4 sm:px-6">
          {renaming && !readOnly ? (
            <Input autoFocus value={section.title} onChange={(e) => setSection({ title: e.target.value })} onBlur={() => setRenaming(false)} onKeyDown={(e) => e.key === "Enter" && setRenaming(false)} maxLength={160} aria-label={E.sectionTitle} className="min-h-10 flex-1" />
          ) : (
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left" aria-expanded={open}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold">{section.title || E.untitledSection}</p>
                <p className="text-[13px] text-muted">{E.lineCount(section.lines.filter((l) => l.label.trim()).length)}</p>
              </div>
              {!open && <Amount minor={srv?.subtotalMinor} cur={cur} />}
              {open ? <ChevronUp className="size-5 shrink-0 text-muted" aria-hidden /> : <ChevronDown className="size-5 shrink-0 text-muted" aria-hidden />}
            </button>
          )}
          {!readOnly && (
            <div className="relative">
              <button type="button" onClick={() => setMenu((m) => !m)} aria-label={E.sectionMenu} aria-expanded={menu} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5"><MoreVertical className="size-5" aria-hidden /></button>
              {menu && (
                <div className="absolute right-0 top-11 z-20 w-64 border border-line bg-surface py-1" role="menu" onClick={() => setMenu(false)}>
                  <button type="button" role="menuitem" className="flex min-h-11 w-full items-center px-4 text-left hover:bg-paper" onClick={() => setRenaming(true)}>{E.renameSection}</button>
                  <button type="button" role="menuitem" className="flex min-h-11 w-full items-center px-4 text-left hover:bg-paper" onClick={() => setSection({ showSubtotal: !section.showSubtotal })}>{section.showSubtotal ? E.hideSubtotal : E.showSubtotal}</button>
                  {sIdx > 0 && <button type="button" role="menuitem" className="flex min-h-11 w-full items-center px-4 text-left hover:bg-paper" onClick={() => moveSection(-1)}>{E.moveUp}</button>}
                  {sIdx < draft.sections.length - 1 && <button type="button" role="menuitem" className="flex min-h-11 w-full items-center px-4 text-left hover:bg-paper" onClick={() => moveSection(1)}>{E.moveDown}</button>}
                  {many && <button type="button" role="menuitem" className="flex min-h-11 w-full items-center border-t border-line px-4 text-left text-danger hover:bg-danger-soft" onClick={() => confirm(E.removeSectionConfirm) && update((d) => ({ ...d, sections: d.sections.filter((_, i) => i !== sIdx), adjustments: d.adjustments.filter((a) => a.base !== sIdx + 1) }))}>{E.removeSection}</button>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      {open && (
        <>
          {section.lines.map((l, lIdx) => {
            const srvLine = serverLine(server, draft, sIdx, lIdx);
            return editing === l.key && !readOnly ? (
              <LineEditor
                key={l.key}
                line={l}
                cur={cur}
                units={me.reference.units}
                canUp={lIdx > 0}
                canDown={lIdx < section.lines.length - 1}
                onChange={(nl) => setLines((ls) => ls.map((x) => (x.key === l.key ? nl : x)))}
                onRemove={() => {
                  setLines((ls) => ls.filter((x) => x.key !== l.key));
                  setEditing(null);
                }}
                onMove={(dir) => setLines((ls) => {
                  const c = [...ls];
                  const [x] = c.splice(lIdx, 1);
                  c.splice(lIdx + dir, 0, x!);
                  return c;
                })}
                onClose={() => setEditing(null)}
              />
            ) : (
              <LineRow key={l.key} line={l} total={srvLine?.lineTotalMinor} toConfirm={srvLine?.toConfirm} cur={cur} readOnly={readOnly} onEdit={() => setEditing(l.key)} />
            );
          })}
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                const l = emptyLine();
                setLines((ls) => [...ls, l]);
                setEditing(l.key);
              }}
              className="flex min-h-14 w-full items-center gap-2 border-b border-line bg-surface px-4 text-[16px] font-semibold sm:px-6"
            >
              <Plus className="size-5" aria-hidden /> {E.addLine}
            </button>
          )}
          {(section.showSubtotal || many) && srv && (
            <div className="flex min-h-12 items-center justify-between border-b border-line bg-paper-alt px-4 sm:px-6">
              <span className="text-[15px] text-ink-soft">{E.subtotalOf(section.title || E.untitledSection)}</span>
              <Amount minor={srv.subtotalMinor} cur={cur} strong />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function DetailTab(props: { draft: DocDraft; server: Server; cur: Currency; me: Me; readOnly: boolean; update: (fn: (d: DocDraft) => DocDraft) => void }) {
  const { t } = useI18n();
  const E = t.app.editor;
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <div>
      {props.draft.sections.map((s, i) => <SectionBlock key={s.key} sIdx={i} editing={editing} setEditing={setEditing} {...props} />)}
      {!props.readOnly && (
        <button
          type="button"
          onClick={() => {
            const line = emptyLine();
            props.update((d) => ({ ...d, sections: [...d.sections, { key: nextKey(), title: E.newSectionTitle(d.sections.length + 1), showSubtotal: true, lines: [line] }] }));
            setEditing(line.key);
          }}
          className="flex min-h-14 w-full items-center gap-2 px-4 text-[16px] font-semibold text-ink-soft sm:px-6"
        >
          <Plus className="size-5" aria-hidden /> {E.addSection}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- conditions

export function ConditionsTab({ draft, update, me, readOnly, clauses }: {
  draft: DocDraft; update: (fn: (d: DocDraft) => DocDraft) => void; me: Me; readOnly: boolean;
  clauses: Array<{ id: string; title: string | null; body: string }>;
}) {
  const { t } = useI18n();
  const E = t.app.editor;
  const set = (patch: Partial<DocDraft>) => update((d) => ({ ...d, ...patch }));
  const setClient = (patch: Partial<DocDraft["client"]>) => update((d) => ({ ...d, client: { ...d.client, ...patch } }));
  const [custom, setCustom] = useState("");
  const chosen = new Set(draft.clauses.filter((c) => c.clauseId).map((c) => c.clauseId));
  return (
    <fieldset disabled={readOnly} className="space-y-6 px-4 py-6 sm:px-6">
      <div className="space-y-4">
        <h3 className="mono-label">{E.client}</h3>
        <Field label={E.clientName} optional><Input value={draft.client.name} onChange={(e) => setClient({ name: e.target.value })} maxLength={160} list="firmo-clients" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={E.clientPhone} optional><Input type="tel" value={draft.client.phone} onChange={(e) => setClient({ phone: e.target.value })} maxLength={32} /></Field>
          <Field label={E.clientEmail} optional><Input type="email" value={draft.client.email} onChange={(e) => setClient({ email: e.target.value })} maxLength={200} /></Field>
        </div>
        <Field label={E.clientAddress} optional><Input value={draft.client.address} onChange={(e) => setClient({ address: e.target.value })} maxLength={300} /></Field>
      </div>
      <div className="space-y-4 border-t border-line pt-6">
        <h3 className="mono-label">{E.workTitle}</h3>
        <Field label={E.site} optional><Input value={draft.site} onChange={(e) => set({ site: e.target.value })} maxLength={200} placeholder={E.sitePlaceholder} /></Field>
        <Field label={E.summary} optional hint={E.summaryHelp}><Input value={draft.summary} onChange={(e) => set({ summary: e.target.value })} maxLength={300} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={E.validity} optional><Input inputMode="numeric" value={draft.validityDays} onChange={(e) => set({ validityDays: e.target.value.replace(/[^\d]/g, "") })} maxLength={3} className="font-mono" /></Field>
          <Field label={E.deposit} optional hint={E.depositHelp}><Input inputMode="decimal" value={draft.depositPercent} onChange={(e) => set({ depositPercent: e.target.value })} maxLength={6} className="font-mono" /></Field>
        </div>
        <Field label={E.delivery} optional><Input value={draft.deliveryText} onChange={(e) => set({ deliveryText: e.target.value })} maxLength={200} placeholder={E.deliveryPlaceholder} /></Field>
        <Field label={E.warranty} optional><Input value={draft.warrantyText} onChange={(e) => set({ warrantyText: e.target.value })} maxLength={200} placeholder={E.warrantyPlaceholder} /></Field>
        <Field label={E.assumptions} optional><Textarea value={draft.assumptions} onChange={(e) => set({ assumptions: e.target.value })} maxLength={1000} /></Field>
        <Field label={E.notes} optional><Textarea value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={1000} /></Field>
      </div>
      <div className="space-y-3 border-t border-line pt-6">
        <h3 className="mono-label">{E.clauses}</h3>
        {clauses.length === 0 && draft.clauses.length === 0 && <p className="text-muted">{E.noClauses}</p>}
        {clauses.map((c) => (
          <label key={c.id} className="flex min-h-11 items-start gap-3">
            <input type="checkbox" className="mt-1 size-5 accent-ink" checked={chosen.has(c.id)}
              onChange={(e) => update((d) => ({ ...d, clauses: e.target.checked ? [...d.clauses, { key: nextKey(), clauseId: c.id, title: c.title, body: c.body }] : d.clauses.filter((x) => x.clauseId !== c.id) }))} />
            <span>{c.title && <strong>{c.title} · </strong>}{c.body}</span>
          </label>
        ))}
        {draft.clauses.filter((c) => !c.clauseId).map((c) => (
          <div key={c.key} className="flex items-start gap-3 border-l-[3px] border-line pl-3">
            <p className="flex-1">{c.body}</p>
            {!readOnly && <button type="button" aria-label={E.removeClause} onClick={() => update((d) => ({ ...d, clauses: d.clauses.filter((x) => x.key !== c.key) }))} className="flex size-10 items-center justify-center text-muted hover:text-danger"><X className="size-4" /></button>}
          </div>
        ))}
        {!readOnly && (
          <div className="flex gap-2">
            <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={E.customClause} maxLength={600} aria-label={E.customClause} />
            <button type="button" disabled={!custom.trim()} onClick={() => {
              update((d) => ({ ...d, clauses: [...d.clauses, { key: nextKey(), clauseId: null, title: null, body: custom.trim() }] }));
              setCustom("");
            }} className="min-h-12 shrink-0 rounded-[var(--radius-field)] border-[1.5px] border-line px-4 font-semibold disabled:opacity-40">{E.add}</button>
          </div>
        )}
      </div>
      <div className="grid gap-4 border-t border-line pt-6 sm:grid-cols-2">
        <Field label={E.template}>
          <Select value={draft.template} onChange={(e) => set({ template: e.target.value })}>
            {me.reference.templates.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </Select>
        </Field>
        {me.reference.taxes.length > 0 && (
          <label className="flex min-h-12 items-center gap-3 self-end">
            <input type="checkbox" className="size-5 accent-ink" checked={draft.applyTax} onChange={(e) => set({ applyTax: e.target.checked })} />
            <span>{E.tax}</span>
          </label>
        )}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- totaux

export function TotalsTab({ draft, server, cur, readOnly, update }: { draft: DocDraft; server: Server; cur: Currency; readOnly: boolean; update: (fn: (d: DocDraft) => DocDraft) => void }) {
  const { t } = useI18n();
  const E = t.app.editor;
  const setAdj = (key: number, patch: Partial<AdjustmentDraft>) => update((d) => ({ ...d, adjustments: d.adjustments.map((a) => (a.key === key ? { ...a, ...patch } : a)) }));
  const row = "flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 sm:px-6";
  return (
    <div>
      <div className={row}><span className="text-ink-soft">{E.itemsTotal}</span><Amount minor={server.subtotalMinor} cur={cur} /></div>
      {draft.adjustments.map((a, i) => {
        const srv = server.adjustments[i];
        return readOnly ? (
          <div key={a.key} className={row}>
            <span>{a.label}{a.mode === "percent" && a.value ? ` (${a.value} %)` : ""}</span>
            <Amount minor={srv?.amountMinor} cur={cur} />
          </div>
        ) : (
          <div key={a.key} className="space-y-2 border-b border-line bg-surface px-4 py-3 sm:px-6">
            <div className="flex gap-2">
              <Input value={a.label} onChange={(e) => setAdj(a.key, { label: e.target.value })} aria-label={E.adjustmentLabel} placeholder={E.adjustmentLabel} maxLength={160} />
              <button type="button" aria-label={E.removeAdjustment} onClick={() => update((d) => ({ ...d, adjustments: d.adjustments.filter((x) => x.key !== a.key) }))} className="flex size-12 shrink-0 items-center justify-center text-muted hover:text-danger"><Trash2 className="size-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Select value={a.sign} onChange={(e) => setAdj(a.key, { sign: Number(e.target.value) as 1 | -1 })} aria-label={E.adjustmentSign}>
                <option value={1}>{E.addition}</option>
                <option value={-1}>{E.deduction}</option>
              </Select>
              <Select value={a.mode} onChange={(e) => setAdj(a.key, { mode: e.target.value as "percent" | "amount" })} aria-label={E.adjustmentMode}>
                <option value="percent">%</option>
                <option value="amount">{cur.symbol}</option>
              </Select>
              <Input inputMode="decimal" value={a.value} onChange={(e) => setAdj(a.key, { value: e.target.value })} aria-label={E.adjustmentValue} className="text-right font-mono" />
              <Select value={String(a.base)} onChange={(e) => setAdj(a.key, { base: e.target.value === "items_total" ? "items_total" : Number(e.target.value) })} aria-label={E.adjustmentBase}>
                <option value="items_total">{E.onItems}</option>
                {draft.sections.map((s, si) => s.title.trim() ? <option key={s.key} value={si + 1}>{s.title}</option> : null)}
              </Select>
            </div>
            <p className="text-right"><Amount minor={srv?.amountMinor} cur={cur} /></p>
          </div>
        );
      })}
      {!readOnly && (
        <button type="button" onClick={() => update((d) => ({ ...d, adjustments: [...d.adjustments, { key: nextKey(), label: "", mode: "percent", sign: 1, base: "items_total", value: "" }] }))}
          className="flex min-h-14 w-full items-center gap-2 border-b border-line px-4 text-[16px] font-semibold sm:px-6">
          <Plus className="size-5" aria-hidden /> {E.addAdjustment}
        </button>
      )}
      {server.applyTax && server.taxLabel && <div className={row}><span className="text-ink-soft">{server.taxLabel}</span><Amount minor={server.taxMinor} cur={cur} /></div>}
      <div className="flex min-h-[72px] items-center justify-between gap-3 border-b-[1.5px] border-ink px-4 sm:px-6">
        <span className="text-[18px] font-bold">{E.total}</span>
        <span className="font-mono text-[24px] font-bold">{figure(server.totalMinor, cur)} <span className="text-[13px] font-normal text-muted">{cur.symbol}</span></span>
      </div>
      {server.depositMinor && <div className={row}><span className="text-ink-soft">{E.depositDue}</span><Amount minor={server.depositMinor} cur={cur} strong /></div>}
      <p className="px-4 py-4 text-[14px] text-muted sm:px-6">{E.totalsNote}</p>
    </div>
  );
}

// ---------------------------------------------------------------- sauvegarde automatique

export type SaveState = "saved" | "saving" | "dirty" | "error";

/** Enregistre `value` après une pause de frappe ; renvoie l'état et une sauvegarde immédiate. */
export function useAutosave<T>(value: T, enabled: boolean, save: (v: T) => Promise<void>, delay = 900): { state: SaveState; flush: () => Promise<void> } {
  const [state, setState] = useState<SaveState>("saved");
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const running = useRef<Promise<void> | null>(null);
  latest.current = value;

  const run = async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (running.current) await running.current;
    setState("saving");
    const p = save(latest.current).then(() => setState("saved"), () => setState("error"));
    running.current = p;
    await p;
    running.current = null;
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!enabled) return;
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void run(), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, enabled]);

  return { state, flush: async () => (state === "dirty" || timer.current ? run() : running.current ?? Promise.resolve()) };
}

export function SaveIndicator({ state }: { state: SaveState }) {
  const { t } = useI18n();
  const E = t.app.editor;
  if (state === "saving") return <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Loader2 className="size-3.5 animate-spin" aria-hidden /> {E.saving}</span>;
  if (state === "dirty") return <span className="text-[13px] text-muted">{E.unsaved}</span>;
  if (state === "error") return <span className="text-[13px] font-semibold text-danger">{E.saveFailed}</span>;
  return <span className="inline-flex items-center gap-1 text-[13px] text-ok"><Check className="size-3.5" aria-hidden /> {E.saved}</span>;
}

export { formatQty };
