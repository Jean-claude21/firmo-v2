import { createFileRoute, Link } from "@tanstack/react-router";
import { Ban, ChevronRight, Copy, Eye, Gift, Link2, MessageSquareText, PlayCircle, RotateCcw } from "lucide-react";
import { useState } from "react";
import { dateTimeOf, KpiStrip, PageHead, Section, SensitiveDialog, Table } from "@/components/admin-ui";
import { Button, ErrorBox, Field, Notice, SkeletonList, StatusBadge, Tabs, Textarea } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";

// Organisation (P-72, maquette v1 « admin/organization ») : en-tête, offre, utilisation, canal,
// activité ; onglets ; support (lien d'accès, quota, message, suspension) avec motif obligatoire.
export const Route = createFileRoute("/admin/organisations/$id")({ component: OrganizationPage });

interface Detail {
  org: { id: string; name: string | null; status: string; country: string; currency: string; locale: string; tradeLabel: string | null; phone: string | null; email: string | null; address: string | null; template: string; brandColor: string; hasLogo: boolean; legal: string | null; createdAt: string };
  entitlement: { kind: string; quota: number; used: number; remaining: number; periodEnd: string | null; planLabel: string | null } | null;
  counts: { documents: number; payments: number };
  lastActivity: string | null;
  pricesRevealedUntil: string | null;
  identities: Array<{ id: string; channel: string; name: string | null; createdAt: string; lastSeenAt: string }>;
  documents: Array<{ id: string; type: string; status: string; number: string | null; totalMinor: string | null; client: string | null; createdAt: string }>;
  subscriptions: Array<{ kind: string; quota: number; used: number; periodStart: string; periodEnd: string | null; endedAt: string | null }>;
  payments: Array<{ id: string; reference: string; status: string; kind: string; amountMinor: string; currency: string; provider: string; providerReference: string | null; createdAt: string }>;
}

type Dialog = null | "suspend" | "activate" | "reset" | "reveal" | "grant";
type Tab = "overview" | "documents" | "payments" | "audit";

