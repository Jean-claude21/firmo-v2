import { createFileRoute, Link } from "@tanstack/react-router";
import { dateTimeOf, PageHead, Section, Table } from "@/components/admin-ui";
import { ErrorBox, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

// Clients des artisans (P-73) : nom et nombre de documents, rien de plus (leurs données sont à l'artisan).
export const Route = createFileRoute("/admin/clients")({ component: Clients });

interface Row { id: string; orgId: string; orgName: string | null; name: string; documents: number; createdAt: string }

function Clients() {
  const { t, locale } = useI18n();
  const L = t.admin.lists;
  const list = useApi<{ items: Row[] }>("staff", "/v1/admin/clients");
  return (
    <div>
      <PageHead title={t.admin.nav.clients} subtitle={L.clientsSub} />
      <div className="p-5 lg:p-6">
        <Section title={L.clients}>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={5} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={L.empty} columns={[
              { key: "n", label: L.cols.client, render: (r) => <span className="font-semibold">{r.name}</span> },
              { key: "o", label: L.cols.org, render: (r) => <Link to="/admin/organisations/$id" params={{ id: r.orgId }} className="hover:underline">{r.orgName ?? t.admin.orgs.unnamed}</Link> },
              { key: "d", label: L.cols.documents, className: "text-right", render: (r) => <span className="font-mono">{r.documents}</span> },
              { key: "c", label: L.cols.created, render: (r) => dateTimeOf(r.createdAt, locale) },
            ]} />
          )}
        </Section>
      </div>
    </div>
  );
}
