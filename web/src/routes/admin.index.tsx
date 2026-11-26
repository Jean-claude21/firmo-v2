import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, Clock3, MessageCircle, RefreshCw, Send, X } from "lucide-react";
import { useState } from "react";
import { Dot, KpiStrip, PageHead, Section, Table, timeOf } from "@/components/admin-ui";
import { Button, ErrorBox, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useT } from "@/l10n";

// Centre de commande (P-70) : ce qui tourne, ce qui casse, maintenant.
export const Route = createFileRoute("/admin/")({ component: Command });

interface CommandData {
  kpi: { inProgress: number; inProgressMessages: number; inProgressPdf: number; incidents: number; webhookRate: number | null; webhooks: number; pdfP95Ms: number | null; pdfCount: number };
  incident: { type: string; id: string; orgName: string | null; stage: string | null; error: string | null; at: string } | null;
  queue: Array<{ at: string; channel: string | null; orgName: string; orgId: string; op: string; status: string; durationMs: number | null; attempts: number | null; ref: string; refType: string }>;
  services: Array<{ id: string; label: string; enabled: boolean; lastAt: string | null; volume: number; p50Ms: number | null; failed: number }>;
  events: Array<{ name: string; at: string; orgName: string | null }>;
}

function since(iso: string, t: ReturnType<typeof useT>) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? t.admin.command.secondsAgo(Math.round(s)) : s < 3600 ? t.admin.command.minutesAgo(Math.round(s / 60)) : t.admin.command.hoursAgo(Math.round(s / 3600));
}

