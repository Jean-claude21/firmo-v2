import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, FilePlus2, FileText, MessageCircle } from "lucide-react";
import { DocRow, TypeTag } from "@/components/doc-row";
import { Empty, ErrorBox, Skeleton, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { ago, figure } from "@/lib/format";
import { type DocumentSummary, useMe } from "@/lib/portal";
import { useI18n } from "@/l10n";

// Accueil de l'espace (P-62, maquette v1 « client/home ») : ce qui reste ce mois, ce qui est à
// continuer, les derniers documents à télécharger.
export const Route = createFileRoute("/app/")({ component: Home });

interface Dash {
  stats: { issued_this_month: number; drafts: number; outstanding_minor: number };
  recent: Array<DocumentSummary & { title: string | null; updatedAt: string; lines: number; sections: number }>;
  entitlement: { kind: string; quota: number; used: number; remaining: number } | null;
}

function Home() {
  const { t, locale } = useI18n();
  const H = t.app.home;
  const me = useMe();
  const dash = useApi<Dash>("org", "/v1/portal/dashboard");
  const drafts = useApi<{ items: Dash["recent"] }>("org", "/v1/portal/documents?status=draft");
  const currency = me.data?.currency;
  const channel = chatChannel(me.data?.channels);
  const chat = chatLink(channel);
  const draft = drafts.data?.items[0] ?? null;
  const recent = (dash.data?.recent ?? []).filter((d) => d.status !== "draft").slice(0, 5);
  const ent = dash.data?.entitlement;

  return (
    <div>
      <section className="px-4 pb-6 pt-7 sm:px-6">
        <h1 className="text-[32px] font-bold leading-[38px] tracking-[-0.01em]">{H.title}</h1>
        <p className="mt-2 max-w-md text-[17px] text-ink-soft">{H.subtitle}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {chat && (
            <a href={chat} target="_blank" rel="noreferrer" className="inline-flex min-h-14 flex-1 items-center justify-center gap-2.5 rounded-[var(--radius-field)] bg-ink px-5 text-[17px] font-semibold text-paper hover:bg-ink-soft sm:flex-none">
              <MessageCircle className="size-5" aria-hidden /> {H.createIn(channel === "telegram" ? "Telegram" : "WhatsApp")}
            </a>
          )}
          <Link to="/app/documents/nouveau" className={`inline-flex min-h-14 items-center justify-center gap-2 rounded-[var(--radius-field)] px-5 text-[16px] font-semibold ${chat ? "border-[1.5px] border-line bg-surface text-ink-soft hover:border-ink" : "flex-1 bg-ink text-paper sm:flex-none"}`}>
            <FilePlus2 className="size-5" aria-hidden /> {H.createHere}
          </Link>
        </div>
      </section>

      {dash.error && <div className="px-4 pb-4 sm:px-6"><ErrorBox onRetry={dash.reload} /></div>}

      <Link to="/app/abonnement" className="flex items-center justify-between gap-4 border-y border-line bg-paper-alt px-4 py-4 hover:bg-[#e9e5de] sm:px-6">
        <div>
          <p className="mono-label">{ent?.kind === "trial" ? H.trial : H.thisMonth}</p>
          {ent ? (
            <p className="mt-1 text-[17px] font-semibold">{H.available(ent.remaining)}</p>
          ) : dash.data ? (
            <p className="mt-1 text-[17px] font-semibold">{H.noRights}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-48" />
          )}
        </div>
        {ent && <p className="whitespace-nowrap font-mono text-[14px] text-ink-soft">{H.used(ent.used, ent.quota)}</p>}
      </Link>

      {(draft || drafts.loading) && (
        <section className="px-4 pt-7 sm:px-6">
          <div className="flex items-center justify-between border-b-[1.5px] border-ink pb-3">
            <h2 className="text-[22px] font-semibold">{H.toContinue}</h2>
            <StatusBadge status="draft" />
          </div>
          {draft && currency ? (
            <Link to="/app/documents/$id" params={{ id: draft.id }} className="flex min-h-[84px] items-center gap-4 border-b border-line py-3 hover:bg-paper-alt">
              <TypeTag type={draft.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold">{draft.title || draft.clientName || H.untitled}</p>
                <p className="truncate text-[14px] text-muted">{H.modified(ago(draft.updatedAt, locale))}{draft.lines ? ` · ${H.lines(draft.lines)}` : ""}</p>
              </div>
              <span className="whitespace-nowrap font-mono text-[15px] font-semibold">{figure(draft.totalMinor, currency)} <span className="text-[11px] font-normal text-muted">{currency.symbol}</span></span>
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
            </Link>
          ) : (
            <Skeleton className="mt-3 h-16" />
          )}
        </section>
      )}

      <section className="pb-8 pt-7">
        <div className="flex items-center justify-between px-4 pb-3 sm:px-6">
          <h2 className="text-[22px] font-semibold">{H.recent}</h2>
          <Link to="/app/documents" className="min-h-11 py-2.5 text-[16px] font-semibold">{H.seeAll}</Link>
        </div>
        <div className="border-t border-line">
          {dash.loading && !dash.data && <div className="space-y-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
          {dash.data && currency && recent.length === 0 && !draft && (
            <Empty icon={<FileText className="size-6" />} title={H.emptyTitle} text={H.emptyText} />
          )}
          {dash.data && currency && recent.length === 0 && draft && <p className="px-4 py-6 text-muted sm:px-6">{H.noIssued}</p>}
          {currency && recent.map((d) => <DocRow key={d.id} doc={d} currency={currency} />)}
        </div>
      </section>
    </div>
  );
}
