import { Link } from "@tanstack/react-router";

/** Logo Firmo : document plié, coche ambre. */
export function Mark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="14" fill="#14213D" />
      <path d="M20 14h17l9 9v27a3 3 0 0 1-3 3H20a3 3 0 0 1-3-3V17a3 3 0 0 1 3-3z" fill="#FAF8F4" />
      <path d="M37 14v9h9" fill="#E7E3DB" />
      <path d="M24 31h16M24 37h10" stroke="#14213D" strokeWidth="3" strokeLinecap="round" />
      <circle cx="42" cy="44" r="8" fill="#E9A23B" />
      <path d="M38.5 44l2.5 2.5 4.5-5" stroke="#14213D" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex min-h-11 items-center gap-2.5 font-serif text-[22px] font-bold tracking-tight text-ink">
      <Mark />
      Firmo
    </Link>
  );
}
