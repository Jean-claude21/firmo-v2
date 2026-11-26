import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, SensitiveDialog, Table } from "@/components/admin-ui";
import { Button, ErrorBox, Notice, SkeletonList, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useStaff } from "@/lib/staff";
import { useI18n } from "@/l10n";

// Demandes sur les données (P-83) : export (fait par l'artisan) et suppression (exécutée ici, motif
// obligatoire, documents émis conservés pour l'obligation légale).
export const Route = createFileRoute("/admin/donnees")({ component: DataRequests });

interface Row { id: string; orgId: string; orgName: string | null; orgStatus: string; kind: string; status: string; origin: string; note: string | null; createdAt: string; handledAt: string | null; handledBy: string | null }

function DataRequests() {
  const { t, locale } = useI18n();
  const D = t.admin.data;
  const staff = useStaff();
  const list = useApi<{ items: Row[] }>("staff", "/v1/admin/data-requests");
  const [target, setTarget] = useState<{ row: Row; action: "execute" | "reject" } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div>
      <PageHead title={D.title} subtitle={D.subtitle} />
      <div className="space-y-4 p-5 lg:p-6">
        {notice && <Notice tone="ok">{notice}</Notice>}
        <Section title={D.requests}>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={4} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={D.none} columns={[
              { key: "d", label: D.cols.date, render: (r) => <span className="font-mono">{dateTimeOf(r.createdAt, locale)}</span> },
              { key: "o", label: D.cols.org, render: (r) => <Link to="/admin/organisations/$id" params={{ id: r.orgId }} className="font-semibold hover:underline">{r.orgName ?? (r.orgStatus === "deleted" ? D.deletedOrg : t.admin.orgs.unnamed)}</Link> },
              { key: "k", label: D.cols.kind, render: (r) => D.kinds[r.kind] ?? r.kind },
              { key: "f", label: D.cols.origin, render: (r) => D.origins[r.origin] ?? r.origin },
              { key: "s", label: D.cols.status, render: (r) => <StatusBadge status={r.status === "done" ? "succeeded" : r.status === "rejected" ? "failed" : "pending"} label={D.statuses[r.status] ?? r.status} /> },
              { key: "n", label: D.cols.note, render: (r) => <span className="text-ink-soft">{r.note ?? "—"}</span> },
              { key: "a", label: "", className: "text-right", render: (r) => staff?.role === "admin" && r.status === "pending" && r.kind === "deletion" ? (
                <span className="inline-flex gap-1">
                  <Button variant="danger" className="min-h-10 px-3" onClick={() => setTarget({ row: r, action: "execute" })}>{D.execute}</Button>
                  <Button variant="ghost" className="min-h-10 px-3" onClick={() => setTarget({ row: r, action: "reject" })}>{D.reject}</Button>
                </span>
              ) : null },
            ]} />
          )}
        </Section>
        <p className="text-[13px] text-muted">{D.help}</p>
      </div>
      {target?.action === "execute" && (
        <SensitiveDialog danger title={D.execute} description={D.executeConfirm(target.row.orgName ?? "—")} confirmLabel={D.execute} onClose={() => setTarget(null)} onConfirm={async (reason) => {
          const r = await api<{ counts: Record<string, number>; filesRemoved: number }>("staff", `/v1/admin/data-requests/${target.row.id}/execute`, { body: { reason } });
          setNotice(D.done(r.counts.messages ?? 0, r.counts.kept_documents ?? 0, r.filesRemoved));
          list.reload();
        }} />
      )}
      {target?.action === "reject" && (
        <SensitiveDialog title={D.reject} description={D.rejectConfirm} confirmLabel={D.reject} onClose={() => setTarget(null)} onConfirm={async (reason) => {
          await api("staff", `/v1/admin/data-requests/${target.row.id}/reject`, { body: { reason } });
          setNotice(D.rejected);
          list.reload();
        }} />
      )}
    </div>
  );
}
