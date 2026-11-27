import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, Table } from "@/components/admin-ui";
import { Button, ErrorBox, Select, SkeletonList, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

// Documents de toutes les organisations (P-73). Montants masqués sauf motif donné (P-74).
export const Route = createFileRoute("/admin/documents")({
  component: Documents,
  validateSearch: (s: Record<string, unknown>): { org?: string } => (typeof s.org === "string" ? { org: s.org } : {}),
});

interface Row { id: string; orgId: string; orgName: string | null; type: string; status: string; number: string | null; title: string | null; client: string | null; totalMinor: string | null; currency: string; createdAt: string }

function Documents() {
  const { t, locale } = useI18n();
  const L = t.admin.lists;
  const { org } = Route.useSearch();
  const navigate = useNavigate();
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const list = useApi<{ items: Row[] }>("staff", `/v1/admin/documents?status=${status}&type=${type}&page=${page}${org ? `&org=${org}` : ""}`);
  return (
    <div>
      <PageHead title={t.admin.nav.documents} subtitle={L.documentsSub} />
      <div className="p-5 lg:p-6">
        <Section title={L.documents} actions={
          <div className="flex gap-2">
            <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label={L.type} className="min-h-10 w-40">
              <option value="">{L.allTypes}</option>
              {Object.keys(t.app.typeTag).map((k) => <option key={k} value={k}>{t.app.typeTag[k]}</option>)}
            </Select>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={L.status} className="min-h-10 w-40">
              <option value="">{L.allStatuses}</option>
              {["draft", "issued", "accepted", "refused", "partially_paid", "paid", "cancelled"].map((s) => <option key={s} value={s}>{t.status[s as keyof typeof t.status]}</option>)}
            </Select>
          </div>
        }>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={5} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={L.empty} onRow={(r) => navigate({ to: "/admin/organisations/$id", params: { id: r.orgId } })} columns={[
              { key: "n", label: L.cols.document, render: (r) => <span><span className="block font-mono">{r.number ?? t.app.documents.draftNumber}</span><span className="text-[12px] text-muted">{t.app.typeTag[r.type] ?? r.type}</span></span> },
              { key: "o", label: L.cols.org, render: (r) => <span className="font-semibold">{r.orgName ?? t.admin.orgs.unnamed}</span> },
              { key: "c", label: L.cols.client, render: (r) => r.client ?? "—" },
              { key: "a", label: L.cols.amount, className: "text-right", render: (r) => <span className="font-mono" title={r.totalMinor === null ? L.masked : undefined}>{r.totalMinor === null ? "•••" : `${r.totalMinor} ${r.currency}`}</span> },
              { key: "s", label: L.cols.status, render: (r) => <StatusBadge status={r.status} /> },
              { key: "d", label: L.cols.created, render: (r) => dateTimeOf(r.createdAt, locale) },
            ]} />
          )}
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            <Button variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.common.previous}</Button>
            <span className="font-mono text-[13px]">{page}</span>
            <Button variant="ghost" disabled={(list.data?.items.length ?? 0) < 50} onClick={() => setPage(page + 1)}>{t.common.next}</Button>
          </div>
        </Section>
        <p className="mt-3 text-[13px] text-muted">{L.maskedHelp}</p>
      </div>
    </div>
  );
}