function OrganizationPage() {
  const { t, locale } = useI18n();
  const O = t.admin.orgs;
  const { id } = Route.useParams();
  const staff = useStaff();
  const isAdmin = staff?.role === "admin";
  const detail = useApi<Detail>("staff", `/v1/admin/organizations/${id}`);
  const audit = useApi<{ items: Array<{ id: number; actor: string; action: string; entity: string; reason: string | null; at: string }> }>("staff", `/v1/admin/organizations/${id}/audit`);
  const config = useApi<{ plans: Array<{ code: string; currency_code: string; active: boolean }> }>("staff", isAdmin ? "/v1/admin/config" : null);
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [link, setLink] = useState<{ url: string; minutes: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const grantPlan = config.data?.plans.find((p) => p.active && p.currency_code === detail.data?.org.currency)?.code;

  const reload = () => {
    detail.reload();
    audit.reload();
  };
  async function post(path: string, body: unknown, done?: string) {
    await api("staff", path, { body });
    if (done) setNotice(done);
    reload();
  }

  if (detail.error) return <div className="p-6"><ErrorBox onRetry={detail.reload} /></div>;
  if (!detail.data) return <div className="p-6"><SkeletonList rows={6} /></div>;
  const d = detail.data;
  const main = d.identities[0];
  const shown = Boolean(d.pricesRevealedUntil);
  const field = (label: string, value: React.ReactNode, mono = false) => (
    <div className="border-b border-line px-5 py-4 sm:border-r [&:nth-child(2n)]:border-r-0">
      <p className="text-[12px] text-muted">{label}</p>
      <p className={`mt-1 ${mono ? "font-mono" : ""}`}>{value || <span className="text-muted">{O.notSet}</span>}</p>
    </div>
  );

  return (
    <div>
      <PageHead
        crumbs={<span className="inline-flex items-center gap-2"><Link to="/admin/organisations" className="underline underline-offset-4">{t.admin.nav.organizations}</Link><ChevronRight className="size-4" aria-hidden />{d.org.name ?? O.unnamed}</span>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{d.org.name ?? O.unnamed}<span className="inline-flex items-center gap-1.5 text-[13px] font-normal"><span className={`size-2 rounded-full ${d.org.status === "active" ? "bg-ok" : "bg-danger"}`} aria-hidden />{d.org.status === "active" ? O.active : O.suspended}</span></span>}
        subtitle={O.createdOn(date(d.org.createdAt, locale))}
        actions={isAdmin && (
          <Button icon={<Link2 className="size-4" />} loading={busy === "link"} onClick={async () => {
            setBusy("link");
            setError(null);
            try {
              setLink(await api<{ url: string; minutes: number }>("staff", `/v1/admin/organizations/${id}/access-link`, { body: {} }));
              reload();
            } catch (e) {
              setError(e as ApiError);
            } finally {
              setBusy(null);
            }
          }}>{O.sendLink}</Button>
        )}
      />
      <KpiStrip items={[
        { label: O.plan, value: <span className="font-sans text-[22px]">{d.entitlement ? (d.entitlement.planLabel ?? t.admin.kinds[d.entitlement.kind as keyof typeof t.admin.kinds] ?? d.entitlement.kind) : O.noPlan}</span>, sub: d.entitlement?.periodEnd ? O.until(date(d.entitlement.periodEnd, locale)) : d.entitlement?.kind === "trial" ? O.trial : "" },
        { label: O.usage, value: d.entitlement ? `${d.entitlement.used} / ${d.entitlement.quota}` : "—", sub: O.usageSub },
        { label: O.mainChannel, value: <span className="font-sans text-[22px]">{main ? (t.admin.command.channels[main.channel] ?? main.channel) : "—"}</span>, sub: main ? O.identitiesCount(d.identities.length) : "" },
        { label: O.lastActivity, value: d.lastActivity ? new Date(d.lastActivity).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "—", sub: d.lastActivity ? date(d.lastActivity, locale) : O.noActivity },
      ]} />
      <div className="border-b border-line bg-surface px-3">
        <div className="max-w-xl">
          <Tabs<Tab> value={tab} onChange={setTab} items={[
            { value: "overview", label: O.tabs.overview },
            { value: "documents", label: `${O.tabs.documents} ${d.counts.documents}` },
            { value: "payments", label: `${O.tabs.payments} ${d.counts.payments}` },
            { value: "audit", label: O.tabs.audit },
          ]} />
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:p-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          {notice && <Notice tone="ok">{notice}</Notice>}
          {error && <Notice tone="warn">{error.message}</Notice>}
          {link && (
            <div className="flex flex-wrap items-center gap-3 border border-line bg-surface px-5 py-4">
              <p className="min-w-0 flex-1"><span className="font-semibold">{O.linkReady(link.minutes)}</span><span className="block truncate font-mono text-[13px] text-muted">{link.url}</span></p>
              <Button variant="outline" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(link.url).then(() => setNotice(t.common.copied))}>{t.common.copy}</Button>
            </div>
          )}
          {tab === "overview" && (
            <>
              <Section title={O.profile} subtitle={O.profileSub}>
                <div className="grid sm:grid-cols-2">
                  {field(O.fields.name, d.org.name)}
                  {field(O.fields.trade, d.org.tradeLabel)}
                  {field(O.fields.phone, d.org.phone, true)}
                  {field(O.fields.language, d.org.locale === "en" ? "English" : "Français")}
                  {field(O.fields.email, d.org.email)}
                  {field(O.fields.address, d.org.address)}
                  {field(O.fields.color, <span className="inline-flex items-center gap-2"><span className="size-4 border border-line" style={{ background: d.org.brandColor }} aria-hidden /><span className="font-mono">{d.org.brandColor}</span></span>)}
                  {field(O.fields.legal, d.org.legal)}
                </div>
              </Section>
              <DocumentsTable d={d} id={id} shown={shown} onReveal={() => setDialog("reveal")} limit={5} />
              <Section title={O.identities}>
                {d.identities.map((i) => <p key={i.id} className="border-b border-line px-5 py-3 text-[14px] last:border-0"><span className="font-semibold">{t.admin.command.channels[i.channel] ?? i.channel}</span> · {i.name ?? "—"} · {dateTimeOf(i.lastSeenAt, locale)}</p>)}
              </Section>
            </>
          )}
          {tab === "documents" && <DocumentsTable d={d} id={id} shown={shown} onReveal={() => setDialog("reveal")} limit={50} />}
          {tab === "payments" && (
            <Section title={O.tabs.payments}>
              <Table rows={d.payments} rowKey={(p) => p.id} empty={O.noPayments} columns={[
                { key: "ref", label: O.cols.reference, render: (p) => <span className="font-mono">{p.reference}</span> },
                { key: "kind", label: O.cols.kind, render: (p) => (p.kind === "top_up" ? t.app.subscription.topUpKind : t.admin.kinds.paid) },
                { key: "amount", label: O.cols.amount, className: "text-right", render: (p) => <span className="font-mono">{p.amountMinor} {p.currency}</span> },
                { key: "provider", label: O.cols.provider, render: (p) => p.provider },
                { key: "status", label: O.cols.status, render: (p) => <StatusBadge status={p.status} label={t.app.subscription.statuses[p.status]} /> },
                { key: "date", label: O.cols.date, render: (p) => dateTimeOf(p.createdAt, locale) },
              ]} />
            </Section>
          )}
          {tab === "audit" && (
            <Section title={O.tabs.audit} subtitle={O.auditSub}>
              <Table rows={audit.data?.items ?? []} rowKey={(a) => String(a.id)} empty={O.noAudit} columns={[
                { key: "at", label: O.cols.date, render: (a) => <span className="font-mono">{dateTimeOf(a.at, locale)}</span> },
                { key: "actor", label: O.cols.actor, render: (a) => a.actor },
                { key: "action", label: O.cols.action, render: (a) => <span className="font-mono text-[13px]">{a.action}</span> },
                { key: "reason", label: O.cols.reason, render: (a) => <span className="text-ink-soft">{a.reason ?? "—"}</span> },
              ]} />
            </Section>
          )}
        </div>

        <aside className="space-y-4">
          <Section title={O.support} subtitle={O.supportSub}>
            {isAdmin ? (
              <>
                <button type="button" className="flex w-full items-center gap-3 border-b border-line px-5 py-4 text-left hover:bg-paper" onClick={() => setDialog("reset")}>
                  <RotateCcw className="size-5 shrink-0" aria-hidden />
                  <span className="flex-1"><span className="block font-semibold">{O.resetQuota}</span><span className="block text-[13px] text-muted">{O.resetQuotaSub}</span></span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </button>
                <button type="button" className="flex w-full items-center gap-3 border-b border-line px-5 py-4 text-left hover:bg-paper" onClick={() => setMessage("")}>
                  <MessageSquareText className="size-5 shrink-0" aria-hidden />
                  <span className="flex-1"><span className="block font-semibold">{O.sendMessage}</span><span className="block text-[13px] text-muted">{O.sendMessageSub}</span></span>
                  <ChevronRight className="size-4 text-muted" aria-hidden />
                </button>
                {grantPlan && (
                  <button type="button" className="flex w-full items-center gap-3 border-b border-line px-5 py-4 text-left hover:bg-paper" onClick={() => setDialog("grant")}>
                    <Gift className="size-5 shrink-0" aria-hidden />
                    <span className="flex-1"><span className="block font-semibold">{O.grant}</span><span className="block text-[13px] text-muted">{O.grantSub}</span></span>
                    <ChevronRight className="size-4 text-muted" aria-hidden />
                  </button>
                )}
                {message !== null && (
                  <form className="space-y-3 border-b border-line px-5 py-4" onSubmit={async (e) => {
                    e.preventDefault();
                    setError(null);
                    try {
                      await post(`/v1/admin/organizations/${id}/message`, { text: message }, O.messageSent);
                      setMessage(null);
                    } catch (err) {
                      setError(err as ApiError);
                    }
                  }}>
                    <Field label={O.messageLabel}><Textarea value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} required /></Field>
                    <div className="flex gap-2"><Button type="submit">{O.send}</Button><Button type="button" variant="ghost" onClick={() => setMessage(null)}>{t.common.cancel}</Button></div>
                  </form>
                )}
              </>
            ) : <p className="px-5 py-4 text-[14px] text-muted">{t.admin.readOnly}</p>}
            <div className="px-5 py-4">
              <p className="mono-label">{O.lastAction}</p>
              {audit.data?.items[0] ? <p className="mt-2 text-[14px]"><span className="font-semibold">{audit.data.items[0].action}</span><span className="block text-muted">{audit.data.items[0].actor} · {dateTimeOf(audit.data.items[0].at, locale)}</span></p> : <p className="mt-2 text-[14px] text-muted">—</p>}
            </div>
          </Section>
          {isAdmin && (
            <Section title={O.security}>
              <div className="px-5 py-4">
                {d.org.status === "active" ? (
                  <Button variant="danger" icon={<Ban className="size-4" />} onClick={() => setDialog("suspend")}>{O.suspend}</Button>
                ) : (
                  <Button variant="outline" icon={<PlayCircle className="size-4" />} onClick={() => setDialog("activate")}>{O.activate}</Button>
                )}
              </div>
            </Section>
          )}
        </aside>
      </div>

      {dialog === "suspend" && <SensitiveDialog danger title={O.suspend} description={O.suspendConfirm} confirmLabel={O.suspend} onClose={() => setDialog(null)} onConfirm={(reason) => post(`/v1/admin/organizations/${id}/status`, { status: "suspended", reason }, O.suspendedDone)} />}
      {dialog === "activate" && <SensitiveDialog title={O.activate} description={O.activateConfirm} confirmLabel={O.activate} onClose={() => setDialog(null)} onConfirm={(reason) => post(`/v1/admin/organizations/${id}/status`, { status: "active", reason }, O.activatedDone)} />}
      {dialog === "reset" && <SensitiveDialog title={O.resetQuota} description={O.resetQuotaConfirm} confirmLabel={O.resetQuota} onClose={() => setDialog(null)} onConfirm={(reason) => post(`/v1/admin/organizations/${id}/reset-quota`, { reason }, O.resetDone)} />}
      {dialog === "grant" && grantPlan && <SensitiveDialog title={O.grant} description={O.grantConfirm} confirmLabel={O.grant} onClose={() => setDialog(null)} onConfirm={(reason) => post(`/v1/admin/organizations/${id}/grant`, { planCode: grantPlan, reason }, O.grantDone)} />}
      {dialog === "reveal" && <SensitiveDialog title={O.revealPrices} description={O.revealConfirm} confirmLabel={O.revealPrices} onClose={() => setDialog(null)} onConfirm={(reason) => post(`/v1/admin/organizations/${id}/reveal`, { reason }, O.revealDone)} />}
    </div>
  );
}

