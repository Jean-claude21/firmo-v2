import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronRight, MessageCircle, Pause, RotateCw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { dateTimeOf, PageHead, Section } from "@/components/admin-ui";
import { Button, ErrorBox, Field, Notice, SkeletonList, Textarea } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

// Détail d'un incident (P-71, maquette v1 « admin/incident ») : chronologie du traitement, entrée
// reçue, relance ou demande d'un nouveau média, clôture avec une note.
export const Route = createFileRoute("/admin/incidents/$type/$id")({ component: Incident });

interface Detail {
  type: string; id: string; orgId?: string; orgName?: string; channel?: string; kind?: string; status: string; error: string | null;
  identity?: string; input?: { kind: string; mediaType: string | null; hasMedia: boolean; textLength: number | null; durationMs: number | null };
  createdAt: string; processedAt?: string | null; attempts?: number; maxAttempts?: number; payload?: unknown;
  jobs?: Array<{ id: string; status: string; attempts: number; maxAttempts: number; error: string | null }>;
  replies?: Array<{ kind: string; text: string | null; at: string }>;
  timeline: Array<{ step: string; ok: boolean | null; at: string | null; detail: string | null }>;
  resolution: { note: string | null; by: string | null; at: string } | null;
}

function Incident() {
  const { t, locale } = useI18n();
  const I = t.admin.incidents;
  const { type, id } = Route.useParams();
  const d = useApi<Detail>("staff", `/v1/admin/incidents/${type}/${id}`);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  async function act(name: string, path: string, body: unknown = {}) {
    setBusy(name);
    setError(null);
    try {
      await api("staff", path, { body });
      setDone(name);
      d.reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }
  if (d.error) return <div className="p-6"><ErrorBox onRetry={d.reload} /></div>;
  if (!d.data) return <div className="p-6"><SkeletonList rows={5} /></div>;
  const x = d.data;
  const icon = (ok: boolean | null) => (ok === true ? <Check className="size-4 text-ok" aria-hidden /> : ok === false ? <X className="size-4 text-danger" aria-hidden /> : <Pause className="size-4 text-muted" aria-hidden />);
  const facts: Array<[string, React.ReactNode]> = [
    [I.org, x.orgId ? <Link to="/admin/organisations/$id" params={{ id: x.orgId }} className="font-semibold underline underline-offset-4">{x.orgName}</Link> : "—"],
    [I.channel, <span className="font-semibold">{x.channel ?? "—"}<span className="block font-mono text-[12px] font-normal text-muted">{x.identity ?? ""}</span></span>],
    [I.failedStep, <span className="font-mono font-semibold">{x.timeline.find((s) => s.ok === false)?.step ?? x.status}</span>],
    [I.impact, <span className="font-semibold">{x.replies?.length ? I.repliedAnyway : I.blocked}</span>],
  ];
  return (
    <div>
      <PageHead
        crumbs={<span className="inline-flex items-center gap-2"><Link to="/admin/incidents" className="underline underline-offset-4">{I.title}</Link><ChevronRight className="size-4" aria-hidden />{x.id.slice(0, 8)}</span>}
        title={<span className="inline-flex flex-wrap items-center gap-3">{!x.resolution && <span className="bg-danger px-2 py-0.5 font-mono text-[12px] font-bold text-white">{I.openBadge}</span>}{I.headline(x.kind ?? x.type)}</span>}
        subtitle={`${x.id.slice(0, 8)} · ${I.openedAt(dateTimeOf(x.createdAt, locale))}`}
      />
      <div className="grid border-b border-line bg-surface sm:grid-cols-2 xl:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="border-b border-line px-6 py-4 sm:border-r xl:border-b-0 lg:px-7"><p className="mono-label">{label}</p><div className="mt-1.5">{value}</div></div>
        ))}
      </div>
      <div className="grid gap-5 p-5 lg:p-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <Section title={I.timeline}>
            <ol className="px-5 py-3">
              {x.timeline.map((s, i) => (
                <li key={i} className="flex items-start gap-4 py-3">
                  <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-paper">{icon(s.ok)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{I.steps[s.step.split(":")[0] as keyof typeof I.steps] ?? s.step}{s.step.includes(":") ? <span className="font-mono text-[13px] font-normal text-muted"> · {s.step.split(":")[1]}</span> : null}</p>
                    <p className="text-[13px] text-muted">{s.at ? dateTimeOf(s.at, locale) : ""}{s.detail ? ` · ${s.detail}` : ""}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>
          {x.input && (
            <Section title={I.input} subtitle={I.inputSub}>
              <div className="grid sm:grid-cols-4">
                {[[I.inputKind, x.input.kind], [I.mediaType, x.input.mediaType ?? "—"], [I.media, x.input.hasMedia ? I.yes : I.no], [I.duration, x.input.durationMs ? `${x.input.durationMs} ms` : "—"]].map(([l, v]) => (
                  <div key={l} className="border-b border-line px-5 py-3 sm:border-r last:border-r-0"><p className="text-[12px] text-muted">{l}</p><p className="font-mono text-[14px]">{v}</p></div>
                ))}
              </div>
              {x.error && <div className="m-5 border border-danger/30 bg-danger-soft px-4 py-3"><p className="font-mono text-[13px] font-semibold text-danger">{I.error}</p><p className="mt-1 font-mono text-[13px]">{x.error}</p></div>}
            </Section>
          )}
          {x.jobs && x.jobs.length > 0 && (
            <Section title={I.jobs}>
              {x.jobs.map((j) => <p key={j.id} className="border-b border-line px-5 py-3 font-mono text-[13px] last:border-0">#{j.id} · {j.status} · {j.attempts}/{j.maxAttempts}{j.error ? ` · ${j.error}` : ""}</p>)}
            </Section>
          )}
        </div>
        <aside className="space-y-4">
          <Section title={I.resolution}>
            <div className="space-y-3 px-5 py-4">
              {x.resolution ? (
                <Notice tone="ok">{I.resolvedBy(x.resolution.by ?? "—", dateTimeOf(x.resolution.at, locale))}{x.resolution.note ? ` · ${x.resolution.note}` : ""}</Notice>
              ) : (
                <>
                  {x.type === "message" && <Button className="w-full" icon={<RotateCw className="size-4" />} loading={busy === "retry"} onClick={() => act("retry", `/v1/admin/incidents/message/${x.id}/retry`)}>{I.retry}</Button>}
                  {x.type === "message" && (x.kind === "audio" || x.kind === "image") && <Button variant="outline" className="w-full" icon={<MessageCircle className="size-4" />} loading={busy === "ask"} onClick={() => act("ask", `/v1/admin/incidents/message/${x.id}/ask-again`)}>{x.kind === "audio" ? I.askVoice : I.askPhoto}</Button>}
                  {done === "retry" && <Notice tone="ok">{I.retried}</Notice>}
                  {done === "ask" && <Notice tone="ok">{I.asked}</Notice>}
                  <Field label={I.note} optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
                  <Button variant="outline" className="w-full" icon={<Check className="size-4" />} loading={busy === "resolve"} onClick={() => act("resolve", `/v1/admin/incidents/${x.type}/${x.id}/resolve`, { note: note.trim() || null })}>{I.markResolved}</Button>
                </>
              )}
              {error && <Notice tone="warn">{error.message}</Notice>}
            </div>
          </Section>
          <p className="flex items-start gap-2 border border-line bg-paper-alt px-4 py-3 text-[13px] text-ink-soft"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />{I.audited}</p>
        </aside>
      </div>
    </div>
  );
}
