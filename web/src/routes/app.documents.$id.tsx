import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Copy, Download, FileText, Loader2, MessageCircle, MoreVertical, Receipt, Send, Wallet, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Amount, ConditionsTab, DetailTab, SaveIndicator, TotalsTab, useAutosave } from "@/components/document-editor";
import { type DocDraft, fromDocument, toInput } from "@/components/document-model";
import { Button, ErrorBox, Field, Input, Notice, SkeletonList, StatusBadge, Tabs } from "@/components/ui";
import { api, type ApiError, authedBlobUrl, useApi } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { downloadPdf } from "@/lib/files";
import { date, figure } from "@/lib/format";
import { type DocumentDetail, useMe } from "@/lib/portal";
import { useI18n } from "@/l10n";

// Document (P-63) : brouillon éditable et enregistré tout seul, ou document émis à suivre (partage,
// réponse du client, paiements, reçus). Les montants viennent toujours du serveur.
export const Route = createFileRoute("/app/documents/$id")({ component: DocumentPage });

type Tab = "detail" | "conditions" | "totals";

function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let current: string | null = null;
    setFailed(false);
    authedBlobUrl("org", path).then((u) => {
      current = u;
      setUrl(u);
    }).catch(() => setFailed(true));
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [path]);
  return { url, failed };
}

/** Feuille plein écran : l'aperçu du PDF (image de la première page), puis l'émission. */
function PdfSheet({ doc, version, onClose, onIssued, remaining }: { doc: DocumentDetail; version: string; onClose: () => void; onIssued: () => void; remaining: number | null }) {
  const { t } = useI18n();
  const T = t.app.document;
  const { url, failed } = useBlobUrl(`/v1/portal/documents/${doc.id}/file.png?v=${version}`);
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const draft = doc.status === "draft";
  const blocked = doc.blockers.length > 0;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" role="dialog" aria-modal="true" aria-label={T.pdfTitle}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
        <p className="font-semibold">{draft ? T.previewTitle : doc.number}</p>
        <button type="button" onClick={onClose} aria-label={t.common.close} className="flex size-11 items-center justify-center"><X className="size-5" /></button>
      </div>
      <div className="flex-1 overflow-auto bg-paper-alt p-3 sm:p-6">
        <div className="mx-auto max-w-[720px] border border-line bg-white">
          {url ? <img src={url} alt={T.pdfAlt(doc.typeLabel)} className="w-full" /> : failed ? <p className="p-6 text-muted">{t.common.error}</p> : <div className="skeleton aspect-[1/1.414] w-full" />}
        </div>
      </div>
      <div className="shrink-0 space-y-3 border-t border-line bg-paper px-4 py-4 sm:px-6">
        {draft ? (
          <>
            {blocked && <Notice tone="warn">{T.missing} {doc.blockers.map((b) => T.blockers[b as keyof typeof T.blockers] ?? b).join(", ")}</Notice>}
            {!blocked && (
              <Field label={T.manualNumber} optional hint={T.manualNumberHelp} error={error?.fields._ && /num/i.test(error.message) ? error.message : undefined}>
                <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} className="font-mono" placeholder={T.autoNumber} />
              </Field>
            )}
            {error && !/num/i.test(error.message) && <Notice tone="warn">{error.message}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                className="flex-1"
                disabled={blocked}
                loading={busy}
                icon={<Check className="size-5" />}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await api("org", `/v1/portal/documents/${doc.id}/issue`, { body: { number: number.trim() || null } });
                    onIssued();
                  } catch (e) {
                    setError(e as ApiError);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {T.issueFinal}
              </Button>
              <Button variant="outline" icon={<Download className="size-5" />} onClick={() => downloadPdf(doc.id, T.previewFile)}>{T.downloadPreview}</Button>
            </div>
            {!blocked && <p className="text-[14px] text-muted">{remaining === null ? T.issueUsesNone : T.issueUses(remaining)}</p>}
          </>
        ) : (
          <Button className="w-full" icon={<Download className="size-5" />} onClick={() => downloadPdf(doc.id, doc.number ?? "document")}>{T.download}</Button>
        )}
      </div>
    </div>
  );
}

