import { Link } from "@tanstack/react-router";
import { ArrowLeft, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Logo, Mark } from "@/components/brand";
import { chatChannel, chatLink } from "@/lib/chat";
import { useI18n } from "@/l10n";

/** En-tête et pied des pages publiques (site, conditions, formats). */
export function PublicHeader() {
  const { t } = useI18n();
  const chat = chatLink(chatChannel(), t.landing.firstMessage);
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-paper/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        {chat ? (
          <a href={chat} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-field)] border-[1.5px] border-ink px-4 text-[15px] font-semibold">
            <MessageCircle className="size-4" aria-hidden /> {t.landing.openChat}
          </a>
        ) : (
          <span className="text-[14px] text-muted">{t.landing.ctaSoon}</span>
        )}
      </div>
    </header>
  );
}

export function PublicFooter() {
  const { t } = useI18n();
  const F = t.legal.footer;
  return (
    <footer className="border-t border-line bg-paper">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="inline-flex items-center gap-2 text-[15px] text-ink-soft"><Mark className="size-6" /> Firmo — <em>{F.motto}</em></p>
        <nav className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]" aria-label={F.nav}>
          <Link to="/formats" className="min-h-11 py-2.5 text-ink-soft hover:text-ink">{F.formats}</Link>
          <Link to="/conditions" className="min-h-11 py-2.5 text-ink-soft hover:text-ink">{F.terms}</Link>
          <Link to="/confidentialite" className="min-h-11 py-2.5 text-ink-soft hover:text-ink">{F.privacy}</Link>
          <Link to="/suppression-donnees" className="min-h-11 py-2.5 text-ink-soft hover:text-ink">{F.deletion}</Link>
          <Link to="/contact" className="min-h-11 py-2.5 text-ink-soft hover:text-ink">{F.contact}</Link>
        </nav>
      </div>
    </footer>
  );
}

/** Page d'information (conditions, confidentialité, suppression, contact) : une colonne de lecture. */
export function InfoPage({ title, intro, updated, children }: { title: string; intro: string; updated?: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <main>
        <section className="border-b border-line">
          <div className="mx-auto max-w-[760px] px-4 pb-10 pt-8 sm:px-6">
            <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-[15px] text-ink-soft hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> {t.legal.back}</Link>
            <h1 className="mt-4 text-[40px] font-bold leading-[46px] tracking-[-0.01em]">{title}</h1>
            <p className="mt-4 text-[18px] leading-7 text-ink-soft">{intro}</p>
            {updated && <p className="mono-label mt-5">{updated}</p>}
          </div>
        </section>
        <div className="mx-auto max-w-[760px] px-4 py-6 sm:px-6">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}

export function InfoSection({ title, paragraphs, items }: { title: string; paragraphs?: string[]; items?: string[] }) {
  return (
    <section className="border-b border-line py-7 last:border-0">
      <h2 className="text-[22px] font-semibold leading-7">{title}</h2>
      {paragraphs?.map((p) => <p key={p} className="mt-3 text-[17px] leading-[27px] text-ink-soft">{p}</p>)}
      {items && (
        <ul className="mt-3 space-y-2">
          {items.map((i) => (
            <li key={i} className="flex gap-3 text-[17px] leading-[27px] text-ink-soft"><span className="mt-[13px] h-px w-3 shrink-0 bg-ink" aria-hidden />{i}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
