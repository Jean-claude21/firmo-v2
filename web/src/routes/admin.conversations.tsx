import { createFileRoute, Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, Empty, ErrorBox, PageTitle, Select, SkeletonList } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/admin/conversations")({ component: Conversations });

interface Msg { id: string; orgId: string; orgName: string | null; channel: string; direction: string; kind: string; text: string | null; status: string; error: string | null; durationMs: number | null; createdAt: string }
interface Job { id: string; kind: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; updatedAt: string }

function Conversations() {
  const { t, locale } = useI18n();
  const C = t.admin.conv;
  const [tab, setTab] = useState<"messages" | "jobs">("messages");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [jobStatus, setJobStatus] = useState("failed");
  const messages = useApi<{ items: Msg[] }>("staff", tab === "messages" ? `/v1/admin/messages?status=${status}&channel=${channel}` : null);
  const jobs = useApi<{ counts: Record<string, number>; items: Job[] }>("staff", tab === "jobs" ? `/v1/admin/jobs?status=${jobStatus}` : null);
  const [retried, setRetried] = useState<Set<string>>(new Set());
  const config = useApi<{ channels: Array<{ code: string }> }>("staff", "/v1/admin/config");
  const time = (iso: string) => `${date(iso, locale)} ${new Date(iso).toLocaleTimeString(locale === "en" ? "en-GB" : "fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div>
      <PageTitle title={t.admin.nav.conversations} />
      <div className="mb-4 inline-flex rounded-[var(--radius-field)] border border-line bg-surface p-1" role="tablist">
        {(["messages", "jobs"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-10 rounded-[8px] px-4 font-medium ${tab === k ? "bg-ink text-white" : "text-muted"}`}>{C[k]}</button>
        ))}
      </div>

      {tab === "messages" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:w-1/2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={C.allStatuses}>
              <option value="">{C.allStatuses}</option>
              {["received", "processing", "processed", "failed", "sent"].map((s) => <option key={s} value={s}>{C.statuses[s]}</option>)}
            </Select>
            <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label={C.allChannels}>
              <option value="">{C.allChannels}</option>
              {config.data?.channels.map((c) => <option key={c.code} value={c.code}>{c.code}</option>)}
            </Select>
          </div>
          {messages.error && <ErrorBox onRetry={messages.reload} />}
          {messages.loading && !messages.data && <SkeletonList rows={8} />}
          {messages.data && messages.data.items.length === 0 && <div className="card"><Empty title={C.noMessages} /></div>}
          {messages.data && messages.data.items.length > 0 && (
            <ul className="card divide-y divide-line text-sm">
              {messages.data.items.map((m) => (
                <li key={m.id} className={`px-4 py-3 ${m.status === "failed" ? "bg-danger-soft/50" : ""}`}>
                  <p className="text-xs text-muted">
                    {time(m.createdAt)} · {m.channel} · {m.direction === "in" ? C.in : C.out} · {m.kind} · <span className={m.status === "failed" ? "font-semibold text-danger" : ""}>{C.statuses[m.status] ?? m.status}</span>
                    {m.durationMs ? ` · ${C.duration(m.durationMs)}` : ""} · <Link to="/admin/organisations/$id" params={{ id: m.orgId }} className="underline underline-offset-2">{m.orgName ?? t.admin.orgs.unnamed}</Link>
                  </p>
                  <p className="mt-1 whitespace-pre-line">{m.text}</p>
                  {m.error && <p className="mt-1 text-danger">{m.error}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "jobs" && (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {["failed", "pending", "running", "done"].map((s) => (
              <button key={s} onClick={() => setJobStatus(s)} className={`min-h-10 rounded-full px-4 text-sm font-medium ${jobStatus === s ? "bg-ink text-white" : "bg-surface text-ink ring-1 ring-line"}`}>
                {C.statuses[s]} {jobs.data?.counts[s] !== undefined ? `(${jobs.data.counts[s]})` : ""}
              </button>
            ))}
          </div>
          {jobs.error && <ErrorBox onRetry={jobs.reload} />}
          {jobs.loading && !jobs.data && <SkeletonList rows={6} />}
          {jobs.data && jobs.data.items.length === 0 && <div className="card"><Empty title={C.noJobs} /></div>}
          {jobs.data && jobs.data.items.length > 0 && (
            <ul className="card divide-y divide-line text-sm">
              {jobs.data.items.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{j.kind} <span className="font-normal text-muted">#{j.id} · {C.attempts(j.attempts, j.maxAttempts)} · {time(j.updatedAt)}</span></p>
                    {j.lastError && <p className="mt-1 break-words text-danger">{j.lastError}</p>}
                  </div>
                  {j.status === "failed" && (
                    <Button variant="outline" icon={<RotateCcw className="size-4" />} disabled={retried.has(j.id)} onClick={async () => { await api("staff", `/v1/admin/jobs/${j.id}/retry`, { body: {} }); setRetried(new Set([...retried, j.id])); }}>
                      {retried.has(j.id) ? C.retried : C.retry}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
