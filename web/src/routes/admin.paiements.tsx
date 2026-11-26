import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, SensitiveDialog, Table } from "@/components/admin-ui";
import { Button, ErrorBox, Notice, Select, SkeletonList, StatusBadge } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";
import { ChariowPanel } from "@/components/chariow-panel";

// Paiements de l'abonnement (P-73) ; rapprochement d'un paiement en attente (P-56).
export const Route = createFileRoute("/admin/paiements")({ component: Payments });

interface Row { id: string; orgId: string; orgName: string | null; reference: string; status: string; kind: string; units: number | null; amountMinor: string; currency: string; provider: string; providerReference: string | null; createdAt: string; settledAt: string | null }

function Payments() {
  const { t, locale } = useI18n();
  const L = t.admin.lists;
  const staff = useStaff();
  const [status, setStatus] = useState("");
  const list = useApi<{ items: Row[] }>("staff", `/v1/admin/payments?status=${status}`);
  const [target, setTarget] = useState<Row | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div>
      <PageHead title={t.admin.nav.payments} subtitle={L.paymentsSub} />
      <div className="space-y-4 p-5 lg:p-6">
        {notice && <Notice tone="ok">{notice}</Notice>}
        <ChariowPanel />
        <Section title={L.payments} actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={L.status} className="min-h-10 w-44">
            <option value="">{L.allStatuses}</option>
            {["pending", "succeeded", "failed", "cancelled"].map((s) => <option key={s} value={s}>{t.app.subscription.statuses[s]}</option>)}
          </Select>
        }>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={5} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={L.empty} columns={[
              { key: "d", label: L.cols.created, render: (r) => <span className="font-mono">{dateTimeOf(r.createdAt, locale)}</span> },
              { key: "o", label: L.cols.org, render: (r) => <Link to="/admin/organisations/$id" params={{ id: r.orgId }} className="font-semibold hover:underline">{r.orgName ?? t.admin.orgs.unnamed}</Link> },
              { key: "r", label: L.cols.reference, render: (r) => <span className="font-mono">{r.reference}</span> },
              { key: "k", label: L.cols.kind, render: (r) => (r.kind === "top_up" ? `${t.app.subscription.topUpKind} · ${r.units}` : t.admin.kinds.paid) },
              { key: "a", label: L.cols.amount, className: "text-right", render: (r) => <span className="font-mono">{r.amountMinor} {r.currency}</span> },
              { key: "p", label: L.cols.provider, render: (r) => r.provider },
              { key: "s", label: L.cols.status, render: (r) => <StatusBadge status={r.status} label={t.app.subscription.statuses[r.status]} /> },
              { key: "x", label: "", className: "text-right", render: (r) => staff?.role === "admin" && r.status === "pending" && r.providerReference && r.provider !== "simulator" ? <Button variant="ghost" className="min-h-10 px-2" icon={<RefreshCw className="size-4" />} onClick={() => setTarget(r)}>{t.admin.config.reconcile}</Button> : null },
            ]} />
          )}
        </Section>
      </div>
      {target && (
        <SensitiveDialog title={t.admin.config.reconcile} description={L.reconcileHelp(target.reference)} confirmLabel={t.admin.config.reconcile} onClose={() => setTarget(null)} onConfirm={async (reason) => {
          const r = await api<{ result: string }>("staff", `/v1/admin/payments/${target.id}/reconcile`, { body: { reason } });
          setNotice(t.admin.config.reconcileResult[r.result] ?? r.result);
          list.reload();
        }} />
      )}
    </div>
  );
}
