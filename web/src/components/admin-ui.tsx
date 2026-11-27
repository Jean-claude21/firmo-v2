import { AlertTriangle, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, Field, Notice, Textarea } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { useT } from "@/l10n";

// Composants de la console (référence IBM Carbon sans son bleu, docs/design/DESIGN.md) : grille,
// tables denses, états, aucune ombre.

export function PageHead({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  return (
    <div className="border-b border-line bg-paper">
      {crumbs && <div className="border-b border-line px-6 py-3 text-[14px] text-ink-soft lg:px-7">{crumbs}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4 px-6 py-6 lg:px-7">
        <div className="min-w-0">
          <h1 className="text-[30px] font-bold leading-9 tracking-[-0.01em]">{title}</h1>
          {subtitle && <p className="mt-1 text-[15px] text-ink-soft">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function KpiStrip({ items }: { items: Array<{ label: string; value: ReactNode; sub?: ReactNode; tone?: "danger" }> }) {
  return (
    <div className="grid border-b border-line bg-surface sm:grid-cols-2 xl:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="border-b border-line px-6 py-5 sm:border-r xl:border-b-0 xl:last:border-r-0 lg:px-7">
          <p className="mono-label">{k.label}</p>
          <p className={`mt-1.5 font-mono text-[26px] font-semibold leading-8 ${k.tone === "danger" ? "text-danger" : ""}`}>{k.value}</p>
          {k.sub && <p className="mt-1 text-[13px] text-ink-soft">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function Section({ title, subtitle, actions, children, className = "" }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border border-line bg-surface ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-[19px] font-semibold">{title}</h2>
          {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, empty, onRow, rowClass }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; empty: string; onRow?: (r: T) => void; rowClass?: (r: T) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((c) => <th key={c.key} className={`px-5 py-3 font-mono text-[12px] font-normal text-ink-soft ${c.className ?? ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="px-5 py-8 text-center text-muted">{empty}</td></tr>}
          {rows.map((r) => (
            <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-line last:border-0 ${onRow ? "cursor-pointer hover:bg-paper" : ""} ${rowClass?.(r) ?? ""}`}>
              {columns.map((c) => <td key={c.key} className={`px-5 py-3.5 align-middle ${c.className ?? ""}`}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Dot({ tone }: { tone: "ok" | "warn" | "danger" | "info" | "mute" }) {
  const c = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", info: "bg-ink", mute: "bg-mute-soft" }[tone];
  return <span className={`inline-block size-2 rounded-full ${c}`} aria-hidden />;
}

/**
 * Action sensible (P-74) : motif obligatoire, puis reconfirmation explicite. Le motif part au journal
 * d'audit, en ajout seul.
 */
export function SensitiveDialog({ title, description, confirmLabel, danger, onConfirm, onClose }: {
  title: string; description: string; confirmLabel: string; danger?: boolean;
  onConfirm: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const t = useT();
  const S = t.admin.sensitive;
  const [reason, setReason] = useState("");
  const [step, setStep] = useState<"reason" | "confirm">("reason");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const ok = reason.trim().length >= 5;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-lg border border-line bg-paper">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-start gap-3">
            {danger && <AlertTriangle className="mt-1 size-5 shrink-0 text-danger" aria-hidden />}
            <div>
              <h2 className="text-[20px] font-semibold">{title}</h2>
              <p className="mt-1 text-[14px] text-ink-soft">{description}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t.common.close} className="flex size-10 items-center justify-center"><X className="size-5" /></button>
        </div>
        <div className="space-y-4 px-5 py-5">
          {step === "reason" ? (
            <Field label={S.reason} hint={S.reasonHelp}>
              <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          ) : (
            <Notice tone="warn">{S.confirmText(reason.trim())}</Notice>
          )}
          {error && <Notice tone="warn">{error.message}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={step === "confirm" ? () => setStep("reason") : onClose}>{step === "confirm" ? t.common.back : t.common.cancel}</Button>
            {step === "reason" ? (
              <Button disabled={!ok} onClick={() => setStep("confirm")}>{S.continue}</Button>
            ) : (
              <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await onConfirm(reason.trim());
                  onClose();
                } catch (e) {
                  setError(e as ApiError);
                } finally {
                  setBusy(false);
                }
              }}>{confirmLabel}</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function timeOf(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function dateTimeOf(iso: string | null, locale = "fr"): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