function DocumentsTable({ d, id, shown, onReveal, limit }: { d: Detail; id: string; shown: boolean; onReveal: () => void; limit: number }) {
  const { t, locale } = useI18n();
  const O = t.admin.orgs;
  return (
    <Section title={O.recentDocuments} subtitle={shown ? O.pricesShownUntil(new Date(d.pricesRevealedUntil!).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })) : O.pricesHidden}
      actions={!shown ? <Button variant="outline" icon={<Eye className="size-4" />} onClick={onReveal}>{O.revealPrices}</Button> : <Link to="/admin/documents" search={{ org: id }} className="text-[14px] font-semibold">{O.allDocuments}</Link>}>
      <Table rows={d.documents.slice(0, limit)} rowKey={(r) => r.id} empty={O.noDocuments} columns={[
        { key: "n", label: O.cols.document, render: (r) => <span><span className="block font-mono">{r.number ?? t.app.documents.draftNumber}</span><span className="text-[12px] text-muted">{t.app.typeTag[r.type] ?? r.type}</span></span> },
        { key: "c", label: O.cols.client, render: (r) => r.client ?? "—" },
        { key: "a", label: O.cols.amount, className: "text-right", render: (r) => <span className="font-mono">{r.totalMinor === null ? "•••" : `${r.totalMinor} ${d.org.currency}`}</span> },
        { key: "s", label: O.cols.status, render: (r) => <StatusBadge status={r.status} /> },
        { key: "d", label: O.cols.created, render: (r) => dateTimeOf(r.createdAt, locale) },
      ]} />
    </Section>
  );
}
