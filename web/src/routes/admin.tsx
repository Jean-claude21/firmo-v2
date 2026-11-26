import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Activity, AlertTriangle, BarChart3, Bot, Building2, CreditCard, Files, History, Layers, LogOut, MessagesSquare, Search, Settings2, Smartphone, Contact, UsersRound, Fingerprint, Repeat } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StaffContext as Ctx, type StaffMe } from "@/lib/staff";
import { Logo, Mark } from "@/components/brand";
import { Button, Field, Input, Notice, OfflineBanner } from "@/components/ui";
import { api, type ApiError, session, useApi } from "@/lib/api";
import { useT } from "@/l10n";

// Console (ADM, spec 013 — maquettes v1 « admin/command », « admin/organization », « admin/incident ») :
// barre latérale encre, recherche globale, contenu dense pleine largeur.
export const Route = createFileRoute("/admin")({ component: AdminLayout });


function AdminLayout() {
  const [state, setState] = useState<"checking" | "in" | "out">("checking");
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setState(session.get("staff") ? "in" : "out"), [path]);
  if (state === "checking") return null;
  // Le lien d'administration envoyé dans le chat s'ouvre sans session (P-76).
  if (path.startsWith("/admin/acces/")) return <Outlet />;
  if (state === "out") return <Login onDone={() => setState("in")} />;
  return <Shell onSignOut={() => setState("out")} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
  const L = t.admin.login;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string; expiresAt: string }>(null, "/v1/admin/session", { body: { email, password } });
      session.set("staff", r.token, r.expiresAt);
      onDone();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <Logo to="/admin" />
      <form onSubmit={submit} className="space-y-4 border border-line bg-surface p-6">
        <h1 className="text-[22px] font-bold">{L.title}</h1>
        <Field label={L.email}><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label={L.password}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <Notice tone="warn">{error.message || L.error}</Notice>}
        <Button type="submit" className="w-full" loading={busy}>{L.submit}</Button>
        <p className="text-[13px] text-muted">{L.chatHint}</p>
      </form>
    </main>
  );
}

interface SearchResult {
  organizations: Array<{ id: string; name: string | null; status: string; phone: string | null }>;
  documents: Array<{ id: string; org_id: string; org_name: string | null; number: string; type: string; status: string }>;
}

