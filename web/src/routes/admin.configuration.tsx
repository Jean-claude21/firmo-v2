import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Notice, PageTitle, SkeletonList } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { useI18n } from "@/l10n";
import { useStaff } from "@/lib/staff";

// Configuration (ADM-5) : tout ce qui est générique se règle ici, sans déploiement.
export const Route = createFileRoute("/admin/configuration")({ component: Configuration });

type Row = Record<string, any>;
type Config = Record<string, Row[]>;

const label = (labels: Record<string, string> | null, locale: string) => (labels ? (labels[locale] ?? labels.fr ?? Object.values(labels)[0] ?? "") : "");

function Configuration() {
  const { t } = useI18n();
  const C = t.admin.config;
  const config = useApi<Config>("staff", "/v1/admin/config");
  const [tab, setTab] = useState<keyof typeof C.tabs>("plans");
  return (
    <div className="px-5 py-6 lg:px-7">
      <PageTitle title={t.admin.nav.config} />
      <div className="mb-5 flex gap-1 overflow-x-auto" role="tablist">
        {(Object.keys(C.tabs) as Array<keyof typeof C.tabs>).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-medium ${tab === k ? "bg-ink text-white" : "bg-surface text-ink ring-1 ring-line"}`}>{C.tabs[k]}</button>
        ))}
      </div>
      {config.error && <ErrorBox onRetry={config.reload} />}
      {!config.data && !config.error && <SkeletonList rows={6} />}
      {config.data && (
        <>
          {tab === "plans" && <Plans config={config.data} reload={config.reload} />}
          {tab === "ai" && <Editable table="ai_tasks" keyField="task" rows={config.data.ai_tasks ?? []} fields={[{ name: "model", kind: "text" }, { name: "enabled", kind: "bool" }, { name: "pricing", kind: "json" }]} reload={config.reload} help={C.pricingHelp} />}
          {tab === "flags" && (
            <div className="space-y-6">
              <Editable table="feature_flags" keyField="key" rows={config.data.feature_flags ?? []} fields={[{ name: "enabled", kind: "bool" }]} reload={config.reload} describe={(r) => r.description} />
              <Editable table="settings" keyField="key" rows={config.data.settings ?? []} fields={[{ name: "value", kind: "json" }]} reload={config.reload} describe={(r) => r.description} />
            </div>
          )}
          {tab === "channels" && (
            <div className="space-y-6">
              <Editable table="channels" keyField="code" rows={config.data.channels ?? []} fields={[{ name: "enabled", kind: "bool" }]} reload={config.reload} />
              <Editable table="payment_providers" keyField="code" rows={config.data.payment_providers ?? []} fields={[{ name: "enabled", kind: "bool" }]} reload={config.reload} />
            </div>
          )}
          {tab === "countries" && (
            <div className="space-y-6">
              <Editable table="countries" keyField="code" rows={config.data.countries ?? []} fields={[{ name: "active", kind: "bool" }, { name: "default_locale", kind: "text" }]} reload={config.reload} describe={(r) => `${r.currency_code} · +${r.phone_prefix}`} />
              <Editable table="currencies" keyField="code" rows={config.data.currencies ?? []} fields={[{ name: "active", kind: "bool" }, { name: "symbol", kind: "text" }]} reload={config.reload} />
              <Card>
                <p className="mb-2 font-semibold">{C.taxes}</p>
                <ul className="grid gap-1 text-sm sm:grid-cols-3">
                  {(config.data.taxes ?? []).map((tx) => <li key={tx.id}>{tx.country_code} · {tx.code} · {(tx.rate_bp / 100).toString().replace(".", ",")} %</li>)}
                </ul>
              </Card>
            </div>
          )}
          {tab === "catalog" && (
            <div className="space-y-6">
              <Editable table="trades" keyField="code" rows={config.data.trades ?? []} fields={[{ name: "active", kind: "bool" }]} reload={config.reload} />
              <Editable table="document_types" keyField="code" rows={config.data.document_types ?? []} fields={[{ name: "active", kind: "bool" }, { name: "number_prefix", kind: "text" }, { name: "validity_days", kind: "number" }]} reload={config.reload} />
              <Editable table="templates" keyField="code" rows={config.data.templates ?? []} fields={[{ name: "active", kind: "bool" }]} reload={config.reload} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface FieldSpec {
  name: string;
  kind: "bool" | "text" | "number" | "json";
}

function Editable({ table, keyField, rows, fields, reload, describe, help }: { table: string; keyField: string; rows: Row[]; fields: FieldSpec[]; reload: () => void; describe?: (r: Row) => string; help?: string }) {
  const { t, locale } = useI18n();
  const C = t.admin.config;
  const staff = useStaff();
  const readOnly = staff?.role !== "admin";
  const [drafts, setDrafts] = useState<Record<string, Record<string, string | boolean>>>({});
  const [error, setError] = useState<{ key: string; e: ApiError } | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const value = (r: Row, f: FieldSpec): string | boolean => {
    const d = drafts[r[keyField]]?.[f.name];
    if (d !== undefined) return d;
    const v = r[f.name];
    return f.kind === "bool" ? Boolean(v) : f.kind === "json" ? JSON.stringify(v ?? null) : String(v ?? "");
  };

  async function save(r: Row) {
    const key = r[keyField] as string;
    const patch: Record<string, unknown> = {};
    try {
      for (const f of fields) {
        const v = value(r, f);
        patch[f.name] = f.kind === "json" ? JSON.parse(String(v)) : f.kind === "number" ? (v === "" ? null : Number(v)) : v;
      }
    } catch {
      setError({ key, e: { message: C.invalidJson, status: 422, code: "validation", fields: {} } as ApiError });
      return;
    }
    try {
      await api("staff", `/v1/admin/config/${table}/${encodeURIComponent(key)}`, { method: "PATCH", body: patch });
      setSaved(key);
      setError(null);
      setDrafts((d) => ({ ...d, [key]: {} }));
      reload();
    } catch (e) {
      setError({ key, e: e as ApiError });
    }
  }

  return (
    <section className="card overflow-hidden">
      <p className="border-b border-line px-4 py-3 font-semibold">{table}</p>
      {help && <p className="px-4 pt-3 text-sm text-muted">{help}</p>}
      <ul className="divide-y divide-line">
        {rows.map((r) => {
          const key = r[keyField] as string;
          const dirty = Object.keys(drafts[key] ?? {}).length > 0;
          return (
            <li key={key} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-40 flex-1">
                <p className="font-medium">{label(r.labels, locale) || key}</p>
                <p className="text-sm text-muted">{key}{describe ? ` · ${describe(r)}` : ""}</p>
              </div>
              {fields.map((f) => (
                f.kind === "bool" ? (
                  <label key={f.name} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" className="size-5 accent-ink" disabled={readOnly} checked={Boolean(value(r, f))} onChange={(e) => setDrafts((d) => ({ ...d, [key]: { ...d[key], [f.name]: e.target.checked } }))} />
                    {f.name === "enabled" ? C.enabled : C.active}
                  </label>
                ) : (
                  <Input key={f.name} aria-label={f.name} disabled={readOnly} className={f.kind === "json" ? "w-full font-mono text-sm sm:w-72" : "w-40"} value={String(value(r, f))} onChange={(e) => setDrafts((d) => ({ ...d, [key]: { ...d[key], [f.name]: e.target.value } }))} />
                )
              ))}
              {!readOnly && <Button variant="outline" disabled={!dirty} onClick={() => save(r)}>{C.save}</Button>}
              {saved === key && !dirty && <span className="text-sm text-ok">{C.saved}</span>}
              {error?.key === key && <p className="w-full text-sm text-danger">{error.e.message}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Plans({ config, reload }: { config: Config; reload: () => void }) {
  const { t, locale } = useI18n();
  const C = t.admin.config;
  const staff = useStaff();
  const first = (config.plans ?? []).find((p) => p.active);
  const [form, setForm] = useState({
    code: first?.code ?? "", currency: first?.currency_code ?? "", label: "", priceMinor: "", quota: String(first?.quota ?? ""), periodDays: String(first?.period_days ?? ""),
    graceDays: String(first?.grace_days ?? 0), topUpDocuments: first?.top_up_documents ? String(first.top_up_documents) : "",
    topUpPriceMinor: first?.top_up_price_minor ?? "", chariowProduct: first?.provider_products?.chariow ?? "",
  });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("staff", "/v1/admin/plans", { body: {
        code: form.code, currency: form.currency.toUpperCase(), labels: { [locale]: form.label }, priceMinor: form.priceMinor,
        quota: Number(form.quota), periodDays: Number(form.periodDays), graceDays: Number(form.graceDays || 0),
        ...(form.topUpDocuments ? { topUpDocuments: Number(form.topUpDocuments) } : {}),
        ...(form.topUpPriceMinor ? { topUpPriceMinor: form.topUpPriceMinor } : {}),
        providerProducts: form.chariowProduct ? { chariow: form.chariowProduct.trim() } : {},
      } });
      reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5">
      <Notice tone="info">{C.plansIntro}</Notice>
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr><th className="px-4 py-3">{C.code}</th><th className="px-4 py-3">{C.label}</th><th className="px-4 py-3">{C.currency}</th><th className="px-4 py-3 text-right">{C.price}</th><th className="px-4 py-3 text-right">{C.quota}</th><th className="px-4 py-3 text-right">{C.topUpDocuments}</th><th className="px-4 py-3 text-right">{C.grace}</th><th className="px-4 py-3">{C.version}</th><th className="px-4 py-3" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(config.plans ?? []).map((p) => (
              <tr key={p.id} className={p.active ? "" : "text-muted"}>
                <td className="px-4 py-3 font-medium">{p.code}</td>
                <td className="px-4 py-3">{label(p.labels, locale)}</td>
                <td className="px-4 py-3">{p.currency_code}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.price_minor}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.quota}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.top_up_documents ? `${p.top_up_documents} · ${p.top_up_price_minor ?? "—"}` : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{p.grace_days}</td>
                <td className="px-4 py-3">v{p.version} · {p.active ? C.active : C.inactive}</td>
                <td className="px-4 py-3 text-right">
                  {p.active && staff?.role === "admin" && <Button variant="ghost" onClick={async () => { await api("staff", `/v1/admin/plans/${p.id}/retire`, { body: {} }); reload(); }}>{C.retire}</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {staff?.role === "admin" && (
        <Card>
          <form onSubmit={publish} className="grid gap-4 sm:grid-cols-3">
            <Field label={C.code}><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} pattern="[a-z0-9_]+" required /></Field>
            <Field label={C.currency}><Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={3} required /></Field>
            <Field label={C.label}><Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required /></Field>
            <Field label={C.price} hint={C.priceHelp} error={error?.fields.priceMinor}><Input inputMode="numeric" value={form.priceMinor} onChange={(e) => setForm({ ...form, priceMinor: e.target.value })} required /></Field>
            <Field label={C.quota}><Input inputMode="numeric" value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} required /></Field>
            <Field label={C.period}><Input inputMode="numeric" value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: e.target.value })} required /></Field>
            <Field label={C.grace} hint={C.graceHelp}><Input inputMode="numeric" value={form.graceDays} onChange={(e) => setForm({ ...form, graceDays: e.target.value })} /></Field>
            <Field label={C.topUpDocuments} hint={C.topUpHelp}><Input inputMode="numeric" value={form.topUpDocuments} onChange={(e) => setForm({ ...form, topUpDocuments: e.target.value })} /></Field>
            <Field label={C.topUpPrice} error={error?.fields.topUpPriceMinor}><Input inputMode="numeric" value={form.topUpPriceMinor} onChange={(e) => setForm({ ...form, topUpPriceMinor: e.target.value })} /></Field>
            <Field label={C.chariowProduct} hint={C.chariowHelp}><Input value={form.chariowProduct} onChange={(e) => setForm({ ...form, chariowProduct: e.target.value })} /></Field>
            {error && <p className="text-danger sm:col-span-3">{error.message}</p>}
            <div className="sm:col-span-3"><Button type="submit" loading={busy}>{C.publish}</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
