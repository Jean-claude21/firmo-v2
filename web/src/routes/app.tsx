import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { CreditCard, FileText, Home, LogOut, Store, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { OfflineBanner } from "@/components/ui";
import { session } from "@/lib/api";
import { MeProvider, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

// Espace artisan (ART-1 à ART-6). Session obtenue par un lien du chat ; sinon, page d'explication.
export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const [ready, setReady] = useState<"checking" | "in" | "out">("checking");
  useEffect(() => setReady(session.get("org") ? "in" : "out"), []);
  if (ready === "checking") return null;
  if (ready === "out") return <SignedOut />;
  return (
    <MeProvider>
      <Shell />
    </MeProvider>
  );
}

function SignedOut() {
  const t = useT();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <Logo />
      <div className="card mt-8 p-6">
        <p className="font-semibold">{t.access.signedOut}</p>
        <p className="mt-2 text-muted">{t.access.howTo}</p>
      </div>
    </main>
  );
}

function Shell() {
  const t = useT();
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const nav = [
    { to: "/app", label: t.app.nav.dashboard, icon: Home, exact: true },
    { to: "/app/documents", label: t.app.nav.documents, icon: FileText },
    { to: "/app/clients", label: t.app.nav.clients, icon: Users },
    { to: "/app/profil", label: t.app.nav.profile, icon: Store },
    { to: "/app/abonnement", label: t.app.nav.subscription, icon: CreditCard },
  ] as const;
  const active = (to: string, exact?: boolean) => (exact ? path === to || path === `${to}/` : path.startsWith(to));

  if (me.error?.status === 401) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <Logo />
        <p className="card mt-8 p-6 text-muted">{t.app.sessionExpired}</p>
      </main>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-surface px-4 py-5 lg:flex">
        <Logo to="/app" />
        <p className="mt-4 truncate px-2 text-sm text-muted">{me.data?.org.name ?? " "}</p>
        <nav className="mt-4 flex flex-1 flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 font-medium transition ${active(n.to, "exact" in n) ? "bg-ink text-white" : "text-ink hover:bg-paper"}`}
            >
              <n.icon className="size-5" aria-hidden /> {n.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => {
            session.clear("org");
            location.href = "/";
          }}
          className="flex min-h-11 items-center gap-3 rounded-[var(--radius-field)] px-3 text-muted hover:bg-paper"
        >
          <LogOut className="size-5" aria-hidden /> {t.app.signOut}
        </button>
      </aside>

      <div className="min-w-0 flex-1 pb-24 lg:pb-0">
        <OfflineBanner />
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 lg:hidden">
          <Logo to="/app" />
          <span className="max-w-[45%] truncate text-sm text-muted">{me.data?.org.name}</span>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label={t.app.nav.dashboard}>
        {nav.map((n) => (
          <Link key={n.to} to={n.to} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active(n.to, "exact" in n) ? "text-ink" : "text-muted"}`}>
            <n.icon className={`size-5 ${active(n.to, "exact" in n) ? "text-amber-text" : ""}`} aria-hidden />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
