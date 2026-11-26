import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { KpiStrip, PageHead, Section, Table } from "@/components/admin-ui";
import { ErrorBox, Select, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { type Currency, money } from "@/lib/format";
import { useI18n } from "@/l10n";

// Pilotage (P-78, ADM-2) : indicateurs et entonnoir calculés sur des agrégats réels.
export const Route = createFileRoute("/admin/pilotage")({ component: Pilotage });

interface Dash {
  organizations: number; organizations_new: number; organizations_active: number; documents_issued: number; documents_today: number;
  decisive_rate: number | null; decisive_cohort: number; reading_fidelity: number | null; quote_acceptance: number | null; quote_conversion: number | null;
  ai_cost_micro_usd: number; ai_calls: number; subscribers: number; revenue: Array<{ currency: string; amount_minor: string }>; currencies: Record<string, Currency>;
}
interface Pilot {
  funnel: { created: number; read: number; previewed: number; issued: number; shared7: number; paid: number };
  ai_by_task: Array<{ task: string; calls: number; failed: number; cost_micro_usd: number; p95_ms: number }>;
  failures_by_stage: Array<{ stage: string; count: number }>;
  jobs_failed_by_kind: Array<{ kind: string; count: number }>;
  cost_per_document_micro_usd: number | null;
  render_p95_ms: number | null;
}

const pct = (v: number | null) => (v === null ? "—" : `${String(v).replace(".", ",")} %`);
const usd = (micro: number | null) => (micro === null ? "—" : `${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)} $`);

function Pilotage() {
  const t = useI18n().t;
  const P = t.admin.pilotage;
  const [days, setDays] = useState(30);
  const dash = useApi<Dash>("staff", `/v1/admin/dashboard?days=${days}`);
  const pilot = useApi<Pilot>("staff", `/v1/admin/pilotage?days=${days}`);
  const d = dash.data;
  const p = pilot.data;
  const steps = p ? ([["created", p.funnel.created], ["read", p.funnel.read], ["previewed", p.funnel.previewed], ["issued", p.funnel.issued], ["shared7", p.funnel.shared7], ["paid", p.funnel.paid]] as const) : [];
  return (
    <div>
      <PageHead title={P.title} subtitle={P.subtitle} actions={
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={P.window} className="min-h-10 w-44">
          {[7, 30, 90].map((n) => <option key={n} value={n}>{t.admin.dashboard.window(n)}</option>)}
        </Select>
      } />
      {(dash.error || pilot.error) && <div className="p-6"><ErrorBox onRetry={() => { dash.reload(); pilot.reload(); }} /></div>}
      {(!d || !p) && !dash.error && !pilot.error && <div className="p-6"><SkeletonList rows={5} /></div>}
      {d && p && (
        <>
          <KpiStrip items={[
            { label: P.decisive, value: pct(d.decisive_rate), sub: t.admin.dashboard.cohort(d.decisive_cohort) },
            { label: P.organizations, value: d.organizations, sub: P.newActive(d.organizations_new, d.organizations_active) },
            { label: P.documents, value: d.documents_issued, sub: P.today(d.documents_today) },
            { label: P.revenue, value: <span className="text-[22px]">{d.revenue.length ? d.revenue.map((r) => (d.currencies[r.currency] ? money(r.amount_minor, d.currencies[r.currency]!) : `${r.amount_minor} ${r.currency}`)).join(" · ") : "—"}</span>, sub: P.subscribers(d.subscribers) },
          ]} />
          <div className="grid gap-5 p-5 lg:p-6 xl:grid-cols-2">
            <Section title={P.funnel} subtitle={P.funnelSub}>
              <div className="space-y-3 px-5 py-5">
                {steps.map(([key, n]) => {
                  const base = p.funnel.created || 1;
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-[14px]"><span>{P.steps[key]}</span><span className="font-mono">{n} · {Math.round((100 * n) / base)} %</span></div>
                      <div className="mt-1 h-2 bg-paper-alt"><div className="h-full bg-ink" style={{ width: `${Math.min(100, (100 * n) / base)}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            </Section>
            <Section title={P.quality}>
              <div className="grid grid-cols-2">
                {[[P.fidelity, pct(d.reading_fidelity)], [P.acceptance, pct(d.quote_acceptance)], [P.conversion, pct(d.quote_conversion)], [P.costPerDoc, usd(p.cost_per_document_micro_usd)], [P.aiCost, usd(d.ai_cost_micro_usd)], [P.renderP95, p.render_p95_ms === null ? "—" : `${p.render_p95_ms} ms`]].map(([l, v]) => (
                  <div key={l} className="border-b border-line px-5 py-4 odd:border-r"><p className="text-[12px] text-muted">{l}</p><p className="mt-1 font-mono text-[18px] font-semibold">{v}</p></div>
                ))}
              </div>
            </Section>
            <Section title={P.aiByTask}>
              <Table rows={p.ai_by_task} rowKey={(r) => r.task} empty="—" columns={[
                { key: "t", label: P.cols.task, render: (r) => <span className="font-mono">{r.task}</span> },
                { key: "c", label: P.cols.calls, className: "text-right", render: (r) => <span className="font-mono">{r.calls}</span> },
                { key: "f", label: P.cols.failed, className: "text-right", render: (r) => <span className={`font-mono ${r.failed ? "text-danger" : ""}`}>{r.failed}</span> },
                { key: "p", label: "p95", className: "text-right", render: (r) => <span className="font-mono">{r.p95_ms} ms</span> },
                { key: "$", label: P.cols.cost, className: "text-right", render: (r) => <span className="font-mono">{usd(r.cost_micro_usd)}</span> },
              ]} />
            </Section>
            <Section title={P.failures}>
              <Table rows={[...p.failures_by_stage.map((f) => ({ k: `msg:${f.stage}`, n: f.count })), ...p.jobs_failed_by_kind.map((f) => ({ k: `job:${f.kind}`, n: f.count }))]} rowKey={(r) => r.k} empty={P.noFailure} columns={[
                { key: "k", label: P.cols.stage, render: (r) => <span className="font-mono">{r.k}</span> },
                { key: "n", label: P.cols.count, className: "text-right", render: (r) => <span className="font-mono text-danger">{r.n}</span> },
              ]} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
