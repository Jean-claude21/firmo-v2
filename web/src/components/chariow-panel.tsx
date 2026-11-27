import { Check, Copy, X } from "lucide-react";
import { useState } from "react";
import { dateTimeOf, Section } from "@/components/admin-ui";
import { Button, Notice } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { useStaff } from "@/lib/staff";
import { useI18n } from "@/l10n";

// Chariow dans la console (spec 015) : l'adresse du Pulse à coller dans la boutique, l'état de la
// configuration, les produits reliés aux offres et les derniers avis reçus — comme sur Struo.

interface Data {
  pulseUrl: string;
  apiConfigured: boolean;
  enabled: boolean;
  plans: Array<{ code: string; version: number; currency: string; priceMinor: string; quota: number; product: string | null }>;
  pulses: Array<{ id: number; valid: boolean; at: string; event: string | null; sale: string | null }>;
}

export function ChariowPanel() {
  const { t, locale } = useI18n();
  const C = t.admin.chariow;
  const staff = useStaff();
  const d = useApi<Data>("staff", "/v1/admin/chariow");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!d.data) return null;
  const x = d.data;
  const state = (ok: boolean, label: string) => (
    <li className="flex items-center gap-2">{ok ? <Check className="size-4 text-ok" aria-hidden /> : <X className="size-4 text-danger" aria-hidden />}{label}</li>
  );
  return (
    <Section title={C.title} subtitle={C.subtitle}>
      <div className="space-y-5 px-5 py-5">
        <div>
          <p className="mono-label">{C.pulseUrl}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all border border-line bg-paper px-3 py-2.5 font-mono text-[14px]">{x.pulseUrl}</code>
            <Button variant="outline" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(x.pulseUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}>{copied ? t.common.copied : t.common.copy}</Button>
          </div>
        </div>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px] text-ink-soft">{C.steps.map((s) => <li key={s}>{s}</li>)}</ol>
        <ul className="space-y-1 text-[15px]">
          {state(x.apiConfigured, x.apiConfigured ? C.apiOk : C.apiMissing)}
          {state(x.pulses.some((p) => p.valid), x.pulses.some((p) => p.valid) ? C.pulseOk : C.pulseNone)}
          {state(x.enabled, x.enabled ? C.enabled : C.disabled)}
          {state(x.plans.every((p) => p.currency !== "XOF" || Boolean(p.product)), C.products)}
        </ul>
        {staff?.role === "admin" && x.apiConfigured && (
          <Button variant={x.enabled ? "outline" : "primary"} loading={busy} onClick={async () => {
            setBusy(true);
            await api("staff", "/v1/admin/config/payment_providers/chariow", { method: "PATCH", body: { enabled: !x.enabled } }).catch(() => undefined);
            setBusy(false);
            d.reload();
          }}>{x.enabled ? C.disable : C.enable}</Button>
        )}
        {!x.apiConfigured && <Notice tone="info">{C.keysHelp}</Notice>}
        <div>
          <p className="mono-label">{C.products}</p>
          <ul className="mt-2 text-[14px]">
            {x.plans.map((p) => <li key={`${p.code}-${p.currency}`} className="border-b border-line py-2 font-mono last:border-0">{p.code} v{p.version} · {p.currency} {p.priceMinor} · {p.quota} docs · {p.product ?? C.noProduct}</li>)}
          </ul>
        </div>
        <div>
          <p className="mono-label">{C.recent}</p>
          {x.pulses.length === 0 && <p className="mt-2 text-[14px] text-muted">{C.noPulse}</p>}
          <ul className="mt-2 text-[14px]">
            {x.pulses.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                <span className="font-mono text-muted">{dateTimeOf(p.at, locale)}</span>
                <span className="font-mono">{p.event ?? "—"}</span>
                <span className={p.valid ? "text-ok" : "text-danger"}>{p.valid ? C.signed : C.unsigned}</span>
                {p.sale && <span className="font-mono text-muted">{p.sale}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
