import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Search, Users } from "lucide-react";
import { useState } from "react";
import { Button, Card, Empty, ErrorBox, Field, Input, PageTitle, SkeletonList } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { money } from "@/lib/format";
import { useMe } from "@/lib/portal";
import { useT } from "@/l10n";

export const Route = createFileRoute("/app/clients")({ component: Clients });

interface Client {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  legalId: string | null;
  documents: number;
  invoicedMinor: string;
}

const EMPTY = { name: "", phone: "", email: "", address: "", legalId: "" };

function Clients() {
  const t = useT();
  const C = t.app.clients;
  const me = useMe();
  const [search, setSearch] = useState("");
  const list = useApi<{ items: Client[] }>("org", `/v1/portal/clients?search=${encodeURIComponent(search)}`);
  const [editing, setEditing] = useState<{ id: string | null; form: typeof EMPTY } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: editing.form.name, phone: editing.form.phone || null, email: editing.form.email || null, address: editing.form.address || null, legalId: editing.form.legalId || null };
      await api("org", editing.id ? `/v1/portal/clients/${editing.id}` : "/v1/portal/clients", { method: editing.id ? "PUT" : "POST", body });
      setEditing(null);
      list.reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageTitle title={C.title} action={<Button icon={<Plus className="size-4" />} onClick={() => setEditing({ id: null, form: EMPTY })}>{C.new}</Button>} />

      {editing && (
        <Card className="mb-5">
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label={C.name} error={error?.fields.name}><Input required value={editing.form.name} maxLength={160} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, name: e.target.value } })} /></Field>
            <Field label={C.phone} optional><Input type="tel" value={editing.form.phone} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, phone: e.target.value } })} /></Field>
            <Field label={C.email} optional><Input type="email" value={editing.form.email} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, email: e.target.value } })} /></Field>
            <Field label={C.address} optional><Input value={editing.form.address} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, address: e.target.value } })} /></Field>
            <Field label={C.legalId} optional><Input value={editing.form.legalId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, legalId: e.target.value } })} /></Field>
            {error && !Object.keys(error.fields).length && <p className="text-danger sm:col-span-2">{error.message}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={saving}>{t.common.save}</Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t.common.cancel}</Button>
            </div>
          </form>
        </Card>
      )}

      <label className="relative mb-4 block">
        <span className="sr-only">{t.common.search}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className="field pl-9" placeholder={t.common.search} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      {list.error && <ErrorBox onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonList />}
      {list.data && list.data.items.length === 0 && <div className="card"><Empty icon={<Users className="size-6" />} title={C.emptyTitle} text={C.emptyText} /></div>}
      {list.data && list.data.items.length > 0 && (
        <ul className="card divide-y divide-line">
          {list.data.items.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-soft font-semibold text-amber-text" aria-hidden>
                {c.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name}</p>
                <p className="truncate text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || C.documents(c.documents)}</p>
              </div>
              <div className="hidden text-right text-sm sm:block">
                <p className="text-muted">{C.documents(c.documents)}</p>
                {me.data && c.invoicedMinor !== "0" && <p className="font-semibold tabular-nums">{money(c.invoicedMinor, me.data.currency)}</p>}
              </div>
              <button
                onClick={() => setEditing({ id: c.id, form: { name: c.name, phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "", legalId: c.legalId ?? "" } })}
                className="flex size-11 items-center justify-center rounded-[var(--radius-field)] text-muted hover:bg-paper hover:text-ink"
                aria-label={`${t.common.edit} ${c.name}`}
              >
                <Pencil className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
