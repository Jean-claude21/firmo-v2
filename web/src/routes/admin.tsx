import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bot, Gauge, History, LogOut, MessagesSquare, Settings2, Smartphone, Store, UsersRound } from "lucide-react";
import { createContext, useContext, useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { Button, Card, Field, Input, Notice, OfflineBanner } from "@/components/ui";
import { api, type ApiError, session, useApi } from "@/lib/api";
import { useT } from "@/l10n";

// Console d'administration (ADM-1 à ADM-7), réservée à l'équipe (Neon Auth + rôle en base).
export const Route = createFileRoute("/admin")({ component: AdminLayout });

interface StaffMe {
  email: string;
  role: "admin" | "support";
  env: string;
}

const Ctx = createContext<StaffMe | null>(null);
export const useStaff = () => useContext(Ctx);

function AdminLayout() {
  const [state, setState] = useState<"checking" | "in" | "out">("checking");
  useEffect(() => setState(session.get("staff") ? "in" : "out"), []);
  if (state === "checking") return null;
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
      <Card>
        <h1 className="mb-4 text-xl font-bold">{L.title}</h1>
        <form onSubmit={submit} className="space-y-4">
          <Field label={L.email}><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label={L.password}><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          {error && <Notice tone="warn">{error.message || L.error}</Notice>}
          <Button type="submit" className="w-full" loading={busy}>{L.submit}</Button>
        </form>
      </Card>
    </main>
  );
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const t = useT();
  const N = t.admin.nav;
  const me = useApi<StaffMe>("staff", "/v1/admin/me");
  const path = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    if (me.error?.status === 401) onSignOut();
  }, [me.error, onSignOut]);
  const nav = [
    { to: "/admin", label: N.dashboard, icon: Gauge, exact: true },
    { to: "/admin/organisations", label: N.organizations, icon: Store },
    { to: "/admin/conversations", label: N.conversations, icon: MessagesSquare },
    { to: "/admin/simulateur", label: N.simulator, icon: Smartphone },
    { to: "/admin/ia", label: N.ai, icon: Bot },
    { to: "/admin/configuration", label: N.config, icon: Settings2 },
    { to: "/admin/equipe", label: N.staff, icon: UsersRound },
    { to: "/admin/journal", label: N.audit, icon: History },
  ] as const;
  const active = (to: string, exact?: boolean) => (exact ? path === to || path === `${to}/` : path.startsWith(to));
  const env = me.data?.env ?? "";
  const envStyle = env === "production" ? "bg-danger text-white" : env === "staging" ? "bg-amber text-ink" : "bg-info-soft text-info";

  return (
    <Ctx.Provider value={me.data}>
      <div className="min-h-screen lg:flex">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-ink px-3 py-5 text-white lg:flex">
          <div className="px-2 [&_a]:text-white"><Logo to="/admin" /></div>
          {env && <span className={`mx-2 mt-3 w-fit rounded-full px-2.5 py-0.5 text-xs font-semibold ${envStyle}`}>{t.admin.env(env)}</span>}
          <nav className="mt-5 flex flex-1 flex-col gap-0.5">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 text-[15px] transition ${active(n.to, "exact" in n) ? "bg-white/12 font-semibold text-white" : "text-white/70 hover:bg-white/8 hover:text-white"}`}>
                <n.icon className="size-[18px]" aria-hidden /> {n.label}
              </Link>
            ))}
          </nav>
          <p className="truncate px-3 text-xs text-white/60">{me.data?.email}</p>
          <button onClick={() => { session.clear("staff"); onSignOut(); }} className="mt-1 flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 text-white/70 hover:bg-white/8">
            <LogOut className="size-[18px]" aria-hidden /> {N.signOut}
          </button>
        </aside>
        <div className="min-w-0 flex-1">
          <OfflineBanner />
          <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 lg:hidden">
            <Logo to="/admin" />
            {env && <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${envStyle}`}>{t.admin.env(env)}</span>}
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1 lg:hidden">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-[var(--radius-field)] px-3 text-sm ${active(n.to, "exact" in n) ? "bg-ink text-white" : "text-muted"}`}>
                <n.icon className="size-4" aria-hidden /> {n.label}
              </Link>
            ))}
          </nav>
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
            {me.data?.role === "support" && <div className="mb-4"><Notice tone="info">{t.admin.readOnly}</Notice></div>}
            <Outlet />
          </main>
        </div>
      </div>
    </Ctx.Provider>
  );
}
