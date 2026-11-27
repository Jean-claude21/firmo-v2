import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { dateTimeOf, PageHead, Section, Table } from "@/components/admin-ui";
import { ErrorBox, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

// Incidents (P-71) : traitements en échec, ouverts puis clos avec une note.
export const Route = createFileRoute("/admin/incidents/")({ component: Incidents });

interface Item { type: string; id: string; orgId: string | null; orgName: string | null; channel: string | null; stage: string | null; error: string | null; by: string | null; at: string }

function Incidents() {
  const { t, locale } = useI18n();
  const I = t.admin.incidents;
  const navigate = useNavigate();
  const [state, setState] = useState<"open" | "resolved">("open");
  const list = useApi<{ items: Item[] }>("staff", `/v1/admin/incidents?state=${state}`);
  return (
    <div>
      <PageHead title={I.title} subtitle={I.subtitle} />
      <div className="p-5 lg:p-6">
        <Section title={state === "open" ? I.open : I.resolved} actions={
          <div className="flex gap-1" role="tablist">
            {(["open", "resolved"] as const).map((s) => (
              <button key={s} role="tab" aria-selected={state === s} type="button" onClick={() => setState(s)} className={`min-h-10 rounded-[var(--radius-field)] px-3 text-[14px] ${state === s ? "border border-line bg-paper-alt font-semibold" : "text-ink-soft"}`}>{s === "open" ? I.open : I.resolved}</button>
            ))}
          </div>
        }>
          {list.error && <div className="p-5"><ErrorBox onRetry={list.reload} /></div>}
          {!list.data && !list.error && <div className="p-5"><SkeletonList rows={4} /></div>}
          {list.data && (
            <Table
              rows={list.data.items}
              rowKey={(r) => `${r.type}:${r.id}`}
              empty={state === "open" ? I.none : I.noneResolved}
              onRow={(r) => navigate({ to: "/admin/incidents/$type/$id", params: { type: r.type, id: r.id } })}
              columns={[
                { key: "at", label: I.cols.at, render: (r) => <span className="font-mono">{dateTimeOf(r.at, locale)}</span> },
                { key: "org", label: I.cols.org, render: (r) => <span className="font-semibold">{r.orgName ?? "—"}</span> },
                { key: "stage", label: I.cols.stage, render: (r) => <span className="font-mono text-[13px]">{r.type}:{r.stage ?? "—"}</span> },
                { key: "error", label: state === "open" ? I.cols.error : I.cols.note, render: (r) => <span className="line-clamp-1 text-ink-soft">{r.error ?? "—"}</span> },
                ...(state === "resolved" ? [{ key: "by", label: I.cols.by, render: (r: Item) => r.by ?? "—" }] : []),
              ]}
            />
          )}
        </Section>
      </div>
    </div>
  );
}
