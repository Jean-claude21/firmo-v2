import { createFileRoute, Link } from "@tanstack/react-router";
import { date } from "@/lib/format";
import { PageHead, Section, Table } from "@/components/admin-ui";
import { ErrorBox, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

// Abonnements et périodes (P-73) : chaque période garde sa version d'offre (P-54).
export const Route = createFileRoute("/admin/abonnements")({ component: Subscriptions });

interface Row { id: string; orgId: string; orgName: string | null; kind: string; quota: number; used: number; planCode: string | null; planVersion: number | null; graceDays: number | null; periodStart: string; periodEnd: string | null; endedAt: string | null }

function Subscriptions() {
  const { t, locale } = useI18n();
  const L = t.admin.lists;
  const list = useApi<{ items: Row[] }>("staff", "/v1/admin/subscriptions");
  const state = (r: Row) => (r.endedAt ? L.ended : r.periodEnd && new Date(r.periodEnd) < new Date() ? L.expired : L.current);
  return (
    <div>
      <PageHead title={t.admin.nav.subscriptions} subtitle={L.subscriptionsSub} />
      <div className="p-5 lg:p-6">
        <Section title={L.periods}>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={5} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={L.empty} columns={[
              { key: "o", label: L.cols.org, render: (r) => <Link to="/admin/organisations/$id" params={{ id: r.orgId }} className="font-semibold hover:underline">{r.orgName ?? t.admin.orgs.unnamed}</Link> },
              { key: "k", label: L.cols.kind, render: (r) => t.admin.kinds[r.kind as keyof typeof t.admin.kinds] ?? r.kind },
              { key: "p", label: L.cols.plan, render: (r) => (r.planCode ? <span className="font-mono">{r.planCode} v{r.planVersion}</span> : "—") },
              { key: "u", label: L.cols.usage, render: (r) => <span className="font-mono">{r.used} / {r.quota}</span> },
              { key: "d", label: L.cols.period, render: (r) => `${date(r.periodStart, locale)} → ${r.periodEnd ? date(r.periodEnd, locale) : "—"}` },
              { key: "g", label: L.cols.grace, render: (r) => (r.graceDays === null ? "—" : `${r.graceDays} j`) },
              { key: "s", label: L.cols.status, render: (r) => state(r) },
            ]} />
          )}
        </Section>
      </div>
    </div>
  );
}
