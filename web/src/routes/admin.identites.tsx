import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, SensitiveDialog, Table } from "@/components/admin-ui";
import { Button, ErrorBox, Field, Notice, Select, SkeletonList } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";

// Identités de messagerie (P-73). Un administrateur peut autoriser l'identité d'un membre de
// l'équipe à recevoir un lien d'administration en écrivant « ADMIN » (P-76), et rattacher le nouveau
// numéro d'un artisan à son organisation d'origine (spec 015).
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
  const [moving, setMoving] = useState<Row | null>(null);
  const [target, setTarget] = useState("");
  const [confirming, setConfirming] = useState(false);
  const M = t.admin.move;
  const orgs = [...new Map((list.data?.items ?? []).map((r) => [r.orgId, r.orgName ?? t.admin.orgs.unnamed])).entries()];
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
        {moving && (
          <Section title={M.title} subtitle={M.subtitle(moving.externalId, moving.orgName ?? t.admin.orgs.unnamed)}>
            <div className="flex flex-wrap items-end gap-3 px-5 py-5">
              <Field label={M.target}>
                <Select value={target} onChange={(e) => setTarget(e.target.value)} className="min-h-11 w-72">
                  <option value="">{M.choose}</option>
                  {orgs.filter(([id]) => id !== moving.orgId).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </Select>
              </Field>
              <Button disabled={!target} onClick={() => setConfirming(true)}>{M.continue}</Button>
              <Button variant="outline" onClick={() => { setMoving(null); setTarget(""); }}>{t.common.cancel}</Button>
            </div>
          </Section>
        )}
        {moving && confirming && (
          <SensitiveDialog danger title={M.title} description={M.confirm(moving.externalId, orgs.find(([id]) => id === target)?.[1] ?? "—")} confirmLabel={M.action}
            onClose={() => setConfirming(false)} onConfirm={async (reason) => {
              await api("staff", `/v1/admin/identities/${moving.id}/move`, { body: { targetOrgId: target, reason } });
              setConfirming(false); setMoving(null); setTarget("");
              setNotice(M.done);
              list.reload();
            }} />
        )}
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
              ...(me?.role === "admin" ? [{ key: "m", label: M.column, render: (r: Row) => <Button variant="outline" className="min-h-10 px-3" onClick={() => { setMoving(r); setTarget(""); setNotice(null); }}>{M.start}</Button> }] : []),
            ]} />
          )}
        </Section>
        <p className="text-[13px] text-muted">{L.adminHelp}</p>
      </div>
    </div>
  );
}
