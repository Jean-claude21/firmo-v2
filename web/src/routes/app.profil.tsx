import { createFileRoute } from "@tanstack/react-router";
import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, ErrorBox, Field, Input, Notice, PageTitle, Select, SkeletonList, Textarea } from "@/components/ui";
import { api, type ApiError, authedBlobUrl } from "@/lib/api";
import { type Me, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

export const Route = createFileRoute("/app/profil")({ component: Profile });

function Profile() {
  const t = useT();
  const me = useMe();
  return (
    <div>
      <PageTitle title={t.app.profile.title} subtitle={t.app.profile.intro} />
      {me.error && <ErrorBox onRetry={me.reload} />}
      {!me.data ? <SkeletonList rows={6} /> : <ProfileForm me={me.data} reload={me.reload} />}
    </div>
  );
}

function ProfileForm({ me, reload }: { me: Me; reload: () => void }) {
  const t = useT();
  const P = t.app.profile;
  const o = me.org;
  const [form, setForm] = useState({
    name: o.name ?? "",
    tradeCode: o.tradeCode ?? "",
    countryCode: o.countryCode,
    locale: o.locale,
    phone: o.phone ?? "",
    email: o.email ?? "",
    address: o.address ?? "",
    legalIds: { ...o.legalIds },
    taxRegistered: o.taxRegistered,
    brandColor: o.brandColor,
    templateCode: o.templateCode,
    paymentMethods: o.paymentMethods ?? "",
    footerNote: o.footerNote ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [suggested, setSuggested] = useState<string | null>(null);
  const country = me.reference.countries.find((c) => c.code === form.countryCode);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  useEffect(() => {
    if (!o.hasLogo) return setLogoUrl(null);
    let url: string | null = null;
    authedBlobUrl("org", `/v1/portal/logo?t=${Date.now()}`).then((u) => {
      url = u;
      setLogoUrl(u);
    }).catch(() => setLogoUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [o.hasLogo, logoBusy]);

  async function upload(file: File) {
    setLogoBusy(true);
    setError(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const r = await api<{ suggestedColor: string | null }>("org", "/v1/portal/logo", { body: { base64 } });
      setSuggested(r.suggestedColor);
      reload();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setLogoBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("org", "/v1/portal/profile", { method: "PATCH", body: form });
      setSaved(true);
      reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card className="grid gap-4 sm:grid-cols-2">
        <p className="font-semibold sm:col-span-2">{P.identity}</p>
        <Field label={P.name} error={error?.fields.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required /></Field>
        <Field label={P.trade}>
          <Select value={form.tradeCode} onChange={(e) => set("tradeCode", e.target.value)}>
            <option value="">{P.chooseTrade}</option>
            {me.reference.trades.map((tr) => <option key={tr.code} value={tr.code}>{tr.label}</option>)}
          </Select>
        </Field>
        <Field label={P.country} hint={P.countryLocked}>
          <Select value={form.countryCode} onChange={(e) => set("countryCode", e.target.value)}>
            {me.reference.countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label={P.language}>
          <Select value={form.locale} onChange={(e) => set("locale", e.target.value)}>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </Select>
        </Field>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <p className="font-semibold sm:col-span-2">{P.contact}</p>
        <Field label={P.phone} optional><Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={32} /></Field>
        <Field label={P.email} optional error={error?.fields.email}><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label={P.address} optional><Input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} /></Field></div>
      </Card>

      <Card className="grid gap-4 sm:grid-cols-2">
        <p className="font-semibold sm:col-span-2">{P.legal}</p>
        {country?.legalIds.map((l) => (
          <Field key={l.code} label={l.label} optional>
            <Input value={form.legalIds[l.code] ?? ""} onChange={(e) => set("legalIds", { ...form.legalIds, [l.code]: e.target.value })} maxLength={80} />
          </Field>
        ))}
        {me.reference.taxes.length > 0 && (
          <label className="flex items-start gap-3 sm:col-span-2">
            <input type="checkbox" className="mt-1 size-5 accent-ink" checked={form.taxRegistered} onChange={(e) => set("taxRegistered", e.target.checked)} />
            <span>
              <span className="font-medium">{P.tax}</span>
              <span className="block text-sm text-muted">{P.taxHelp}</span>
            </span>
          </label>
        )}
      </Card>

      <Card className="space-y-5">
        <p className="font-semibold">{P.brand}</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-[var(--radius-field)] border border-dashed border-line bg-paper">
            {logoUrl ? <img src={logoUrl} alt={P.logo} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-7 text-muted" aria-hidden />}
          </div>
          <div className="space-y-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-field)] border border-line bg-surface px-4 font-medium hover:bg-paper">
              <ImagePlus className="size-4" aria-hidden /> {P.uploadLogo}
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={logoBusy} />
            </label>
            {o.hasLogo && (
              <Button type="button" variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { await api("org", "/v1/portal/logo", { method: "DELETE" }); reload(); }}>{P.removeLogo}</Button>
            )}
            <p className="text-sm text-muted">{P.logoHelp}</p>
          </div>
        </div>
        {suggested && suggested !== form.brandColor && (
          <Notice tone="info">
            <span className="inline-flex flex-wrap items-center gap-2">
              {P.suggested} <span className="inline-block size-5 rounded border border-line" style={{ background: suggested }} /> {suggested}
              <button type="button" className="font-semibold underline underline-offset-4" onClick={() => set("brandColor", suggested)}>{P.useSuggested}</button>
            </span>
          </Notice>
        )}
        <Field label={P.color}>
          <div className="flex items-center gap-3">
            <input type="color" value={form.brandColor} onChange={(e) => set("brandColor", e.target.value.toUpperCase())} className="size-11 cursor-pointer rounded-[var(--radius-field)] border border-line bg-surface p-1" aria-label={P.color} />
            <Input value={form.brandColor} onChange={(e) => set("brandColor", e.target.value)} className="w-32 font-mono" pattern="#[0-9A-Fa-f]{6}" />
          </div>
        </Field>
        <fieldset>
          <legend className="label">{P.template}</legend>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {me.reference.templates.map((tpl) => (
              <label key={tpl.code} className={`cursor-pointer rounded-[var(--radius-card)] border p-2 transition ${form.templateCode === tpl.code ? "border-ink ring-2 ring-ink" : "border-line hover:border-ink/40"}`}>
                <input type="radio" name="template" value={tpl.code} checked={form.templateCode === tpl.code} onChange={() => set("templateCode", tpl.code)} className="sr-only" />
                <img src={`/samples/devis-${tpl.code}.png`} alt="" className="aspect-[1/1.1] w-full rounded-md object-cover object-top" loading="lazy" />
                <p className="mt-2 px-1 text-sm font-semibold sm:text-base">{tpl.label}</p>
                <p className="hidden px-1 text-sm text-muted sm:block">{tpl.description}</p>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-4">
        <p className="font-semibold">{P.payment}</p>
        <Field label={P.paymentMethods} optional><Textarea value={form.paymentMethods} placeholder={P.paymentPlaceholder} onChange={(e) => set("paymentMethods", e.target.value)} maxLength={400} /></Field>
        <Field label={P.footerNote} optional><Input value={form.footerNote} placeholder={P.footerPlaceholder} onChange={(e) => set("footerNote", e.target.value)} maxLength={400} /></Field>
      </Card>

      {error && <Notice tone="warn">{error.message}</Notice>}
      {saved && <Notice tone="ok">{P.saved}</Notice>}
      <div className="sticky bottom-20 z-10 lg:bottom-4">
        <Button type="submit" loading={saving} className="w-full shadow-lg sm:w-auto">{t.common.save}</Button>
      </div>
    </form>
  );
}
