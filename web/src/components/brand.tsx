import { Link } from "@tanstack/react-router";

/** Marque Firmo (v1) : un « F » dans un carré à filet, achromatique. */
export function Mark({ className = "size-7", inverse = false }: { className?: string; inverse?: boolean }) {
  const colors = inverse ? "border-white bg-transparent text-white" : "border-ink bg-surface text-ink";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center border-[1.5px] font-mono text-[13px] font-bold ${colors} ${className}`} aria-hidden>
      F
    </span>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-2.5 text-[21px] font-bold tracking-[-0.01em] text-ink">
      <Mark />
      Firmo
    </Link>
  );
}
