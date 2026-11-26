import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { BadgeCheck, CreditCard, Files, LogOut, MessageCircle, MoreVertical, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { OfflineBanner } from "@/components/ui";
import { session } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { MeProvider, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

// Espace artisan (ART-1 à ART-6, P-62) : une colonne calme, ouverte depuis le chat. Trois entrées
// au pouce (Documents · Présentation · conversation), le reste dans le menu de l'en-tête.
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Logo />
      <h1 className="mt-10 text-[30px] font-bold leading-9">{t.access.signedOut}</h1>
      <p className="mt-3 text-ink-soft">{t.access.howTo}</p>
    </main>
  );
}

function Menu() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "flex min-h-12 w-full items-center gap-3 px-4 text-left text-[16px] hover:bg-paper";
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={t.app.menu} aria-expanded={open} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5">
        <MoreVertical className="size-5" aria-hidden />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-60 border border-line bg-surface py-1" role="menu" onClick={() => setOpen(false)}>
          <Link to="/app/clients" className={item} role="menuitem"><Users className="size-5" aria-hidden /> {t.app.nav.clients}</Link>
          <Link to="/app/abonnement" className={item} role="menuitem"><CreditCard className="size-5" aria-hidden /> {t.app.nav.subscription}</Link>
          <button
            type="button"
            role="menuitem"
            className={`${item} border-t border-line text-muted`}
            onClick={() => {
              session.clear("org");
              location.href = "/";
            }}
          >
            <LogOut className="size-5" aria-hidden /> {t.app.signOut}
          </button>
        </div>
      )}
    </div>
  );
}

function Shell() {
  const t = useT();
  const me = useMe();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const channel = chatChannel(me.data?.channels);
  const chat = chatLink(channel);
  const onDocuments = path === "/app" || path === "/app/" || path.startsWith("/app/documents");
  const onPresentation = path.startsWith("/app/profil");

  if (me.error?.status === 401) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <Logo />
        <p className="mt-10 text-[20px] font-semibold leading-7">{t.app.sessionExpired}</p>
      </main>
    );
  }

  const tab = (active: boolean) => `flex min-h-[60px] flex-col items-center justify-center gap-1 text-[12px] ${active ? "font-semibold text-ink" : "text-muted"}`;
  return (
    <div className="min-h-screen pb-[76px] lg:pb-0">
      <OfflineBanner />
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[960px] items-center justify-between gap-3 px-4 sm:px-6">
          <Logo to="/app" />
          <nav className="hidden items-center gap-1 lg:flex" aria-label={t.app.nav.documents}>
            <Link to="/app" className={`min-h-11 rounded-[var(--radius-field)] px-3 py-2.5 ${onDocuments ? "font-semibold" : "text-muted hover:text-ink"}`}>{t.app.nav.documents}</Link>
            <Link to="/app/profil" className={`min-h-11 rounded-[var(--radius-field)] px-3 py-2.5 ${onPresentation ? "font-semibold" : "text-muted hover:text-ink"}`}>{t.app.nav.profile}</Link>
            <Link to="/app/clients" className="min-h-11 px-3 py-2.5 text-muted hover:text-ink">{t.app.nav.clients}</Link>
            <Link to="/app/abonnement" className="min-h-11 px-3 py-2.5 text-muted hover:text-ink">{t.app.nav.subscription}</Link>
          </nav>
          <div className="flex items-center gap-1">
            <span className="hidden max-w-48 truncate text-sm text-muted sm:block lg:hidden">{me.data?.org.name}</span>
            <div className="lg:hidden"><Menu /></div>
            <button
              type="button"
              className="hidden min-h-11 items-center gap-2 px-3 text-muted hover:text-ink lg:inline-flex"
              onClick={() => {
                session.clear("org");
                location.href = "/";
              }}
            >
              <LogOut className="size-4" aria-hidden /> {t.app.signOut}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[960px]">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label={t.app.nav.documents}>
        <Link to="/app" className={tab(onDocuments)}><Files className="size-5" aria-hidden />{t.app.nav.documents}</Link>
        <Link to="/app/profil" className={tab(onPresentation)}><BadgeCheck className="size-5" aria-hidden />{t.app.nav.profile}</Link>
        {chat ? (
          <a href={chat} target="_blank" rel="noreferrer" className={tab(false)}><MessageCircle className="size-5" aria-hidden />{channel === "telegram" ? "Telegram" : "WhatsApp"}</a>
        ) : (
          <Link to="/app/abonnement" className={tab(path.startsWith("/app/abonnement"))}><CreditCard className="size-5" aria-hidden />{t.app.nav.subscription}</Link>
        )}
      </nav>
    </div>
  );
}
