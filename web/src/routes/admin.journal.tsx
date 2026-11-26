import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Empty, ErrorBox, PageTitle, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/admin/journal")({ component: Audit });

interface Entry { id: number; actorType: string; actor: string | null; action: string; entity: string; entityId: string | null; before: unknown; after: unknown; createdAt: string }

function Audit() {
  const { t, locale } = useI18n();
  const A = t.admin.audit;
  const [page, setPage] = useState(1);
  const list = useApi<{ items: Entry[] }>("staff", `/v1/admin/audit?page=${page}`);
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-GB" : "fr-FR", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="px-5 py-6 lg:px-7">
      <PageTitle title={t.admin.nav.audit} />
      {list.error && <ErrorBox onRetry={list.reload} />}
      {!list.data && !list.error && <SkeletonList rows={8} />}
      {list.data && list.data.items.length === 0 && <div className="card"><Empty title={A.empty} /></div>}
      {list.data && list.data.items.length > 0 && (
        <ul className="card divide-y divide-line text-sm">
          {list.data.items.map((e) => (
            <li key={e.id} className="px-4 py-3">
              <p><span className="font-semibold">{e.action}</span> · {e.entity}{e.entityId ? ` ${e.entityId.slice(0, 8)}` : ""}</p>
              <p className="text-muted">{fmt(e.createdAt)} · {e.actor ?? e.actorType}</p>
              {(e.before !== null || e.after !== null) && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-muted">{A.details}</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-paper p-3 text-xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-between">
        <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.common.previous}</Button>
        <Button variant="outline" disabled={(list.data?.items.length ?? 0) < 50} onClick={() => setPage(page + 1)}>{t.common.next}</Button>
      </div>
    </div>
  );
}
