import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Ban, Gift, PlayCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button, Card, ErrorBox, Notice, SkeletonList, StatusBadge } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";
import { useStaff } from "./admin";

export const Route = createFileRoute("/admin/organisations/$id")({ component: OrganizationPage });

interface Detail {
  org: { id: string; name: string | null; status: string; country: string; currency: string; locale: string; trade: string | null; phone: string | null; email: string | null; template: string; createdAt: string };
  stats: Record<string, number>;
  identities: Array<{ channel: string; name: string | null; createdAt: string; lastSeenAt: string }>;
  documents: Array<{ id: string; type: string; status: string; number: string | null; totalMinor: string; client: string | null; createdAt: string }>;
  messages: Array<{ id: string; direction: string; kind: string; text: string | null; status: string; error: string | null; createdAt: string }>;
  subscriptions: Array<{ kind: string; quota: number; used: number; periodStart: string; periodEnd: string | null; endedAt: string | null }>;
  payments: Array<{ id: string; reference: string; status: string; kind: string; amountMinor: string; currency: string; provider: string; providerReference: string | null; createdAt: string }>;
}

function OrganizationPage() {
  const { t, locale } = useI18n();
  const O = t.admin.orgs;
  const { id } = Route.useParams();
  const staff = useStaff();
  const detail = useApi<Detail>("staff", `/v1/admin/organizations/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = staff?.role === "admin";
  const config = useApi<{ plans: Array<{ code: string; currency_code: string; active: boolean }> }>("staff", isAdmin ? "/v1/admin/config" : null);
  const grantPlan = config.data?.plans.find((p) => p.active && p.currency_code === detail.data?.org.currency)?.code;

  async function act(name: string, path: string, body: unknown, done?: string) {
    setBusy(name);
    setError(null);
    try {
      await api("staff", path, { body });
      if (done) setNotice(done);
      detail.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  // Rapprochement (P-56) : relu chez le fournisseur, appliqué une fois, motif au journal.
  async function reconcile(paymentId: string) {
    const reason = prompt(t.admin.config.reconcileReason);
    if (!reason || reason.trim().length < 3) return;
    setBusy(`reconcile:${paymentId}`);
    setError(null);
    try {
      const r = await api<{ result: string }>("staff", `/v1/admin/payments/${paymentId}/reconcile`, { body: { reason } });
      setNotice(t.admin.config.reconcileResult[r.result] ?? r.result);
      detail.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  if (detail.error) return <ErrorBox onRetry={detail.reload} />;
  if (!detail.data) return <SkeletonList rows={6} />;
  const d = detail.data;

  return (
    <div className="space-y-5">
      <Link to="/admin/organisations" className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> {t.admin.nav.organizations}</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl font-bold">{d.org.name ?? O.unnamed}</h1>
          <p className="text-muted">{d.org.country} · {d.org.currency} · {d.org.locale} · {O.created} {date(d.org.createdAt, locale)}</p>
        </div>
        <StatusBadge status={d.org.status === "active" ? "accepted" : "cancelled"} />
      </div>
      {error && <Notice tone="warn">{error.message}</Notice>}
      {notice && <Notice tone="ok">{notice}</Notice>}
      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          {d.org.status === "active" ? (
            <Button variant="danger" icon={<Ban className="size-4" />} loading={busy === "status"} onClick={() => confirm(O.suspendConfirm) && act("status", `/v1/admin/organizations/${id}/status`, { status: "suspended" })}>{O.suspend}</Button>
          ) : (
            <Button variant="outline" icon={<PlayCircle className="size-4" />} loading={busy === "status"} onClick={() => act("status", `/v1/admin/organizations/${id}/status`, { status: "active" })}>{O.activate}</Button>
          )}
          {grantPlan && (
            <Button variant="outline" icon={<Gift className="size-4" />} loading={busy === "grant"} onClick={() => act("grant", `/v1/admin/organizations/${id}/grant`, { planCode: grantPlan }, O.grantDone)}>{O.grant}</Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-1 text-sm">
          <p className="mb-2 font-semibold">{O.profile}</p>
          <p>{d.org.phone ?? "—"}</p>
          <p>{d.org.email ?? "—"}</p>
          <p className="text-muted">{d.org.trade ?? "—"} · {d.org.template}</p>
        </Card>
        <Card className="space-y-2 text-sm">
          <p className="font-semibold">{O.identities}</p>
          {d.identities.map((i) => <p key={i.channel + i.createdAt}>{i.channel} · {i.name ?? "—"} · {date(i.lastSeenAt, locale)}</p>)}
        </Card>
        <Card className="space-y-2 text-sm">
          <p className="font-semibold">{O.subscriptions}</p>
          {d.subscriptions.map((s) => (
            <p key={s.periodStart}>{s.kind} · {s.used}/{s.quota}{s.periodEnd ? ` · → ${date(s.periodEnd, locale)}` : ""}{s.endedAt ? " · ✕" : ""}</p>
          ))}
          {d.payments.map((p) => (
            <div key={p.reference} className="flex flex-wrap items-center justify-between gap-2 text-muted">
              <span>{p.reference} · {p.provider}{p.kind === "top_up" ? ` · ${t.app.subscription.topUpKind}` : ""} · {p.status} · {p.amountMinor} {p.currency}</span>
              {isAdmin && p.status === "pending" && p.providerReference && p.provider !== "simulator" && (
                <Button variant="ghost" icon={<RefreshCw className="size-4" />} loading={busy === `reconcile:${p.id}`} onClick={() => reconcile(p.id)}>{t.admin.config.reconcile}</Button>
              )}
            </div>
          ))}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-hidden">
          <p className="border-b border-line px-4 py-3 font-semibold">{O.recentDocuments}</p>
          <ul className="divide-y divide-line text-sm">
            {d.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span>{doc.number ?? doc.type} · {doc.client ?? "—"}</span>
                <span className="flex items-center gap-2 tabular-nums">{doc.totalMinor} <StatusBadge status={doc.status} /></span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card overflow-hidden">
          <p className="border-b border-line px-4 py-3 font-semibold">{O.recentMessages}</p>
          <ul className="max-h-[480px] divide-y divide-line overflow-y-auto text-sm">
            {d.messages.map((m) => (
              <li key={m.id} className={`px-4 py-2.5 ${m.direction === "out" ? "bg-paper" : ""}`}>
                <p className="text-xs text-muted">{m.direction === "in" ? t.admin.conv.in : t.admin.conv.out} · {m.kind} · {date(m.createdAt, locale)} · {t.admin.conv.statuses[m.status] ?? m.status}</p>
                <p className="whitespace-pre-line">{m.text}</p>
                {m.error && <p className="text-danger">{m.error}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
