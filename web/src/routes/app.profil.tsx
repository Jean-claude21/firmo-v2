import { createFileRoute } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp, ImagePlus, Maximize2, Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { percentText } from "@/components/document-model";
import { MyData } from "@/components/my-data";
import { Button, ErrorBox, Field, Input, Notice, Select, SkeletonList, Textarea } from "@/components/ui";
import { api, type ApiError, authedBlobUrl, session, useApi } from "@/lib/api";
import { type Me, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

// Présentation (P-64, maquette v1 « client/identity ») : ce qui est repris sur tous les prochains
// documents, avec l'aperçu du vrai PDF qui suit chaque changement avant même l'enregistrement.
export const Route = createFileRoute("/app/profil")({ component: Presentation });

const SWATCHES = ["#A8391F", "#1F6F43", "#2C5A8C", "#6B3FA0", "#B7791F", "#15171A"];

function Presentation() {
  const t = useT();
  const me = useMe();
  return (
    <div>
      <div className="border-b border-line px-4 pb-5 pt-7 sm:px-6">
        <h1 className="text-[30px] font-bold leading-9">{t.app.profile.title}</h1>
        <p className="mt-2 max-w-lg text-ink-soft">{t.app.profile.intro}</p>
      </div>
      {me.error && <div className="p-4 sm:p-6"><ErrorBox onRetry={me.reload} /></div>}
      {!me.data ? <div className="p-4 sm:p-6"><SkeletonList rows={6} /></div> : <PresentationForm me={me.data} reload={me.reload} />}
    </div>
  );
}

type Form = ReturnType<typeof initial>;

function initial(me: Me) {
  const o = me.org;
  return {
    name: o.name ?? "",
    tradeLabel: o.tradeLabel ?? "",
    tradeCode: o.tradeCode ?? "",
    countryCode: o.countryCode,
    locale: o.locale,
    phone: o.phone ?? "",
    email: o.email ?? "",
    address: o.address ?? "",
    legalIds: { ...o.legalIds } as Record<string, string>,
    taxRegistered: o.taxRegistered,
    brandColor: o.brandColor,
    templateCode: o.templateCode,
    paymentMethods: o.paymentMethods ?? "",
    footerNote: o.footerNote ?? "",
    defaultValidityDays: o.defaultValidityDays ? String(o.defaultValidityDays) : "",
    defaultDepositPercent: percentText(o.defaultDepositBp, me.currency.decimalSeparator),
    defaultDeliveryText: o.defaultDeliveryText ?? "",
    defaultWarrantyText: o.defaultWarrantyText ?? "",
  };
}

/** Corps envoyé à l'API (vide → null ; l'API applique les règles). */
function body(f: Form) {
  const n = (v: string) => (v.trim() ? v.trim() : null);
  return {
    name: n(f.name), tradeLabel: n(f.tradeLabel), tradeCode: f.tradeCode || null, countryCode: f.countryCode, locale: f.locale,
    phone: n(f.phone), email: n(f.email), address: n(f.address), legalIds: f.legalIds, taxRegistered: f.taxRegistered,
    brandColor: f.brandColor, templateCode: f.templateCode, paymentMethods: n(f.paymentMethods), footerNote: n(f.footerNote),
    defaultValidityDays: /^\d+$/.test(f.defaultValidityDays.trim()) ? Number(f.defaultValidityDays.trim()) : null,
    defaultDepositPercent: f.defaultDepositPercent.trim(), defaultDeliveryText: n(f.defaultDeliveryText), defaultWarrantyText: n(f.defaultWarrantyText),
  };
}

/** Aperçu en direct : le vrai rendu, demandé après une courte pause de frappe. */
function LivePreview({ form, logoVersion }: { form: Form; logoVersion: number }) {
  const t = useT();
  const P = t.app.profile;
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [big, setBig] = useState(false);
  const key = JSON.stringify(body(form));
  useEffect(() => {
    let alive = true;
    setState("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/v1/portal/presentation/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.get("org")}` },
          body: key,
        });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (!alive) return;
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setState("ok");
      } catch {
        if (alive) setState("error");
      }
    }, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, logoVersion]);
  return (
    <section className="border-b border-line bg-paper-alt px-4 py-5 sm:px-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[22px] font-semibold">{P.preview}</h2>
        <button type="button" onClick={() => setBig(true)} disabled={!url} className="inline-flex min-h-11 items-center gap-2 font-semibold disabled:opacity-40"><Maximize2 className="size-4" aria-hidden /> {P.enlarge}</button>
      </div>
      <div className={`relative overflow-hidden border border-line bg-white ${state === "loading" && url ? "opacity-70" : ""}`}>
        {url ? <img src={url} alt={P.previewAlt} className="block max-h-[420px] w-full object-cover object-top" /> : <div className="skeleton aspect-[1/0.75] w-full" />}
      </div>
      {state === "error" && <p className="mt-2 text-sm text-danger">{P.previewFailed}</p>}
      {big && url && (
        <div className="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label={P.preview}>
          <div className="flex h-16 items-center justify-between border-b border-line px-4">
            <p className="font-semibold">{P.preview}</p>
            <button type="button" onClick={() => setBig(false)} aria-label={t.common.close} className="flex size-11 items-center justify-center"><X className="size-5" /></button>
          </div>
          <div className="flex-1 overflow-auto bg-paper-alt p-3"><img src={url} alt={P.previewAlt} className="mx-auto w-full max-w-[720px] border border-line bg-white" /></div>
        </div>
      )}
    </section>
  );
}

