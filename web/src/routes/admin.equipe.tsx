import { createFileRoute } from "@tanstack/react-router";
import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Notice, PageTitle, Select, SkeletonList } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";

export const Route = createFileRoute("/admin/equipe")({ component: Team });

function Team() {
  const { t, locale } = useI18n();
  const S = t.admin.staff;
  const me = useStaff();
  const list = useApi<{ items: Array<{ userId: string; email: string; role: string; createdAt: string }> }>("staff", "/v1/admin/staff");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("support");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const isAdmin = me?.role === "admin";

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("staff", "/v1/admin/staff", { body: { email, role } });
      setEmail("");
      list.reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-5 py-6 lg:px-7">
      <PageTitle title={t.admin.nav.staff} subtitle={S.intro} />
      {isAdmin && (
        <Card>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
            <Field label={S.email}><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={S.role}>
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="support">{S.support}</option>
                <option value="admin">{S.admin}</option>
              </Select>
            </Field>
            <Button type="submit" loading={busy} icon={<UserPlus className="size-4" />}>{S.add}</Button>
          </form>
          {error && <div className="mt-3"><Notice tone="warn">{error.message}</Notice></div>}
        </Card>
      )}
      {list.error && <ErrorBox onRetry={list.reload} />}
      {!list.data && !list.error && <SkeletonList rows={3} />}
      {list.data && (
        <ul className="card divide-y divide-line">
          {list.data.items.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <p className="font-semibold">{m.email}</p>
                <p className="text-sm text-muted">{m.role === "admin" ? S.admin : S.support} · {S.since} {date(m.createdAt, locale)}</p>
              </div>
              {isAdmin && m.email !== me?.email && (
                <Button variant="danger" icon={<UserMinus className="size-4" />} onClick={async () => { if (confirm(S.removeConfirm)) { await api("staff", `/v1/admin/staff/${m.userId}`, { method: "DELETE" }); list.reload(); } }}>{S.remove}</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