/** Recherche globale (P-77) : organisation, téléphone, numéro de document. */
function GlobalSearch() {
  const t = useT();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [r, setR] = useState<SearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) return setR(null);
    const timer = setTimeout(() => {
      api<SearchResult>("staff", `/v1/admin/search?q=${encodeURIComponent(q.trim())}`).then(setR).catch(() => setR(null));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);
  const go = (to: string) => {
    setOpen(false);
    setQ("");
    void navigate({ to: to as "/admin" });
  };
  return (
    <div className="relative w-full max-w-[520px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input ref={ref} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={t.admin.search.placeholder} aria-label={t.admin.search.placeholder}
        className="h-11 w-full rounded-[var(--radius-field)] border-[1.5px] border-line bg-paper pl-9 pr-14 text-[15px] focus:border-ink focus:outline-none" />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11px] text-muted">⌘ K</span>
      {open && r && (
        <div className="absolute left-0 right-0 top-12 z-40 border border-line bg-surface py-1">
          {r.organizations.length === 0 && r.documents.length === 0 && <p className="px-4 py-3 text-muted">{t.admin.search.none}</p>}
          {r.organizations.map((o) => (
            <button key={o.id} type="button" onMouseDown={() => go(`/admin/organisations/${o.id}`)} className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left hover:bg-paper">
              <span className="font-semibold">{o.name ?? t.admin.orgs.unnamed}</span>
              <span className="font-mono text-[12px] text-muted">{o.phone ?? ""}</span>
            </button>
          ))}
          {r.documents.map((d) => (
            <button key={d.id} type="button" onMouseDown={() => go(`/admin/organisations/${d.org_id}`)} className="flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left hover:bg-paper">
              <span className="font-mono">{d.number}</span>
              <span className="text-[13px] text-muted">{d.org_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const t = useT();
  const N = t.admin.nav;
  const me = useApi<StaffMe>("staff", "/v1/admin/me");
  const incidents = useApi<{ total: number; items: unknown[] }>("staff", "/v1/admin/incidents");
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (me.error?.status === 401) onSignOut();
  }, [me.error, onSignOut]);
  const open = incidents.data?.total ?? 0;
  const main = [
    { to: "/admin", label: N.command, icon: Activity, exact: true },
    { to: "/admin/organisations", label: N.organizations, icon: Building2 },
    { to: "/admin/documents", label: N.documents, icon: Files },
    { to: "/admin/conversations", label: N.conversations, icon: MessagesSquare },
    { to: "/admin/paiements", label: N.payments, icon: CreditCard },
    { to: "/admin/abonnements", label: N.subscriptions, icon: Repeat },
    { to: "/admin/incidents", label: N.incidents, icon: AlertTriangle, badge: open },
    { to: "/admin/clients", label: N.clients, icon: Contact },
    { to: "/admin/identites", label: N.identities, icon: Fingerprint },
    { to: "/admin/pilotage", label: N.pilotage, icon: BarChart3 },
  ] as const;
  const system = [
    { to: "/admin/configuration", label: N.config, icon: Settings2 },
    { to: "/admin/simulateur", label: N.simulator, icon: Smartphone },
    { to: "/admin/ia", label: N.ai, icon: Bot },
    { to: "/admin/equipe", label: N.staff, icon: UsersRound },
    { to: "/admin/journal", label: N.audit, icon: History },
  ] as const;
  const active = (to: string, exact?: boolean) => (exact ? path === to || path === `${to}/` : path.startsWith(to));
  const env = me.data?.env ?? "";
  const link = (n: { to: string; label: string; icon: typeof Layers; badge?: number }, exact?: boolean) => (
    <Link key={n.to} to={n.to as "/admin"} className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 text-[15px] transition ${active(n.to, exact) ? "bg-white/10 font-semibold text-white" : "text-white/75 hover:bg-white/5 hover:text-white"}`}>
      <n.icon className="size-[18px]" aria-hidden /> <span className="flex-1">{n.label}</span>
      {n.badge ? <span className="rounded-full bg-danger px-1.5 font-mono text-[11px] font-semibold text-white">{n.badge}</span> : null}
    </Link>
  );

  return (
    <Ctx.Provider value={me.data}>
      <div className="min-h-screen lg:flex">
        <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col bg-ink text-white lg:flex">
          <div className="flex h-[58px] items-center justify-between border-b border-white/10 px-4">
            <Link to="/admin" className="inline-flex items-center gap-2.5 text-[20px] font-bold text-white"><Mark inverse /> Firmo</Link>
            <span className="font-mono text-[10px] tracking-[0.14em] text-white/60">ADMIN</span>
          </div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-4">
            {main.map((n) => link(n, "exact" in n))}
            <p className="mt-5 px-3 pb-2 font-mono text-[10px] tracking-[0.14em] text-white/50">{N.system}</p>
            {system.map((n) => link(n))}
          </nav>
          <div className="border-t border-white/10 px-4 py-4">
            <p className="flex items-center gap-2 text-[14px] font-semibold"><span className={`size-2 rounded-full ${open ? "bg-warn" : "bg-ok"}`} aria-hidden />{t.admin.env(env)}</p>
            <p className="pl-4 text-[12px] text-white/60">{open ? t.admin.status.incidents(open) : t.admin.status.allGood}</p>
          </div>
        </aside>
        <div className="min-w-0 flex-1 bg-paper">
          <OfflineBanner />
          <header className="sticky top-0 z-30 flex h-[58px] items-center justify-between gap-4 border-b border-line bg-surface px-4 lg:px-6">
            <div className="lg:hidden"><Logo to="/admin" /></div>
            <div className="hidden flex-1 lg:block"><GlobalSearch /></div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-[14px] font-semibold leading-4">{me.data?.email}</p>
                <p className="font-mono text-[11px] text-muted">{me.data?.role}</p>
              </div>
              <button onClick={() => { session.clear("staff"); onSignOut(); }} aria-label={N.signOut} className="flex size-10 items-center justify-center rounded-[var(--radius-field)] text-muted hover:bg-ink/5 hover:text-ink">
                <LogOut className="size-[18px]" aria-hidden />
              </button>
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1 lg:hidden">
            {[...main, ...system].map((n) => (
              <Link key={n.to} to={n.to as "/admin"} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-field)] px-3 text-sm ${active(n.to, n.to === "/admin") ? "bg-ink text-paper" : "text-muted"}`}>
                <n.icon className="size-4" aria-hidden /> {n.label}
              </Link>
            ))}
          </nav>
          <div className="px-4 pt-3 lg:hidden"><GlobalSearch /></div>
          {me.data?.role === "support" && <div className="px-6 pt-4"><Notice tone="info">{t.admin.readOnly}</Notice></div>}
          <Outlet />
        </div>
      </div>
    </Ctx.Provider>
  );
}