function Numbering() {
  const t = useT();
  const P = t.app.profile;
  const me = useMe();
  const list = useApi<{ items: Array<{ type: string; prefix: string; separator: string; includeYear: boolean; width: number; cadence: "annual" | "continuous"; preview: string }> }>("org", "/v1/portal/numbering");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = (code: string) => me.data?.reference.documentTypes.find((d) => d.code === code)?.label ?? code;
  async function save(type: string, patch: Record<string, unknown>) {
    setBusy(type);
    setError(null);
    try {
      const r = await api<{ preview: string }>("org", `/v1/portal/numbering/${type}`, { method: "PUT", body: patch });
      list.setData({ items: list.data!.items.map((i) => (i.type === type ? { ...i, ...patch, preview: r.preview } : i)) });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }
  if (!list.data) return <SkeletonList rows={2} />;
  return (
    <div className="space-y-4">
      {error && <Notice tone="warn">{error}</Notice>}
      {list.data.items.map((n) => (
        <div key={n.type} className="border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="font-semibold">{label(n.type)}</p>
            <p className="font-mono text-[15px]">{busy === n.type ? "…" : n.preview}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label={P.prefix}><Input defaultValue={n.prefix} maxLength={12} className="font-mono uppercase" onBlur={(e) => e.target.value !== n.prefix && save(n.type, { prefix: e.target.value.replace(/[^A-Za-z0-9]/g, "") })} /></Field>
            <Field label={P.separator}>
              <Select value={n.separator} onChange={(e) => save(n.type, { separator: e.target.value })}>
                {["-", "/", ".", "_"].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            </Field>
            <Field label={P.digits}>
              <Select value={n.width} onChange={(e) => save(n.type, { width: Number(e.target.value) })}>
                {[2, 3, 4, 5, 6].map((w) => <option key={w} value={w}>{"0".repeat(w - 1)}1</option>)}
              </Select>
            </Field>
            <Field label={P.cadence}>
              <Select value={`${n.includeYear ? "y" : "n"}-${n.cadence}`} onChange={(e) => {
                const [y, c] = e.target.value.split("-");
                save(n.type, { includeYear: y === "y", cadence: c });
              }}>
                <option value="y-annual">{P.yearReset}</option>
                <option value="y-continuous">{P.yearContinuous}</option>
                <option value="n-continuous">{P.noYear}</option>
              </Select>
            </Field>
          </div>
        </div>
      ))}
      <p className="text-sm text-muted">{P.numberingHelp}</p>
    </div>
  );
}

function Clauses() {
  const t = useT();
  const P = t.app.profile;
  const list = useApi<{ items: Array<{ id: string; title: string | null; body: string; isDefault: boolean }> }>("org", "/v1/portal/clauses");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call(path: string, method: string, b: unknown) {
    setBusy(true);
    setError(null);
    try {
      await api("org", path, { method, body: b });
      list.reload();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      {error && <Notice tone="warn">{error}</Notice>}
      {list.data?.items.length === 0 && <p className="text-muted">{P.noClauses}</p>}
      {list.data?.items.map((c) => (
        <div key={c.id} className="flex items-start gap-3 border border-line bg-surface p-3">
          <div className="min-w-0 flex-1">
            <p>{c.body}</p>
            <label className="mt-2 flex min-h-10 items-center gap-2 text-[15px] text-ink-soft">
              <input type="checkbox" className="size-5 accent-ink" checked={c.isDefault} onChange={(e) => call(`/v1/portal/clauses/${c.id}`, "PUT", { isDefault: e.target.checked })} disabled={busy} />
              {P.clauseDefault}
            </label>
          </div>
          <button type="button" aria-label={P.removeClause} onClick={() => confirm(P.removeClauseConfirm) && call(`/v1/portal/clauses/${c.id}`, "PUT", { active: false })} className="flex size-11 items-center justify-center text-muted hover:text-danger"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex gap-2">
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={P.clausePlaceholder} maxLength={600} aria-label={P.newClause} className="min-h-12" />
        <button type="button" disabled={!text.trim() || busy} onClick={async () => {
          await call("/v1/portal/clauses", "POST", { body: text.trim(), isDefault: true });
          setText("");
        }} className="flex min-h-12 shrink-0 items-center gap-2 self-start rounded-[var(--radius-field)] border-[1.5px] border-line bg-surface px-4 font-semibold disabled:opacity-40"><Plus className="size-4" aria-hidden /> {t.common.add}</button>
      </div>
    </div>
  );
}

function Fold({ title, subtitle, children, open: initiallyOpen = false }: { title: string; subtitle?: string; children: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <section className="border-b border-line">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[72px] w-full items-center justify-between gap-3 px-4 text-left sm:px-6">
        <span>
          <span className="block text-[20px] font-semibold">{title}</span>
          {subtitle && <span className="block text-[14px] text-muted">{subtitle}</span>}
        </span>
        {open ? <ChevronUp className="size-5 text-muted" aria-hidden /> : <ChevronDown className="size-5 text-muted" aria-hidden />}
      </button>
      {open && <div className="space-y-4 px-4 pb-6 sm:px-6">{children}</div>}
    </section>
  );
}

function PresentationForm({ me, reload }: { me: Me; reload: () => void }) {
  const t = useT();
  const P = t.app.profile;
  const [form, setForm] = useState<Form>(() => initial(me));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoVersion, setLogoVersion] = useState(0);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const country = me.reference.countries.find((c) => c.code === form.countryCode);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setSaved(false);
    setForm((f) => ({ ...f, [k]: v }));
  };

  useEffect(() => {
    if (!me.org.hasLogo) return setLogoUrl(null);
    let url: string | null = null;
    authedBlobUrl("org", `/v1/portal/logo?v=${logoVersion}`).then((u) => {
      url = u;
      setLogoUrl(u);
    }).catch(() => setLogoUrl(null));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [me.org.hasLogo, logoVersion]);

  async function upload(file: File) {
    setLogoBusy(true);
    setLogoError(null);
    try {
      if (file.size > 2_900_000) throw new Error(P.logoTooBig);
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error(P.logoUnreadable));
        reader.readAsDataURL(file);
      });
      const r = await api<{ suggestedColor: string | null }>("org", "/v1/portal/logo", { body: { base64 } });
      setSuggested(r.suggestedColor && r.suggestedColor.toUpperCase() !== form.brandColor.toUpperCase() ? r.suggestedColor.toUpperCase() : null);
      setLogoVersion((v) => v + 1);
      reload();
    } catch (e) {
      const err = e as ApiError;
      setLogoError(err.fields?.logo ?? err.message);
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api("org", "/v1/portal/profile", { method: "PATCH", body: body(form) });
      setSaved(true);
      reload();
    } catch (err) {
      setError(err as ApiError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <LivePreview form={form} logoVersion={logoVersion} />

      <section className="space-y-4 border-b border-line px-4 py-6 sm:px-6">
        <h2 className="text-[22px] font-semibold">{P.identity}</h2>
        <div className="flex items-center gap-4">
          <div className="flex size-[72px] shrink-0 items-center justify-center overflow-hidden border-[1.5px] border-dashed border-line bg-surface">
            {logoUrl ? <img src={logoUrl} alt={P.logo} className="max-h-full max-w-full object-contain" /> : <ImagePlus className="size-7 text-muted" aria-hidden />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{P.logo}</p>
            <p className="text-[14px] text-muted">{P.logoHelp}</p>
          </div>
          <label className={`inline-flex min-h-11 cursor-pointer items-center px-2 font-semibold ${logoBusy ? "opacity-50" : ""}`}>
            {logoBusy ? "…" : me.org.hasLogo ? P.replaceLogo : P.uploadLogo}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} disabled={logoBusy} />
          </label>
        </div>
        {logoError && <Notice tone="warn">{logoError}</Notice>}
        {me.org.hasLogo && (
          <button type="button" className="inline-flex min-h-11 items-center gap-2 text-[15px] text-muted hover:text-danger" onClick={async () => {
            await api("org", "/v1/portal/logo", { method: "DELETE" });
            setLogoVersion((v) => v + 1);
            reload();
          }}><Trash2 className="size-4" aria-hidden /> {P.removeLogo}</button>
        )}
        <Field label={P.name} error={error?.fields.name}><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required /></Field>
        <Field label={P.trade} optional hint={P.tradeHelp}><Input value={form.tradeLabel} onChange={(e) => set("tradeLabel", e.target.value)} maxLength={120} placeholder={P.tradePlaceholder} /></Field>
        <Field label={P.phone} optional><Input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={32} /></Field>
      </section>

      <section className="space-y-5 border-b border-line px-4 py-6 sm:px-6">
        <h2 className="text-[22px] font-semibold">{P.style}</h2>
        <div>
          <p className="label">{P.color}</p>
          <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={P.color}>
            {SWATCHES.map((c) => (
              <button key={c} type="button" role="radio" aria-checked={form.brandColor.toUpperCase() === c} aria-label={c} onClick={() => set("brandColor", c)}
                className={`size-12 rounded-full ${form.brandColor.toUpperCase() === c ? "ring-2 ring-ink ring-offset-2 ring-offset-paper" : ""}`} style={{ background: c }} />
            ))}
            <label className="relative flex size-12 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-dashed border-ink-soft" aria-label={P.otherColor}>
              <Plus className="size-5" aria-hidden />
              <input type="color" value={form.brandColor} onChange={(e) => set("brandColor", e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <span className="font-mono text-[14px] text-muted">{form.brandColor}</span>
          </div>
          {suggested && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[15px]">
              {P.suggested} <span className="inline-block size-5 rounded-full border border-line" style={{ background: suggested }} aria-hidden /> <span className="font-mono">{suggested}</span>
              <button type="button" className="min-h-10 font-semibold underline underline-offset-4" onClick={() => { set("brandColor", suggested); setSuggested(null); }}>{P.useSuggested}</button>
            </p>
          )}
          <p className="mt-2 text-[14px] text-muted">{P.colorHelp}</p>
        </div>
        <div>
          <p className="label">{P.template}</p>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={P.template}>
            {me.reference.templates.map((tpl) => (
              <button key={tpl.code} type="button" role="radio" aria-checked={form.templateCode === tpl.code} onClick={() => set("templateCode", tpl.code)}
                className={`min-h-16 rounded-[var(--radius-field)] border-[1.5px] p-3 text-left ${form.templateCode === tpl.code ? "border-ink bg-surface" : "border-line hover:border-ink-soft"}`}>
                <span className="flex items-center gap-2 font-semibold">{form.templateCode === tpl.code && <Check className="size-4" aria-hidden />}{tpl.label}</span>
                <span className="block text-[14px] text-muted">{tpl.description}</span>
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">{P.numbering}</p>
          <Numbering />
        </div>
      </section>

      <Fold title={P.professional} subtitle={P.professionalHint}>
        <Field label={P.email} optional error={error?.fields.email}><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={200} /></Field>
        <Field label={P.address} optional><Input value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} /></Field>
        {country?.legalIds.map((l) => (
          <Field key={l.code} label={l.label} optional>
            <Input value={form.legalIds[l.code] ?? ""} onChange={(e) => set("legalIds", { ...form.legalIds, [l.code]: e.target.value })} maxLength={80} className="font-mono" />
          </Field>
        ))}
        <p className="text-[14px] text-muted">{P.legalHelp}</p>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <label className="flex min-h-11 items-start gap-3">
          <input type="checkbox" className="mt-1 size-5 accent-ink" checked={form.taxRegistered} onChange={(e) => set("taxRegistered", e.target.checked)} />
          <span><span className="font-semibold">{P.tax}</span><span className="block text-[14px] text-muted">{P.taxHelp}</span></span>
        </label>
      </Fold>

      <Fold title={P.payment} subtitle={P.paymentHint}>
        <Field label={P.paymentMethods} optional><Textarea value={form.paymentMethods} placeholder={P.paymentPlaceholder} onChange={(e) => set("paymentMethods", e.target.value)} maxLength={400} /></Field>
        <Field label={P.footerNote} optional><Input value={form.footerNote} placeholder={P.footerPlaceholder} onChange={(e) => set("footerNote", e.target.value)} maxLength={400} /></Field>
      </Fold>

      <Fold title={P.defaults} subtitle={P.defaultsHint}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.app.editor.validity} optional><Input inputMode="numeric" value={form.defaultValidityDays} onChange={(e) => set("defaultValidityDays", e.target.value.replace(/[^\d]/g, ""))} maxLength={3} className="font-mono" /></Field>
          <Field label={t.app.editor.deposit} optional error={error?.fields.defaultDepositPercent}><Input inputMode="decimal" value={form.defaultDepositPercent} onChange={(e) => set("defaultDepositPercent", e.target.value)} maxLength={6} className="font-mono" /></Field>
        </div>
        <Field label={t.app.editor.delivery} optional><Input value={form.defaultDeliveryText} onChange={(e) => set("defaultDeliveryText", e.target.value)} maxLength={200} placeholder={t.app.editor.deliveryPlaceholder} /></Field>
        <Field label={t.app.editor.warranty} optional><Input value={form.defaultWarrantyText} onChange={(e) => set("defaultWarrantyText", e.target.value)} maxLength={200} placeholder={t.app.editor.warrantyPlaceholder} /></Field>
      </Fold>

      <Fold title={P.clauses} subtitle={P.clausesHint}>
        <Clauses />
      </Fold>

      <Fold title={t.app.myData.title} subtitle={t.app.myData.hint}>
        <MyData />
      </Fold>

      <div className="sticky bottom-[60px] z-10 border-t border-line bg-paper px-4 py-3 sm:px-6 lg:bottom-0">
        {error && !Object.keys(error.fields).length && <div className="mb-2"><Notice tone="warn">{error.message}</Notice></div>}
        {error && Object.keys(error.fields).length > 0 && <div className="mb-2"><Notice tone="warn">{Object.values(error.fields).join(" · ")}</Notice></div>}
        <Button type="submit" className="w-full" loading={saving} icon={saved ? <Check className="size-5" /> : <Check className="size-5" />}>{saved ? P.saved : P.save}</Button>
      </div>
    </form>
  );
}
