import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Info } from "lucide-react";
import { useState } from "react";
import { BarChart } from "@/components/bar-chart";
import { Card, ErrorBox, Select, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { type Currency, money } from "@/lib/format";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/admin/")({ component: AdminDashboard });

interface Dash {
  organizations: number;
  organizations_new: number;
  organizations_active: number;
  documents_issued: number;
  documents_today: number;
  messages: number;
  messages_failed: number;
  jobs_failed: number;
  decisive_rate: number | null;
  decisive_cohort: number;
  reading_fidelity: number | null;
  quote_acceptance: number | null;
  quote_conversion: number | null;
  ai_cost_micro_usd: number;
  ai_calls: number;
  ai_cost_unknown: number;
  revenue: Array<{ currency: string; amount_minor: string }>;
  subscribers: number;
  series: Array<{ day: string; documents: number; messages: number }>;
  currencies: Record<string, Currency>;
}

const pct = (v: number | null, empty: string) => (v === null ? empty : `${v.toLocaleString("fr-FR")} %`);
const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro >= 10_000_000 ? 0 : 2)}`;

function AdminDashboard() {
  const { t, locale } = useI18n();
  const D = t.admin.dashboard;
  const [days, setDays] = useState(30);
  const dash = useApi<Dash>("staff", `/v1/admin/dashboard?days=${days}`);
  const d = dash.data;

  const tile = (label: string, value: string | null, sub?: string, help?: string) => (
    <div className="card p-4" title={help}>
      <p className="flex items-center gap-1.5 text-sm text-muted">{label}{help && <Info className="size-3.5" aria-hidden />}</p>
      {value === null ? <Skeleton className="mt-2 h-7 w-20" /> : <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>}
      {sub && <p className="text-sm text-muted">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-serif text-3xl font-bold">{t.admin.nav.dashboard}</h1>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-48" aria-label={D.window(days)}>
          {[7, 30, 90].map((n) => <option key={n} value={n}>{D.window(n)}</option>)}
        </Select>
      </div>
      {dash.error && <ErrorBox onRetry={dash.reload} />}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tile(D.decisive, d ? pct(d.decisive_rate, D.noData) : null, d ? D.cohort(d.decisive_cohort) : undefined, D.decisiveHelp)}
        {tile(D.organizations, d ? String(d.organizations) : null, d ? `+${d.organizations_new} ${D.newOrgs} · ${d.organizations_active} ${D.active.toLowerCase()}` : undefined)}
        {tile(D.documents, d ? String(d.documents_issued) : null, d ? `${d.documents_today} ${D.today}` : undefined)}
        {tile(D.subscribers, d ? String(d.subscribers) : null)}
        {tile(D.fidelity, d ? pct(d.reading_fidelity, D.noData) : null)}
        {tile(D.acceptance, d ? pct(d.quote_acceptance, D.noData) : null)}
        {tile(D.conversion, d ? pct(d.quote_conversion, D.noData) : null)}
        {tile(D.aiCost, d ? usd(d.ai_cost_micro_usd) : null, d && d.documents_issued > 0 ? `${usd(Math.round(d.ai_cost_micro_usd / d.documents_issued))} ${D.perDocument}` : undefined)}
      </section>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          {d ? (
            <BarChart
              title={D.chartTitle}
              valueLabel={D.chartDocuments}
              labelHeader={D.chartDay}
              points={d.series.map((s) => ({
                label: new Date(`${s.day}T12:00:00`).toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short" }),
                value: s.documents,
                detail: `${D.chartMessages} : ${s.messages}`,
              }))}
            />
          ) : <Skeleton className="h-52 w-full" />}
        </Card>
        <div className="space-y-4">
          <Card>
            <p className="font-semibold">{D.revenue}</p>
            {d && d.revenue.length === 0 && <p className="mt-2 text-muted">{D.noData}</p>}
            {d?.revenue.map((r) => (
              <p key={r.currency} className="mt-2 text-xl font-bold tabular-nums">{d.currencies[r.currency] ? money(r.amount_minor, d.currencies[r.currency]!) : `${r.amount_minor} ${r.currency}`}</p>
            ))}
            {d && d.ai_cost_unknown > 0 && <p className="mt-3 text-sm text-muted">{D.unknownCost(d.ai_cost_unknown)}</p>}
          </Card>
          <Card>
            <p className="font-semibold">{D.health}</p>
            <Link to="/admin/conversations" className="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-field)] hover:bg-paper">
              <span className="flex items-center gap-2">{d && d.messages_failed > 0 && <AlertTriangle className="size-4 text-danger" aria-hidden />}{D.failedMessages}</span>
              <span className="font-semibold tabular-nums">{d?.messages_failed ?? "…"}</span>
            </Link>
            <Link to="/admin/conversations" className="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-field)] hover:bg-paper">
              <span className="flex items-center gap-2">{d && d.jobs_failed > 0 && <AlertTriangle className="size-4 text-danger" aria-hidden />}{D.failedJobs}</span>
              <span className="font-semibold tabular-nums">{d?.jobs_failed ?? "…"}</span>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
