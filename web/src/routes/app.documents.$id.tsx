import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Ban, Check, Copy, Download, FileCheck2, FileOutput, Loader2, PencilLine, Receipt, Send, ThumbsDown, ThumbsUp, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { DraftEditor, type DraftInput } from "@/components/editor";
import { Button, Card, ErrorBox, Field, Input, Notice, SkeletonList, StatusBadge } from "@/components/ui";
import { api, type ApiError, authedBlobUrl, useApi } from "@/lib/api";
import { date, money } from "@/lib/format";
import { type DocumentDetail, useMe } from "@/lib/portal";
import { useI18n } from "@/l10n";

export const Route = createFileRoute("/app/documents/$id")({ component: DocumentPage });

function Preview({ id, version }: { id: string; version: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current: string | null = null;
    setUrl(null);
    setFailed(false);
    authedBlobUrl("org", `/v1/portal/documents/${id}/file.svg?v=${version}`)
      .then((u) => {
        current = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [id, version]);
  if (failed) return null;
  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-card)]">
      {url ? <img src={url} alt="" className="w-full" /> : <div className="skeleton aspect-[1/1.414] w-full rounded-none" />}
    </div>
  );
}

function DocumentPage() {
  const { t, locale } = useI18n();
  const T = t.app.document;
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const me = useMe();
  const doc = useApi<DocumentDetail>("org", `/v1/portal/documents/${id}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);
  const [payment, setPayment] = useState({ open: false, amount: "", method: "", paidOn: new Date().toISOString().slice(0, 10) });
  const [version, setVersion] = useState(0);

  // Après émission, le PDF se prépare en arrière-plan : on rafraîchit jusqu'à ce qu'il soit prêt.
  useEffect(() => {
    if (doc.data && doc.data.status !== "draft" && doc.data.rendered === false) {
      const timer = setTimeout(doc.reload, 2500);
      return () => clearTimeout(timer);
    }
  }, [doc.data, doc.reload]);

  async function run(name: string, path: string, body?: unknown, after?: (r: any) => void) {
    setBusy(name);
    setError(null);
    try {
      const r = await api<any>("org", `/v1/portal/${path}`, { method: "POST", body: body ?? {} });
      after?.(r);
      doc.reload();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  async function save(input: DraftInput) {
    setBusy("save");
    setError(null);
    try {
      const updated = await api<DocumentDetail>("org", `/v1/portal/documents/${id}`, { method: "PUT", body: input });
      doc.setData({ ...doc.data!, ...updated });
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(null);
    }
  }

  if (doc.error) return <ErrorBox message={doc.error.status === 404 ? t.common.notFound : undefined} onRetry={doc.reload} />;
  if (!doc.data || !me.data) return <SkeletonList rows={6} />;
  const d = doc.data;
  const cur = d.currency;
  const balance = (BigInt(d.totalMinor) - BigInt(d.paidMinor)).toString();
  const shareText = d.shareUrl ? T.shareText(d.typeLabel, d.number ?? "", d.shareUrl) : "";

  return (
    <div className="space-y-5">
      <Link to="/app/documents" className="inline-flex min-h-11 items-center gap-2 text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t.app.documents.title}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] font-bold sm:text-3xl">
            {d.typeLabel} <span className="text-muted">{d.number ?? t.app.documents.draftNumber}</span>
          </h1>
          <p className="mt-1 text-muted">{d.client.name ?? t.app.documents.noClient}{d.issueDate ? ` · ${T.issuedOn} ${date(d.issueDate, locale)}` : ""}</p>
        </div>
        <StatusBadge status={d.expired ? "expired" : d.status} />
      </div>

      {error && <Notice tone="warn">{error.message}</Notice>}

      {d.status === "draft" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            {d.blockers.length > 0 && (
              <Notice tone="warn">
                {T.missing} {d.blockers.map((b) => T.blockers[b as keyof typeof T.blockers] ?? b).join(", ")}
              </Notice>
            )}
            <DraftEditor key={d.lines.length + d.totalMinor} me={me.data} doc={d} onSave={save} saving={busy === "save"} error={error} />
          </div>
          <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
            <p className="font-semibold">{t.app.editor.preview}</p>
            <Preview id={d.id} version={`${version}-${d.totalMinor}`} />
            <Button
              className="w-full"
              variant="accent"
              icon={<FileCheck2 className="size-4" />}
              disabled={d.blockers.length > 0}
              loading={busy === "issue"}
              onClick={() => confirm(T.issueConfirm) && run("issue", `documents/${id}/issue`)}
            >
              {T.issue}
            </Button>
            <Button className="w-full" variant="danger" icon={<Ban className="size-4" />} loading={busy === "cancel"} onClick={() => confirm(T.cancelConfirm) && run("cancel", `documents/${id}/cancel`, undefined, () => navigate({ to: "/app/documents" }))}>
              {T.deleteDraft}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            {!d.rendered && (
              <p className="flex items-center gap-2 text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden /> {T.preparing}</p>
            )}
            <Preview id={d.id} version={`${version}-${d.rendered}-${d.status}`} />
          </div>
          <div className="space-y-4">
            <Card className="space-y-3">
              <a
                href={`/v1/portal/documents/${d.id}/file.pdf?download=1`}
                onClick={async (e) => {
                  e.preventDefault();
                  const url = await authedBlobUrl("org", `/v1/portal/documents/${d.id}/file.pdf`);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${d.number}.pdf`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 10_000);
                }}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-field)] bg-ink px-4 font-medium text-white hover:bg-ink-soft"
              >
                <Download className="size-4" aria-hidden /> {T.download}
              </a>
              {d.shareUrl && !["cancelled", "replaced"].includes(d.status) && (
                <>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => void api("org", `/v1/portal/documents/${d.id}/share`, { method: "POST", body: {} }).catch(() => undefined)}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-field)] bg-[#25D366] px-4 font-medium text-ink hover:brightness-95"
                  >
                    <Send className="size-4" aria-hidden /> {T.shareWhatsapp}
                  </a>
                  <Button
                    variant="outline"
                    className="w-full"
                    icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                    onClick={async () => {
                      await api("org", `/v1/portal/documents/${d.id}/share`, { method: "POST", body: {} }).catch(() => undefined);
                      await navigator.clipboard.writeText(d.shareUrl!).catch(() => undefined);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? t.common.copied : T.copyLink}
                  </Button>
                </>
              )}
            </Card>

            <Card className="space-y-2">
              <div className="flex justify-between"><span className="text-muted">{t.app.editor.total}</span><span className="text-lg font-bold tabular-nums">{money(d.totalMinor, cur)}</span></div>
              {d.validUntil && <div className="flex justify-between text-sm"><span className="text-muted">{T.validUntil}</span><span>{date(d.validUntil, locale)}</span></div>}
              {d.viewedAt && <div className="flex justify-between text-sm"><span className="text-muted">{T.viewed}</span><span>{date(d.viewedAt, locale)}</span></div>}
              {d.sourceNumber && <div className="flex justify-between text-sm"><span className="text-muted">{T.source}</span><span>{d.sourceNumber}</span></div>}
              {d.decisionBy && <p className="text-sm text-muted">{T.decidedBy(d.decisionBy)}{d.decisionNote ? ` : « ${d.decisionNote} »` : ""}</p>}
              {d.expired && <Notice tone="warn">{T.expired}</Notice>}
            </Card>

            {d.acceptable && d.status === "issued" && (
              <Card className="grid grid-cols-2 gap-2">
                <Button variant="outline" icon={<ThumbsUp className="size-4" />} loading={busy === "accepted"} onClick={() => run("accepted", `documents/${id}/decision`, { decision: "accepted" })}>{T.accepted}</Button>
                <Button variant="outline" icon={<ThumbsDown className="size-4" />} loading={busy === "refused"} onClick={() => run("refused", `documents/${id}/decision`, { decision: "refused" })}>{T.refused}</Button>
              </Card>
            )}

            {d.acceptable && ["issued", "accepted"].includes(d.status) && (
              <Button className="w-full" variant="accent" icon={<FileOutput className="size-4" />} loading={busy === "convert"} onClick={() => run("convert", `documents/${id}/convert`, undefined, (r) => navigate({ to: "/app/documents/$id", params: { id: r.id } }))}>
                {T.convert}
              </Button>
            )}

            {d.payable && ["issued", "partially_paid", "paid"].includes(d.status) && (
              <Card className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{T.payments}</p>
                  {d.status !== "paid" && <span className="text-sm">{T.balance} : <strong className="tabular-nums">{money(balance, cur)}</strong></span>}
                </div>
                {d.payments.length === 0 && <p className="text-sm text-muted">{T.noPayments}</p>}
                {d.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 border-t border-line pt-2 text-sm">
                    <span>{date(p.paidOn, locale)} · {p.method ?? "—"}</span>
                    <span className="font-semibold tabular-nums">{money(p.amountMinor, cur)}</span>
                    {p.receiptId ? (
                      <Link to="/app/documents/$id" params={{ id: p.receiptId }} className="text-ok underline underline-offset-4">{T.receiptDone}</Link>
                    ) : (
                      <Button variant="ghost" className="min-h-9 px-2 text-sm" icon={<Receipt className="size-4" />} loading={busy === `r-${p.id}`} onClick={() => run(`r-${p.id}`, `payments/${p.id}/receipt`)}>{T.receipt}</Button>
                    )}
                  </div>
                ))}
                {d.status !== "paid" && !payment.open && (
                  <Button variant="outline" className="w-full" icon={<Wallet className="size-4" />} onClick={() => setPayment({ ...payment, open: true })}>{T.recordPayment}</Button>
                )}
                {payment.open && (
                  <form
                    className="space-y-3 border-t border-line pt-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run("pay", `documents/${id}/payments`, { amount: payment.amount, method: payment.method || null, paidOn: payment.paidOn }, () => setPayment({ open: false, amount: "", method: "", paidOn: payment.paidOn }));
                    }}
                  >
                    <Field label={`${T.amount} (${cur.symbol})`} error={error?.fields.amount}><Input inputMode="decimal" required value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
                    <Field label={T.paidOn}><Input type="date" value={payment.paidOn} onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })} /></Field>
                    <Field label={T.method} optional><Input value={payment.method} placeholder={T.methodPlaceholder} onChange={(e) => setPayment({ ...payment, method: e.target.value })} maxLength={80} /></Field>
                    <div className="flex gap-2">
                      <Button type="submit" loading={busy === "pay"}>{T.save}</Button>
                      <Button type="button" variant="ghost" onClick={() => setPayment({ ...payment, open: false })}>{t.common.cancel}</Button>
                    </div>
                  </form>
                )}
              </Card>
            )}

            {["issued", "accepted", "refused"].includes(d.status) && (
              <div className="grid gap-2">
                <Button variant="outline" icon={<PencilLine className="size-4" />} loading={busy === "revise"} onClick={() => run("revise", `documents/${id}/revise`, undefined, (r) => navigate({ to: "/app/documents/$id", params: { id: r.id } }))}>{T.revise}</Button>
                {d.paidMinor === "0" && (
                  <Button variant="danger" icon={<Ban className="size-4" />} loading={busy === "cancel"} onClick={() => confirm(T.cancelConfirm) && run("cancel", `documents/${id}/cancel`)}>{T.cancel}</Button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
