import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Empty, ErrorBox, PageTitle, Select, SkeletonList, StatusBadge } from "@/components/ui";
import { useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/admin/organisations/")({ component: Organizations });

interface Org {
  id: string;
  name: string | null;
  status: string;
  country: string;
  createdAt: string;
  documents: number;
  lastMessage: string | null;
  channels: string[];
  plan: string | null;
}

function Organizations() {
  const { t, locale } = useI18n();
  const O = t.admin.orgs;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const id = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);
  const list = useApi<{ items: Org[]; total: number }>("staff", `/v1/admin/organizations?search=${encodeURIComponent(query)}&status=${status}&page=${page}`);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / 25)) : 1;

  return (
    <div>
      <PageTitle title={t.admin.nav.organizations} subtitle={list.data ? String(list.data.total) : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
        <label className="relative block">
          <span className="sr-only">{O.search}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input className="field pl-9" placeholder={O.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={O.allStatuses}>
          <option value="">{O.allStatuses}</option>
          <option value="active">{O.active}</option>
          <option value="suspended">{O.suspended}</option>
        </Select>
      </div>
      {list.error && <ErrorBox onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonList rows={8} />}
      {list.data && list.data.items.length === 0 && <div className="card"><Empty title={O.empty} /></div>}
      {list.data && list.data.items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">{O.name}</th>
                <th className="px-4 py-3 font-medium">{O.channels}</th>
                <th className="px-4 py-3 text-right font-medium">{O.documents}</th>
                <th className="px-4 py-3 font-medium">{O.plan}</th>
                <th className="px-4 py-3 font-medium">{O.lastMessage}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {list.data.items.map((o) => (
                <tr key={o.id} className="hover:bg-paper">
                  <td className="px-4 py-3">
                    <Link to="/admin/organisations/$id" params={{ id: o.id }} className="font-semibold underline-offset-4 hover:underline">{o.name ?? O.unnamed}</Link>
                    <p className="text-muted">{o.country} · {O.created} {date(o.createdAt, locale)}{o.status === "suspended" && <> · <StatusBadge status="cancelled" /></>}</p>
                  </td>
                  <td className="px-4 py-3">{o.channels.join(", ")}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{o.documents}</td>
                  <td className="px-4 py-3">{o.plan ?? "—"}</td>
                  <td className="px-4 py-3 text-muted">{o.lastMessage ? date(o.lastMessage, locale) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