function Command() {
  const t = useT();
  const C = t.admin.command;
  const navigate = useNavigate();
  const [kind, setKind] = useState<"all" | "audio" | "image" | "pdf">("all");
  const data = useApi<CommandData>("staff", `/v1/admin/command?kind=${kind}`);
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());
  const d = data.data;
  const statusTone = (s: string) => (s === "processed" ? "ok" : s === "failed" ? "danger" : s === "processing" ? "info" : "warn") as "ok" | "danger" | "info" | "warn";

  return (
    <div>
      <PageHead
        title={C.title}
        subtitle={C.subtitle}
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-[13px] text-muted"><Clock3 className="size-4" aria-hidden />{C.refreshedAt(refreshedAt.toLocaleTimeString("fr-FR"))}</span>
            <Button variant="outline" icon={<RefreshCw className="size-4" />} onClick={() => { data.reload(); setRefreshedAt(new Date()); }}>{C.refresh}</Button>
          </>
        }
      />
      {data.error && <div className="p-6"><ErrorBox onRetry={data.reload} /></div>}
      {!d && !data.error && <div className="p-6"><SkeletonList rows={5} /></div>}
      {d && (
        <>
          <KpiStrip items={[
            { label: C.inProgress, value: d.kpi.inProgress, sub: C.inProgressSub(d.kpi.inProgressMessages, d.kpi.inProgressPdf) },
            { label: C.incidents, value: d.kpi.incidents, sub: d.kpi.incidents ? C.incidentsSub : C.noIncident, tone: d.kpi.incidents ? "danger" : undefined },
            { label: C.webhooks, value: d.kpi.webhookRate === null ? "—" : `${String(d.kpi.webhookRate).replace(".", ",")} %`, sub: C.webhooksSub(d.kpi.webhooks) },
            { label: C.pdf, value: d.kpi.pdfP95Ms === null ? "—" : `${(d.kpi.pdfP95Ms / 1000).toFixed(1).replace(".", ",")} s`, sub: C.pdfSub(d.kpi.pdfCount) },
          ]} />
          <div className="space-y-5 p-5 lg:p-6">
            {d.incident && (
              <div className="flex flex-wrap items-center gap-4 border border-danger/40 bg-danger-soft px-5 py-4">
                <AlertTriangle className="size-6 shrink-0 text-danger" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{C.incidentBanner(d.kpi.incidents)}</p>
                  <p className="text-[14px] text-ink-soft">{d.incident.error ?? d.incident.stage} · {d.incident.orgName ?? "—"} · {since(d.incident.at, t)}</p>
                </div>
                <Link to="/admin/incidents/$type/$id" params={{ type: d.incident.type, id: d.incident.id }} className="inline-flex min-h-11 items-center gap-2 font-semibold text-danger">{C.examine} <ArrowRight className="size-4" aria-hidden /></Link>
              </div>
            )}

            <Section title={C.queue} subtitle={C.queueSub(d.queue.length)} actions={
              <div className="flex gap-1" role="tablist" aria-label={C.queue}>
                {(["all", "audio", "image", "pdf"] as const).map((k) => (
                  <button key={k} role="tab" type="button" aria-selected={kind === k} onClick={() => setKind(k)} className={`min-h-10 rounded-[var(--radius-field)] px-3 text-[14px] ${kind === k ? "border border-line bg-paper-alt font-semibold" : "text-ink-soft hover:bg-paper"}`}>{C.kinds[k]}</button>
                ))}
              </div>
            }>
              <Table
                rows={d.queue}
                rowKey={(r) => r.ref + r.at}
                empty={C.queueEmpty}
                rowClass={(r) => (r.status === "failed" ? "bg-danger-soft/60" : "")}
                onRow={(r) => (r.status === "failed" && r.refType === "message" ? navigate({ to: "/admin/incidents/$type/$id", params: { type: "message", id: r.ref } }) : navigate({ to: "/admin/organisations/$id", params: { id: r.orgId } }))}
                columns={[
                  { key: "at", label: C.cols.received, render: (r) => <span className="font-mono">{timeOf(r.at)}</span> },
                  { key: "ch", label: C.cols.channel, render: (r) => r.channel ? <span className="inline-flex items-center gap-2">{r.channel === "telegram" ? <Send className="size-4" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}{C.channels[r.channel] ?? r.channel}</span> : "—" },
                  { key: "org", label: C.cols.org, render: (r) => <span className="font-semibold">{r.orgName ?? t.admin.orgs.unnamed}</span> },
                  { key: "op", label: C.cols.operation, render: (r) => C.ops[r.op] ?? r.op },
                  { key: "st", label: C.cols.state, render: (r) => <span className="inline-flex items-center gap-2 text-[13px]"><Dot tone={statusTone(r.status)} />{C.states[r.status] ?? r.status}</span> },
                  { key: "dur", label: C.cols.duration, render: (r) => r.status === "failed" ? <span className="font-mono">{C.attempts(r.attempts ?? 1)}</span> : <span className="font-mono">{r.durationMs === null ? "—" : `${(r.durationMs / 1000).toFixed(1).replace(".", ",")} s`}</span> },
                  { key: "go", label: "", className: "w-12 text-right", render: (r) => r.status === "failed" ? <span className="font-semibold text-danger underline underline-offset-4">{C.examine}</span> : <ArrowUpRight className="ml-auto size-4" aria-hidden /> },
                ]}
              />
            </Section>

            <div className="grid gap-5 xl:grid-cols-2">
              <Section title={C.services} subtitle={C.servicesSub}>
                {d.services.length === 0 && <p className="px-5 py-6 text-muted">—</p>}
                {d.services.map((s) => {
                  const recent = s.lastAt && Date.now() - new Date(s.lastAt).getTime() < 86_400_000;
                  const ok = s.enabled && s.failed === 0;
                  return (
                    <div key={s.id} className="flex items-center gap-4 border-b border-line px-5 py-4 last:border-0">
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full border ${ok ? "border-ok/40 text-ok" : "border-danger/40 text-danger"}`}>{ok ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{C.serviceNames[s.label] ?? s.label}</p>
                        <p className="text-[13px] text-muted">{!s.enabled ? C.disabled : s.lastAt ? `${C.lastSeen(since(s.lastAt, t))} · ${C.volume(s.volume)}` : C.never}</p>
                      </div>
                      <span className="font-mono text-[13px] text-ink-soft">{s.p50Ms !== null ? `${s.p50Ms} ms` : recent ? "" : ""}{s.failed ? ` · ${C.failed(s.failed)}` : ""}</span>
                    </div>
                  );
                })}
              </Section>
              <Section title={C.events} subtitle={C.eventsSub}>
                {d.events.length === 0 && <p className="px-5 py-6 text-muted">—</p>}
                {d.events.map((e, i) => (
                  <div key={i} className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
                    <span className="w-12 shrink-0 font-mono text-[13px] text-muted">{new Date(e.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                    <div className="min-w-0">
                      <p className="font-mono text-[14px] font-semibold">{e.name}</p>
                      <p className="text-[13px] text-muted">{e.orgName ?? "—"}</p>
                    </div>
                  </div>
                ))}
              </Section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