function ActionsMenu({ doc, busy, run, onPdf }: { doc: DocumentDetail; busy: string | null; run: (name: string, path: string, body?: unknown, after?: (r: any) => void) => void; onPdf: () => void }) {
  const { t } = useI18n();
  const T = t.app.document;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const go = (r: { id: string }) => navigate({ to: "/app/documents/$id", params: { id: r.id } });
  const item = "flex min-h-12 w-full items-center px-4 text-left text-[16px] hover:bg-paper disabled:opacity-40";
  const issued = doc.status !== "draft";
  const live = !["cancelled", "replaced"].includes(doc.status);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={T.actions} aria-expanded={open} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5">
        {busy ? <Loader2 className="size-5 animate-spin" /> : <MoreVertical className="size-5" aria-hidden />}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-72 border border-line bg-surface py-1" role="menu" onClick={() => setOpen(false)}>
          <button type="button" role="menuitem" className={item} onClick={onPdf}>{doc.status === "draft" ? T.issue : T.seePdf}</button>
          {issued && <button type="button" role="menuitem" className={item} onClick={() => downloadPdf(doc.id, doc.number ?? "document")}>{T.download}</button>}
          <button type="button" role="menuitem" className={item} onClick={() => run("duplicate", `documents/${doc.id}/duplicate`, undefined, go)}>{T.duplicate}</button>
          {issued && live && doc.type === "quote" && <button type="button" role="menuitem" className={item} onClick={() => run("convert", `documents/${doc.id}/convert`, { type: "proforma" }, go)}>{T.toProforma}</button>}
          {issued && live && ["quote", "proforma"].includes(doc.type) && <button type="button" role="menuitem" className={item} onClick={() => run("convert", `documents/${doc.id}/convert`, { type: "invoice" }, go)}>{T.toInvoice}</button>}
          {issued && live && doc.acceptable && doc.status === "issued" && (
            <>
              <button type="button" role="menuitem" className={`${item} border-t border-line`} onClick={() => run("decision", `documents/${doc.id}/decision`, { decision: "accepted" })}>{T.accepted}</button>
              <button type="button" role="menuitem" className={item} onClick={() => run("decision", `documents/${doc.id}/decision`, { decision: "refused" })}>{T.refused}</button>
            </>
          )}
          {["issued", "accepted", "refused"].includes(doc.status) && doc.type !== "receipt" && (
            <button type="button" role="menuitem" className={`${item} border-t border-line`} onClick={() => run("revise", `documents/${doc.id}/revise`, undefined, go)}>{T.revise}</button>
          )}
          {doc.status === "draft" ? (
            <button type="button" role="menuitem" className={`${item} border-t border-line text-danger`} onClick={() => confirm(T.cancelConfirm) && run("cancel", `documents/${doc.id}/cancel`, undefined, () => navigate({ to: "/app" }))}>{T.deleteDraft}</button>
          ) : live && doc.paidMinor === "0" && doc.type !== "receipt" ? (
            <button type="button" role="menuitem" className={`${item} border-t border-line text-danger`} onClick={() => confirm(T.cancelConfirm) && run("cancel", `documents/${doc.id}/cancel`)}>{T.cancel}</button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Payments({ doc, busy, run }: { doc: DocumentDetail; busy: string | null; run: (name: string, path: string, body?: unknown, after?: (r: any) => void) => void }) {
  const { t, locale } = useI18n();
  const T = t.app.document;
  const cur = doc.currency;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", method: "", paidOn: new Date().toISOString().slice(0, 10) });
  const balance = (BigInt(doc.totalMinor) - BigInt(doc.paidMinor)).toString();
  return (
    <section className="border-t-[1.5px] border-ink">
      <div className="flex min-h-14 items-center justify-between px-4 sm:px-6">
        <h3 className="text-[20px] font-semibold">{T.payments}</h3>
        {doc.status !== "paid" ? <span className="text-[15px]">{T.balance} <Amount minor={balance} cur={cur} strong /></span> : <StatusBadge status="paid" />}
      </div>
      {doc.payments.length === 0 && <p className="border-t border-line px-4 py-4 text-muted sm:px-6">{T.noPayments}</p>}
      {doc.payments.map((p) => (
        <div key={p.id} className="flex min-h-14 items-center gap-3 border-t border-line px-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <Amount minor={p.amountMinor} cur={cur} strong />
            <p className="text-[14px] text-muted">{date(p.paidOn, locale)}{p.method ? ` · ${p.method}` : ""}</p>
          </div>
          {p.receiptId ? (
            <Link to="/app/documents/$id" params={{ id: p.receiptId }} className="min-h-11 py-2.5 font-semibold underline underline-offset-4">{T.receiptDone}</Link>
          ) : (
            <Button variant="outline" className="min-h-11 px-3" icon={<Receipt className="size-4" />} loading={busy === `r-${p.id}`} onClick={() => run(`r-${p.id}`, `payments/${p.id}/receipt`)}>{T.receipt}</Button>
          )}
        </div>
      ))}
      {doc.status !== "paid" && !open && (
        <div className="border-t border-line px-4 py-4 sm:px-6">
          <Button variant="outline" className="w-full" icon={<Wallet className="size-5" />} onClick={() => setOpen(true)}>{T.recordPayment}</Button>
        </div>
      )}
      {open && (
        <form className="space-y-3 border-t border-line px-4 py-4 sm:px-6" onSubmit={(e) => {
          e.preventDefault();
          run("pay", `documents/${doc.id}/payments`, { amount: form.amount, method: form.method || null, paidOn: form.paidOn }, () => {
            setOpen(false);
            setForm({ ...form, amount: "", method: "" });
          });
        }}>
          <Field label={`${T.amount} (${cur.symbol})`}><Input inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="font-mono" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={T.paidOn}><Input type="date" value={form.paidOn} onChange={(e) => setForm({ ...form, paidOn: e.target.value })} /></Field>
            <Field label={T.method} optional><Input value={form.method} placeholder={T.methodPlaceholder} onChange={(e) => setForm({ ...form, method: e.target.value })} maxLength={80} /></Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit" loading={busy === "pay"}>{T.save}</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>{t.common.cancel}</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function DocumentPage() {
  const { t, locale } = useI18n();
  const T = t.app.document;
  const E = t.app.editor;
  const { id } = Route.useParams();
  const me = useMe();
  const doc = useApi<DocumentDetail>("org", `/v1/portal/documents/${id}`);
  const clauses = useApi<{ items: Array<{ id: string; title: string | null; body: string; isDefault: boolean }> }>("org", "/v1/portal/clauses");
  const clients = useApi<{ items: Array<{ id: string; name: string }> }>("org", "/v1/portal/clients");
  const [server, setServer] = useState<DocumentDetail | null>(null);
  const [draft, setDraft] = useState<DocDraft | null>(null);
  const [tab, setTab] = useState<Tab>("detail");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pdf, setPdf] = useState(false);
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState(0);
  const loadedFor = useRef<string | null>(null);

  // Le brouillon local est construit une fois par document (et à chaque changement de statut).
  useEffect(() => {
    if (!doc.data || !me.data) return;
    setServer(doc.data);
    const key = `${doc.data.id}:${doc.data.status}:${doc.data.updatedAt}`;
    if (loadedFor.current?.startsWith(`${doc.data.id}:${doc.data.status}`) && doc.data.status === "draft") return;
    loadedFor.current = key;
    setDraft(fromDocument(doc.data, doc.data.currency));
  }, [doc.data, me.data]);

  // Émis : le PDF se prépare en arrière-plan.
  useEffect(() => {
    if (server && server.status !== "draft" && server.rendered === false) {
      const timer = setTimeout(doc.reload, 2500);
      return () => clearTimeout(timer);
    }
  }, [server, doc.reload]);

  const isDraft = server?.status === "draft";
  const save = useCallback(async (d: DocDraft | null) => {
    if (!d) return;
    const updated = await api<DocumentDetail>("org", `/v1/portal/documents/${id}`, { method: "PUT", body: toInput(d) }).catch((e) => {
      setError(e as ApiError);
      throw e;
    });
    setError(null);
    setServer((s) => ({ ...(s ?? updated), ...updated }));
    setVersion((v) => v + 1);
  }, [id]);
  const autosave = useAutosave(draft, Boolean(isDraft), save);
  const update = useCallback((fn: (d: DocDraft) => DocDraft) => setDraft((d) => (d ? fn(d) : d)), []);

  async function run(name: string, path: string, body?: unknown, after?: (r: any) => void) {
    setBusy(name);
    setError(null);
    try {
      if (isDraft) await autosave.flush();
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

  const chat = chatLink(chatChannel(me.data?.channels), server ? T.correctMessage(server.number ?? server.title ?? server.typeLabel) : undefined);
  const counts = useMemo(() => {
    if (!draft) return { lines: 0, groups: 0 };
    return { lines: draft.sections.reduce((n, s) => n + s.lines.filter((l) => l.label.trim()).length, 0), groups: draft.sections.filter((s) => s.title.trim()).length };
  }, [draft]);

  if (doc.error) return <div className="p-4 sm:p-6"><ErrorBox message={doc.error.status === 404 ? t.common.notFound : undefined} onRetry={doc.reload} /></div>;
  if (!server || !draft || !me.data) return <div className="p-4 sm:p-6"><SkeletonList rows={6} /></div>;
  const cur = server.currency;
  const shareText = server.shareUrl ? T.shareText(server.typeLabel, server.number ?? "", server.shareUrl) : "";
  const readOnly = !isDraft;

  return (
    <div className="pb-[150px] lg:pb-24">
      <datalist id="firmo-clients">{clients.data?.items.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <div className="flex h-[72px] items-center gap-2 border-b border-line px-2 sm:px-4">
        <Link to="/app" aria-label={t.common.back} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5"><ArrowLeft className="size-5" /></Link>
        <div className="min-w-0 flex-1 text-center">
          <h1 className="truncate font-mono text-[18px] font-bold">{server.number ?? `${server.typeLabel} · ${t.app.documents.draftNumber}`}</h1>
          <div className="mt-0.5 flex justify-center">{isDraft ? <SaveIndicator state={autosave.state} /> : <StatusBadge status={server.expired ? "expired" : server.status} />}</div>
        </div>
        <ActionsMenu doc={server} busy={busy} run={run} onPdf={() => void autosave.flush().then(() => setPdf(true))} />
      </div>

      <div className="flex items-start gap-4 border-b border-line px-4 py-5 sm:px-6">
        <div className="min-w-0 flex-1">
          <p className="mono-label">{E.title}</p>
          {isDraft ? (
            <input value={draft.title} onChange={(e) => update((d) => ({ ...d, title: e.target.value }))} placeholder={E.titlePlaceholder} maxLength={200} aria-label={E.title}
              className="mt-1 w-full border-0 bg-transparent p-0 text-[20px] font-semibold leading-7 placeholder:font-normal placeholder:text-mute-soft focus:outline-none focus-visible:outline-none" />
          ) : (
            <p className="mt-1 text-[20px] font-semibold leading-7">{server.title || server.client.name || "—"}</p>
          )}
          {!isDraft && server.client.name && server.title && <p className="text-[15px] text-ink-soft">{server.client.name}</p>}
        </div>
        <div className="text-right">
          <p className="text-[13px] text-muted">{E.lineCount(counts.lines)}{counts.groups ? ` · ${E.groups(counts.groups)}` : ""}</p>
          <p className="mt-1 whitespace-nowrap font-mono text-[17px] font-bold">{figure(server.totalMinor, cur)} <span className="text-[11px] font-normal text-muted">{cur.symbol}</span></p>
        </div>
      </div>

      <div className="space-y-2 px-4 pt-3 empty:hidden sm:px-6">
        {error && <Notice tone="warn">{error.message}</Notice>}
        {isDraft && server.blockers.length > 0 && <Notice tone="info">{T.missing} {server.blockers.map((b) => T.blockers[b as keyof typeof T.blockers] ?? b).join(", ")}</Notice>}
        {server.expired && <Notice tone="warn">{T.expired}</Notice>}
        {!isDraft && !server.rendered && <p className="flex items-center gap-2 py-2 text-muted" role="status"><Loader2 className="size-4 animate-spin" aria-hidden /> {T.preparing}</p>}
        {server.decisionBy && <Notice tone={server.status === "accepted" ? "ok" : "warn"}>{T.decidedBy(server.decisionBy)}{server.decisionNote ? ` : « ${server.decisionNote} »` : ""}</Notice>}
        {!isDraft && server.views && <p className="text-[14px] text-muted">{T.viewedTimes(server.views.count, date(server.views.last, locale))}</p>}
        {server.sourceNumber && <p className="text-[14px] text-muted">{T.source} : <span className="font-mono">{server.sourceNumber}</span></p>}
      </div>

      <div className="mt-2">
        <Tabs<Tab> value={tab} onChange={setTab} items={[{ value: "detail", label: E.tabDetail }, { value: "conditions", label: E.tabConditions }, { value: "totals", label: E.tabTotals }]} />
      </div>
      {tab === "detail" && <DetailTab draft={draft} server={server} cur={cur} me={me.data} readOnly={readOnly} update={update} />}
      {tab === "conditions" && <ConditionsTab draft={draft} update={update} me={me.data} readOnly={readOnly} clauses={clauses.data?.items ?? []} />}
      {tab === "totals" && <TotalsTab draft={draft} server={server} cur={cur} readOnly={readOnly} update={update} />}
      {!isDraft && server.payable && ["issued", "partially_paid", "paid"].includes(server.status) && <Payments doc={server} busy={busy} run={run} />}

      <div className="fixed inset-x-0 bottom-[60px] z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] lg:bottom-0">
        <div className="mx-auto flex max-w-[960px] gap-2 px-3 py-3 sm:px-6">
          {isDraft ? (
            <>
              {chat && <a href={chat} target="_blank" rel="noreferrer" className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[var(--radius-field)] border-[1.5px] border-ink bg-surface px-3 text-[15px] font-semibold"><MessageCircle className="size-5" aria-hidden /> {T.correctByMessage}</a>}
              <Button className="flex-1" icon={<FileText className="size-5" />} onClick={() => void autosave.flush().then(() => setPdf(true))}>{T.seePdf}</Button>
            </>
          ) : server.shareUrl && !["cancelled", "replaced"].includes(server.status) ? (
            <>
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer"
                onClick={() => void api("org", `/v1/portal/documents/${server.id}/share`, { method: "POST", body: {} }).catch(() => undefined)}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[var(--radius-field)] bg-ink px-3 text-[15px] font-semibold text-paper"><Send className="size-5" aria-hidden /> {T.share}</a>
              <Button variant="outline" className="flex-1" icon={copied ? <Check className="size-5" /> : <Copy className="size-5" />} onClick={async () => {
                await api("org", `/v1/portal/documents/${server.id}/share`, { method: "POST", body: {} }).catch(() => undefined);
                await navigator.clipboard.writeText(server.shareUrl!).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}>{copied ? t.common.copied : T.copyLink}</Button>
              <button type="button" aria-label={T.download} onClick={() => downloadPdf(server.id, server.number ?? "document")} className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-field)] border-[1.5px] border-line bg-surface"><Download className="size-5" /></button>
            </>
          ) : (
            <Button className="flex-1" variant="outline" icon={<Download className="size-5" />} onClick={() => downloadPdf(server.id, server.number ?? "document")}>{T.download}</Button>
          )}
        </div>
      </div>

      {pdf && (
        <PdfSheet
          doc={server}
          version={`${version}-${server.totalMinor}-${server.status}`}
          remaining={me.data.entitlement ? me.data.entitlement.remaining - 1 : null}
          onClose={() => setPdf(false)}
          onIssued={() => {
            setPdf(false);
            doc.reload();
            me.reload();
          }}
        />
      )}
    </div>
  );
}
