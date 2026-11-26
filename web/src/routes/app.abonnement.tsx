import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CreditCard, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Notice, PageTitle, SkeletonList, StatusBadge } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useMe } from "@/lib/portal";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/app/abonnement")({
  component: Subscription,
  validateSearch: (s: Record<string, unknown>): { paiement?: string } => (typeof s.paiement === "string" ? { paiement: s.paiement } : {}),
});

interface Billing {
  email: string | null;
  entitlement: { kind: string; quota: number; used: number; remaining: number; periodEnd: string | null } | null;
  plans: Array<{ code: string; label: string; priceMinor: string; quota: number; periodDays: number; graceDays: number }>;
  topUp: { documents: number; priceMinor: string } | null;
  conditions: { warnDays: number; graceDays: number; inGrace: boolean; graceEnd: string | null };
  providers: Array<{ code: string; label: string; simulated: boolean; needsEmail: boolean }>;
  payments: Array<{ id: string; reference: string; status: string; amountMinor: string; provider: string; plan: string; createdAt: string }>;
}

function Subscription() {
  const { t, locale } = useI18n();
  const S = t.app.subscription;
  const me = useMe();
  const { paiement } = Route.useSearch();
  const billing = useApi<Billing>("org", "/v1/billing");
  const [provider, setProvider] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [returned, setReturned] = useState<string | null>(null);

  useEffect(() => {
    if (billing.data && !provider) setProvider(billing.data.providers[0]?.code ?? "");
    if (billing.data?.email && !email) setEmail(billing.data.email);
  }, [billing.data, provider, email]);

  // Retour du fournisseur : on suit le paiement jusqu'à sa confirmation (webhook).
  useEffect(() => {
    if (!paiement) return;
    let stop = false;
    const poll = async (n: number) => {
      const p = await api<{ status: string }>("org", `/v1/billing/payments/${paiement}`).catch(() => null);
      if (stop) return;
      setReturned(p?.status ?? "pending");
      if (p?.status === "pending" && n < 20) setTimeout(() => poll(n + 1), 3000);
      else billing.reload();
    };
    void poll(0);
    return () => {
      stop = true;
    };
  }, [paiement, billing.reload]);

  async function subscribe(planCode: string, kind: "subscription" | "top_up" = "subscription") {
    setBusy(kind === "top_up" ? "top_up" : planCode);
    setError(null);
    try {
      const chosen = billing.data?.providers.find((p) => p.code === provider);
      const r = await api<{ checkoutUrl: string }>("org", "/v1/billing/checkout", {
        body: { planCode, provider, kind, ...(chosen?.needsEmail ? { email } : {}) },
      });
      location.href = r.checkoutUrl;
    } catch (e) {
      setError(e as ApiError);
      setBusy(null);
    }
  }

  const e = billing.data?.entitlement;
  const cur = me.data?.currency;
  const chosen = billing.data?.providers.find((p) => p.code === provider);

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <PageTitle title={S.title} />
      {returned === "pending" && <Notice tone="info"><span className="inline-flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{S.pending}</span></Notice>}
      {returned === "succeeded" && <Notice tone="ok"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" />{S.success}</span></Notice>}
      {returned && ["failed", "cancelled"].includes(returned) && <Notice tone="warn">{S.failed}</Notice>}
      {billing.error && <ErrorBox onRetry={billing.reload} />}
      {!billing.data && !billing.error && <SkeletonList rows={3} />}

      {billing.data && (
        <>
          <Card>
            <p className="text-sm text-muted">{S.current}</p>
            <p className="mt-1 text-xl font-bold">
              {!e ? S.none : e.kind === "trial" ? S.trial : e.kind === "grant" ? S.grant : S.paid}
              {e?.periodEnd && <span className="ml-2 text-base font-normal text-muted">{S.until(date(e.periodEnd, locale))}</span>}
            </p>
            {e && (
              <>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${e.remaining === 0 ? "bg-danger" : "bg-ok"}`} style={{ width: `${Math.min(100, (e.used / Math.max(1, e.quota)) * 100)}%` }} />
                </div>
                <p className="mt-2 text-muted">{S.remaining(e.remaining)}</p>
              </>
            )}
          </Card>
          {e && billing.data.conditions.inGrace && billing.data.conditions.graceEnd && <Notice tone="warn">{S.inGrace(date(billing.data.conditions.graceEnd, locale))}</Notice>}
          {!e && billing.data.payments.some((p) => p.status === "succeeded") && <Notice tone="warn">{S.expired}</Notice>}

          <section className="space-y-3">
            <h2 className="font-semibold">{S.plans}</h2>
            {billing.data.plans.length === 0 && <Notice tone="info">{S.noPlan}</Notice>}
            {billing.data.providers.length > 1 && (
              <Field label={S.provider}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {billing.data.providers.map((p) => (
                    <label key={p.code} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-[var(--radius-field)] border px-3 ${provider === p.code ? "border-ink ring-2 ring-ink" : "border-line"}`}>
                      <input type="radio" name="provider" className="accent-ink" checked={provider === p.code} onChange={() => setProvider(p.code)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </Field>
            )}
            {chosen?.simulated && <Notice tone="warn">{S.simulator}</Notice>}
            {chosen?.needsEmail && (
              <Field label={t.app.profile.email} error={error?.fields.email}>
                <Input type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} required />
              </Field>
            )}
            {cur && billing.data.plans.map((p) => (
              <Card key={p.code} className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-semibold">{p.label}</p>
                  <p className="mt-1 font-serif text-3xl font-bold">{money(p.priceMinor, cur)}<span className="ml-1 font-sans text-base font-normal text-muted">{S.perMonth}</span></p>
                  <p className="text-muted">{S.documents(p.quota)}</p>
                </div>
                <Button variant="accent" icon={<CreditCard className="size-4" />} loading={busy === p.code} disabled={!provider} onClick={() => subscribe(p.code)}>
                  {e?.kind === "paid" ? S.renew : S.subscribe}
                </Button>
              </Card>
            ))}
            {cur && billing.data.topUp && billing.data.plans[0] && (
              <Card className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-semibold">{S.topUpTitle}</p>
                  <p className="mt-1 font-serif text-3xl font-bold">{money(billing.data.topUp.priceMinor, cur)}</p>
                  <p className="text-muted">{S.topUp(billing.data.topUp.documents)}</p>
                </div>
                <Button variant="outline" icon={<CreditCard className="size-4" />} loading={busy === "top_up"} disabled={!provider} onClick={() => subscribe(billing.data!.plans[0]!.code, "top_up")}>
                  {S.buyTopUp}
                </Button>
              </Card>
            )}
            {error && !error.fields.email && <Notice tone="warn">{error.message}</Notice>}
          </section>

          {billing.data.plans[0] && (
            <section>
              <h2 className="mb-3 font-semibold">{S.conditionsTitle}</h2>
              <ul className="card list-disc space-y-2 py-4 pl-9 pr-4 text-sm text-muted">
                {S.conditions(billing.data.plans[0].periodDays, billing.data.conditions.warnDays, billing.data.plans[0].graceDays).map((c) => <li key={c}>{c}</li>)}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-semibold">{S.history}</h2>
            {billing.data.payments.length === 0 ? (
              <p className="text-muted">{S.noHistory}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {billing.data.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{p.plan} · {p.reference}</p>
                      <p className="text-sm text-muted">{date(p.createdAt, locale)}</p>
                    </div>
                    <div className="text-right">
                      {cur && <p className="font-semibold tabular-nums">{money(p.amountMinor, cur)}</p>}
                      <StatusBadge status={p.status === "succeeded" ? "paid" : p.status === "pending" ? "issued" : "refused"} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
