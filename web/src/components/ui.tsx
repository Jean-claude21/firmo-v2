import { AlertTriangle, Loader2, WifiOff } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { useOnline } from "@/lib/api";
import { useT } from "@/l10n";

// Composants du design system (docs/design/DESIGN.md).

type Variant = "primary" | "accent" | "ghost" | "danger" | "outline";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-ink-soft",
  accent: "bg-amber text-ink hover:brightness-95",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  outline: "border border-line bg-surface text-ink hover:bg-paper",
  danger: "border border-danger/30 bg-surface text-danger hover:bg-danger-soft",
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] px-4 text-[15px] font-medium transition disabled:cursor-not-allowed disabled:opacity-55 ${VARIANTS[variant]} ${className}`}
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-field)] px-4 text-[15px] font-medium transition ${VARIANTS[variant]} ${className}`}
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
      {error && <span className="mt-1 block text-sm text-danger">{error}</span>}
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

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-line/70 text-muted",
  issued: "bg-info-soft text-info",
  accepted: "bg-ok-soft text-ok",
  refused: "bg-danger-soft text-danger",
  partially_paid: "bg-warn-soft text-warn",
  paid: "bg-ok text-white",
  cancelled: "bg-line/70 text-muted line-through",
  replaced: "bg-line/70 text-muted",
  expired: "bg-warn-soft text-warn",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[status] ?? STATUS_STYLE.draft}`}>
      {t.status[status as keyof typeof t.status] ?? status}
    </span>
  );
}

export function Empty({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-amber-soft text-amber-text">{icon}</div>}
      <p className="text-lg font-semibold">{title}</p>
      {text && <p className="mt-1 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const t = useT();
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-danger/25 bg-danger-soft p-4 text-danger sm:flex-row sm:items-center">
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
    <div role="status" className="flex items-center gap-2 bg-warn px-4 py-2 text-sm font-medium text-white">
      <WifiOff className="size-4" aria-hidden /> {t.common.offline}
    </div>
  );
}

export function PageTitle({ title, action, subtitle }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-serif text-[28px] font-bold leading-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "ok" | "warn"; children: ReactNode }) {
  const styles = { info: "bg-info-soft text-info", ok: "bg-ok-soft text-ok", warn: "bg-amber-soft text-amber-text" };
  return <div role="status" className={`rounded-[var(--radius-field)] px-4 py-3 text-sm font-medium ${styles[tone]}`}>{children}</div>;
}
