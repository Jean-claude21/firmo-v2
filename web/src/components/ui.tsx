import { AlertTriangle, Loader2, WifiOff } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useOnline } from "@/lib/api";
import { useT } from "@/l10n";

// Composants du système validé de la v1 (docs/design/DESIGN.md, P-60) : rayon 5 px sur ce qui
// s'actionne, aucune ombre, aucune couleur de marque.

type Variant = "primary" | "accent" | "ghost" | "danger" | "outline" | "inverse";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink-soft",
  // L'ancien « accent » devient l'action principale : le produit n'a pas de couleur propre.
  accent: "bg-ink text-paper hover:bg-ink-soft",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  outline: "border-[1.5px] border-line bg-surface text-ink-soft hover:border-ink hover:text-ink",
  danger: "border-[1.5px] border-danger/40 bg-surface text-danger hover:bg-danger-soft",
  inverse: "bg-paper text-ink hover:bg-surface",
};

export function Button({
  variant = "primary",
  loading,
  icon,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-field)] px-5 text-[16px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant = "primary", icon, children, className = "", ...rest }: { href: string; variant?: Variant; icon?: ReactNode; children: ReactNode; className?: string; target?: string; rel?: string; download?: string | boolean }) {
  return (
    <a
      href={href}
      {...rest}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--radius-field)] px-5 text-[16px] font-semibold transition ${VARIANTS[variant]} ${className}`}
    >
      {icon}
      {children}
    </a>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card p-5 ${className}`}>{children}</section>;
}

export function Field({ label, hint, error, children, optional }: { label: string; hint?: string; error?: string; children: ReactNode; optional?: boolean }) {
  const t = useT();
  return (
    <label className="block">
      <span className="label">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">({t.common.optional})</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-sm text-danger" role="alert">{error}</span>}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`field ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`field appearance-auto ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={`field min-h-24 ${props.className ?? ""}`} />;
}

// Statuts : pastille courte en chasse fixe, point d'état ; le texte porte toujours le sens.
const STATUS_DOT: Record<string, string> = {
  draft: "bg-mute-soft",
  issued: "bg-ink",
  accepted: "bg-ok",
  refused: "bg-danger",
  partially_paid: "bg-warn",
  paid: "bg-ok",
  cancelled: "bg-mute-soft",
  replaced: "bg-mute-soft",
  expired: "bg-warn",
  pending: "bg-warn",
  succeeded: "bg-ok",
  failed: "bg-danger",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper-alt px-2.5 py-0.5 font-mono text-[12px] text-ink-soft ${status === "cancelled" ? "line-through" : ""}`}>
      <span className={`size-1.5 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.draft}`} aria-hidden />
      {label ?? t.status[status as keyof typeof t.status] ?? status}
    </span>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center border border-line bg-surface text-ink-soft">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 border border-danger/30 bg-danger-soft p-4 text-danger sm:flex-row sm:items-center">
      <AlertTriangle className="size-5 shrink-0" aria-hidden />
      <p className="flex-1">{message ?? t.common.error}</p>
      {onRetry && (
        <Button variant="danger" onClick={onRetry}>
          {t.common.retry}
        </Button>
      )}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  const t = useT();
  return (
    <div className="space-y-3" aria-busy="true" aria-label={t.common.loading}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const t = useT();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 bg-ink px-4 py-2 text-sm font-medium text-paper">
      <WifiOff className="size-4" aria-hidden /> {t.common.offline}
    </div>
  );
}

export function PageTitle({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[30px] font-bold leading-[36px] tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn"; children: ReactNode }) {
  const styles = { info: "border-line bg-paper-alt text-ink", ok: "border-ok/30 bg-ok-soft text-ok", warn: "border-warn/30 bg-warn-soft text-warn" };
  return <div role="status" className={`border-l-[3px] px-4 py-3 text-[15px] font-medium ${styles[tone]}`}>{children}</div>;
}

/** Onglets (Détail · Conditions · Totaux) : soulignement encre sous l'onglet actif. */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string }> }) {
  return (
    <div role="tablist" className="grid border-b border-line" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          type="button"
          aria-selected={value === i.value}
          onClick={() => onChange(i.value)}
          className={`min-h-12 border-b-2 px-2 text-[16px] font-semibold transition ${value === i.value ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
