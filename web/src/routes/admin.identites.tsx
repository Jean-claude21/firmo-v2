import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, Table } from "@/components/admin-ui";
import { ErrorBox, Notice, Select, SkeletonList } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";

// Identités de messagerie (P-73). Un administrateur peut autoriser l'identité d'un membre de
// l'équipe à recevoir un lien d'administration en écrivant « ADMIN » (P-76).
export const Route = createFileRoute("/admin/identites")({ component: Identities });

interface Row { id: string; orgId: string; orgName: string | null; channel: string; name: string | null; externalId: string; staffEmail: string | null; createdAt: string; lastSeenAt: string }

function Identities() {
  const { t, locale } = useI18n();
  const L = t.admin.lists;
  const me = useStaff();
  const list = useApi<{ items: Row[] }>("staff", "/v1/admin/identities");
  const team = useApi<{ items: Array<{ userId: string; email: string }> }>("staff", me?.role === "admin" ? "/v1/admin/staff" : null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function authorize(row: Row, userId: string) {
    setError(null);
    try {
      const current = team.data?.items.find((m) => m.email === row.staffEmail);
      if (userId) await api("staff", `/v1/admin/identities/${row.id}/staff`, { body: { staffUserId: userId, allow: true } });
      else if (current) await api("staff", `/v1/admin/identities/${row.id}/staff`, { body: { staffUserId: current.userId, allow: false } });
      setNotice(userId ? L.authorized : L.revoked);
      list.reload();
    } catch (e) {
      setError(e as ApiError);
    }
  }
  return (
    <div>
      <PageHead title={t.admin.nav.identities} subtitle={L.identitiesSub} />
      <div className="space-y-4 p-5 lg:p-6">
        {notice && <Notice tone="ok">{notice}</Notice>}
        {error && <Notice tone="warn">{error.message}</Notice>}
        <Section title={L.identities}>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={5} /></div>}
          {list.data && (
            <Table rows={list.data.items} rowKey={(r) => r.id} empty={L.empty} columns={[
              { key: "c", label: L.cols.channel, render: (r) => t.admin.command.channels[r.channel] ?? r.channel },
              { key: "e", label: L.cols.identifier, render: (r) => <span className="font-mono">{r.externalId}</span> },
              { key: "n", label: L.cols.name, render: (r) => r.name ?? "—" },
              { key: "o", label: L.cols.org, render: (r) => <Link to="/admin/organisations/$id" params={{ id: r.orgId }} className="font-semibold hover:underline">{r.orgName ?? t.admin.orgs.unnamed}</Link> },
              { key: "l", label: L.cols.lastSeen, render: (r) => dateTimeOf(r.lastSeenAt, locale) },
              { key: "a", label: L.cols.adminAccess, render: (r) => me?.role === "admin" && team.data ? (
                <Select value={team.data.items.find((m) => m.email === r.staffEmail)?.userId ?? ""} onChange={(e) => authorize(r, e.target.value)} aria-label={L.cols.adminAccess} className="min-h-10 w-56">
                  <option value="">{L.noAccess}</option>
                  {team.data.items.map((m) => <option key={m.userId} value={m.userId}>{m.email}</option>)}
                </Select>
              ) : (r.staffEmail ?? "—") },
            ]} />
          )}
        </Section>
        <p className="text-[13px] text-muted">{L.adminHelp}</p>
      </div>
    </div>
  );
}
