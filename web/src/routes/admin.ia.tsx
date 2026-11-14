import { createFileRoute } from "@tanstack/react-router";
import { Card, Empty, ErrorBox, PageTitle, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/admin/ia")({ component: AiCosts });

interface Usage { task: string; model: string; calls: number; failures: number; costMicroUsd: number | null; unknownCost: number; avgMs: number; p95Ms: number }

const usd = (micro: number) => `$${(micro / 1_000_000).toFixed(micro < 10_000 ? 4 : 2)}`;

function AiCosts() {
  const { t } = useI18n();
  const A = t.admin.ai;
  const data = useApi<{ documents: number; items: Usage[] }>("staff", "/v1/admin/ai");
  const total = data.data?.items.reduce((s, i) => s + (i.costMicroUsd ?? 0), 0) ?? 0;
  return (
    <div className="space-y-5">
      <PageTitle title={t.admin.nav.ai} subtitle={A.intro} />
      {data.error && <ErrorBox onRetry={data.reload} />}
      {!data.data && !data.error && <SkeletonList rows={4} />}
      {data.data && (
        <>
          <Card>
            <p className="text-sm text-muted">{A.perDocument}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{data.data.documents ? usd(Math.round(total / data.data.documents)) : "—"}</p>
          </Card>
          {data.data.items.length === 0 ? <div className="card"><Empty title="—" /></div> : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr><th className="px-4 py-3">{A.task}</th><th className="px-4 py-3">{A.model}</th><th className="px-4 py-3 text-right">{A.calls}</th><th className="px-4 py-3 text-right">{A.failures}</th><th className="px-4 py-3 text-right">{A.cost}</th><th className="px-4 py-3 text-right">{A.latency}</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.data.items.map((i) => (
                    <tr key={i.task + i.model}>
                      <td className="px-4 py-3 font-medium">{i.task}</td>
                      <td className="px-4 py-3">{i.model}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{i.calls}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${i.failures ? "text-danger" : ""}`}>{i.failures}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{i.costMicroUsd !== null ? usd(i.costMicroUsd) : <span className="text-muted">{A.unknown}</span>}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{(i.avgMs / 1000).toFixed(1)} s / {(i.p95Ms / 1000).toFixed(1)} s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
