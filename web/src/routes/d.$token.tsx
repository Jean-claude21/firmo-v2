import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Download, Link2Off, ShieldCheck, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import { Mark } from "@/components/brand";
import { Button, Field, LinkButton, Notice, Skeleton, StatusBadge, Textarea } from "@/components/ui";
import { api, type ApiError, useApi } from "@/lib/api";
import { date, money } from "@/lib/format";
import type { DocumentDetail } from "@/lib/portal";
import { localeOf, useI18n } from "@/l10n";
import { useEffect } from "react";

// Page publique du document pour le client de l'artisan (ART-7) : consulter, télécharger, accepter.
export const Route = createFileRoute("/d/$token")({ component: PublicDocument });

function PublicDocument() {
  const { t, locale, setLocale } = useI18n();
  const P = t.publicDoc;
  const { token } = Route.useParams();
  const doc = useApi<DocumentDetail>(null, `/v1/public/documents/${token}`);
  const [mode, setMode] = useState<"accepted" | "refused" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<"accepted" | "refused" | null>(null);

  useEffect(() => {
    if (doc.data) setLocale(localeOf(doc.data.locale));
  }, [doc.data, setLocale]);

  async function decide() {
    if (!mode) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<DocumentDetail>(null, `/v1/public/documents/${token}/decision`, { body: { decision: mode, note: note.trim() || null } });
      doc.setData(updated);
      setDone(mode);
      setMode(null);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  }

  if (doc.error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <Link2Off className="size-10 text-danger" aria-hidden />
        <p className="mt-4 text-lg font-semibold">{P.invalid}</p>
      </main>
    );
  }

  const d = doc.data;
  const issuer = (d?.issuer ?? {}) as { name?: string; phone?: string; email?: string; address?: string; brand_color?: string };
  const brand = issuer.brand_color ?? "#14213D";
  const canDecide = d && d.acceptable && d.status === "issued" && !d.expired;

  return (
    <div className="min-h-screen">
      <div className="h-2" style={{ background: brand }} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-10">
        {!d ? (
          <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="aspect-[1/1.414] w-full" /></div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <div className="order-2 lg:order-1">
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
                <img src={`/v1/public/documents/${token}/file.svg`} alt={`${d.typeLabel} ${d.number}`} className="w-full" />
              </div>
            </div>
            <aside className="order-1 space-y-4 lg:order-2">
              <div>
                <p className="text-sm text-muted">{P.from}</p>
                <p className="font-serif text-2xl font-bold">{issuer.name}</p>
                <p className="text-sm text-muted">{[issuer.phone, issuer.email].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="card space-y-3 p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold">{d.typeLabel} {d.number}</p>
                  <StatusBadge status={d.expired ? "expired" : d.status} />
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-muted">{P.total}</span>
                  <span className="text-2xl font-bold tabular-nums">{money(d.totalMinor, d.currency)}</span>
                </div>
                {d.payable && d.paidMinor !== "0" && (
                  <>
                    <div className="flex justify-between text-sm"><span className="text-muted">{P.paid}</span><span>{money(d.paidMinor, d.currency)}</span></div>
                    <div className="flex justify-between text-sm font-semibold"><span>{P.balance}</span><span>{money((BigInt(d.totalMinor) - BigInt(d.paidMinor)).toString(), d.currency)}</span></div>
                  </>
                )}
                {d.validUntil && <p className="text-sm text-muted">{t.app.document.validUntil} {date(d.validUntil, locale)}</p>}
                <LinkButton href={`/v1/public/documents/${token}/file.pdf?download=1`} className="w-full" icon={<Download className="size-4" aria-hidden />}>{P.download}</LinkButton>
              </div>

              {done && <Notice tone="ok"><span className="inline-flex items-center gap-2"><CheckCircle2 className="size-4" />{done === "accepted" ? P.acceptedThanks : P.refusedThanks}</span></Notice>}
              {d.expired && <Notice tone="warn">{P.expired}</Notice>}
              {!done && d.acceptable && ["accepted", "refused"].includes(d.status) && <Notice tone="info">{P.decided(t.status[d.status as "accepted" | "refused"])}</Notice>}

              {canDecide && !mode && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="accent" icon={<ThumbsUp className="size-4" />} onClick={() => setMode("accepted")}>{P.accept}</Button>
                  <Button variant="outline" icon={<ThumbsDown className="size-4" />} onClick={() => setMode("refused")}>{P.refuse}</Button>
                </div>
              )}
              {canDecide && mode && (
                <div className="card space-y-3 p-5">
                  <Field label={P.note} optional><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={P.notePlaceholder} maxLength={500} /></Field>
                  {error && <Notice tone="warn">{error.message}</Notice>}
                  <div className="flex flex-wrap gap-2">
                    <Button variant={mode === "accepted" ? "accent" : "danger"} loading={busy} onClick={decide}>{mode === "accepted" ? P.confirmAccept : P.confirmRefuse}</Button>
                    <Button variant="ghost" onClick={() => setMode(null)}>{t.common.cancel}</Button>
                  </div>
                </div>
              )}

              <p className="flex items-center gap-2 text-sm text-muted"><ShieldCheck className="size-4 text-ok" aria-hidden /> {P.verified}</p>
              <a href="/" className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"><Mark className="size-5" /> {P.poweredBy}</a>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
