import { createFileRoute, Link } from "@tanstack/react-router";
import { FilePlus2, FileText, Info } from "lucide-react";
import { DocRow } from "@/components/doc-row";
import { Card, Empty, ErrorBox, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { money } from "@/lib/format";
import { type DocumentSummary, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

export const Route = createFileRoute("/app/")({ component: Dashboard });

interface Dash {
  stats: {
    issued_this_month: number;
    drafts: number;
    quotes_pending: number;
    quotes_pending_minor: number;
    invoiced_this_month_minor: number;
    collected_this_month_minor: number;
    outstanding_minor: number;
  };
  recent: DocumentSummary[];
  entitlement: { kind: string; quota: number; used: number; remaining: number } | null;
}

function Dashboard() {
  const t = useT();
  const me = useMe();
  const dash = useApi<Dash>("org", "/v1/portal/dashboard");
  const D = t.app.dashboard;
  const currency = me.data?.currency;
  const org = me.data?.org;
  const incomplete = org && (!org.name || !org.hasLogo || !org.phone);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-[28px] font-bold sm:text-3xl">{t.app.greeting(org?.name ?? null)}</h1>
        <Link to="/app/documents/nouveau" className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-field)] bg-ink px-4 font-medium text-white hover:bg-ink-soft">
          <FilePlus2 className="size-4" aria-hidden /> {D.newDocument}
        </Link>
      </div>

      {incomplete && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-amber/40 bg-amber-soft p-4 sm:flex-row sm:items-center">
          <Info className="size-5 shrink-0 text-amber-text" aria-hidden />
          <p className="flex-1 text-amber-text">{D.profileIncomplete}</p>
          <Link to="/app/profil" className="font-semibold text-ink underline underline-offset-4">{D.completeProfile}</Link>
        </div>
      )}

      {dash.error && <ErrorBox onRetry={dash.reload} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: D.issued, value: dash.data ? String(dash.data.stats.issued_this_month) : null },
          { label: D.pending, value: dash.data ? String(dash.data.stats.quotes_pending) : null, sub: dash.data && currency && dash.data.stats.quotes_pending > 0 ? money(dash.data.stats.quotes_pending_minor, currency) : null },
          { label: D.invoiced, value: dash.data && currency ? money(dash.data.stats.invoiced_this_month_minor, currency) : null },
          { label: D.collected, value: dash.data && currency ? money(dash.data.stats.collected_this_month_minor, currency) : null },
        ].map((k) => (
          <div key={k.label} className="card p-4">
            <p className="text-sm text-muted">{k.label}</p>
            {k.value === null ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-1 text-xl font-bold tabular-nums">{k.value}</p>}
            {"sub" in k && k.sub && <p className="text-sm text-muted tabular-nums">{k.sub}</p>}
          </div>
        ))}
      </div>

      {dash.data?.entitlement && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">{dash.data.entitlement.kind === "trial" ? D.trial : D.plan}</p>
            <Link to="/app/abonnement" className="text-sm font-medium text-ink underline underline-offset-4">{t.app.nav.subscription}</Link>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={dash.data.entitlement.quota} aria-valuenow={dash.data.entitlement.used}>
            <div
              className={`h-full rounded-full ${dash.data.entitlement.remaining === 0 ? "bg-danger" : dash.data.entitlement.remaining * 5 <= dash.data.entitlement.quota ? "bg-warn" : "bg-ok"}`}
              style={{ width: `${Math.min(100, (dash.data.entitlement.used / Math.max(1, dash.data.entitlement.quota)) * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-muted">{D.quota(dash.data.entitlement.used, dash.data.entitlement.quota)}</p>
          {dash.data.stats.outstanding_minor > 0 && currency && (
            <p className="mt-3 text-sm">
              {D.outstanding} : <span className="font-semibold">{money(dash.data.stats.outstanding_minor, currency)}</span>
            </p>
          )}
        </Card>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">{D.recent}</h2>
          <Link to="/app/documents" className="text-sm font-medium underline underline-offset-4">{t.app.nav.documents}</Link>
        </div>
        {dash.loading && !dash.data && <div className="space-y-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {dash.data && currency && dash.data.recent.length === 0 && (
          <Empty icon={<FileText className="size-6" />} title={D.emptyTitle} text={D.emptyText} />
        )}
        {dash.data && currency && dash.data.recent.length > 0 && (
          <div className="divide-y divide-line">{dash.data.recent.map((d) => <DocRow key={d.id} doc={d} currency={currency} />)}</div>
        )}
      </section>
    </div>
  );
}
