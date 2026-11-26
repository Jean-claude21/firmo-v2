import { createFileRoute, Link } from "@tanstack/react-router";
import { FilePlus2, FileText, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { DocRow } from "@/components/doc-row";
import { Button, Empty, ErrorBox, PageTitle, Select, SkeletonList } from "@/components/ui";
import { useApi } from "@/lib/api";
import { type DocumentSummary, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

export const Route = createFileRoute("/app/documents/")({ component: Documents });

const STATUSES = ["draft", "issued", "accepted", "refused", "cancelled"] as const;

function Documents() {
  const t = useT();
  const me = useMe();
  const D = t.app.documents;
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setPage(1), [type, status, query]);
  const params = new URLSearchParams({ page: String(page), ...(type ? { type } : {}), ...(status ? { status } : {}), ...(query ? { search: query } : {}) });
  const list = useApi<{ items: DocumentSummary[]; total: number; pageSize: number }>("org", `/v1/portal/documents?${params}`);
  const currency = me.data?.currency;
  const filtered = Boolean(type || status || query);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageTitle
        title={D.title}
        action={
          <Link to="/app/documents/nouveau" className="inline-flex min-h-12 items-center gap-2 rounded-[var(--radius-field)] bg-ink px-4 font-semibold text-paper hover:bg-ink-soft">
            <FilePlus2 className="size-4" aria-hidden /> {D.new}
          </Link>
        }
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative block">
          <span className="sr-only">{t.common.search}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-9" placeholder={D.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select value={type} onChange={(e) => setType(e.target.value)} aria-label={D.allTypes}>
          <option value="">{D.allTypes}</option>
          {me.data?.reference.documentTypes.map((d) => <option key={d.code} value={d.code}>{d.label}</option>)}
          <option value="receipt">{t.app.document.receipt}</option>
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={D.allStatuses}>
          <option value="">{D.allStatuses}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t.status[s]}</option>)}
        </Select>
      </div>

      {list.error && <ErrorBox onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonList rows={6} />}
      {list.data && currency && (
        list.data.items.length === 0 ? (
          <div className="card">
            <Empty icon={<FileText className="size-6" />} title={D.emptyTitle} text={filtered ? D.emptyFiltered : t.app.dashboard.emptyText} />
          </div>
        ) : (
          <div className="-mx-4 border-t border-line sm:-mx-6">
            {list.data.items.map((d) => <DocRow key={d.id} doc={d} currency={currency} showAmount />)}
          </div>
        )
      )}
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.common.previous}</Button>
          <span className="text-sm text-muted">{page} / {pages}</span>
          <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.common.next}</Button>
        </div>
      )}
    </div>
  );
}
