import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, MessageCircle } from "lucide-react";
import { useState } from "react";
import { TypeTag } from "@/components/doc-row";
import { ErrorBox, Notice, SkeletonList } from "@/components/ui";
import { api, type ApiError } from "@/lib/api";
import { chatChannel, chatLink } from "@/lib/chat";
import { type DocumentDetail, useMe } from "@/lib/portal";
import { useT } from "@/l10n";

// Nouveau document depuis l'espace : on choisit le type, le brouillon s'ouvre dans l'éditeur (P-63).
// Le chat reste proposé en premier : c'est l'entrée principale (constitution VIII).
export const Route = createFileRoute("/app/documents/nouveau")({ component: NewDocument });

function NewDocument() {
  const t = useT();
  const N = t.app.newDocument;
  const me = useMe();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const channel = chatChannel(me.data?.channels);
  const chat = chatLink(channel);

  async function create(type: string) {
    setBusy(type);
    setError(null);
    try {
      const doc = await api<DocumentDetail>("org", "/v1/portal/documents", { body: { type } });
      void navigate({ to: "/app/documents/$id", params: { id: doc.id } });
    } catch (e) {
      setError(e as ApiError);
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex h-[72px] items-center gap-2 border-b border-line px-2 sm:px-4">
        <Link to="/app" aria-label={t.common.back} className="flex size-11 items-center justify-center rounded-[var(--radius-field)] hover:bg-ink/5"><ArrowLeft className="size-5" /></Link>
        <h1 className="text-[20px] font-semibold">{t.app.editor.newTitle}</h1>
      </div>
      {chat && (
        <a href={chat} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-b border-line bg-paper-alt px-4 py-4 sm:px-6">
          <MessageCircle className="size-5 shrink-0" aria-hidden />
          <span className="flex-1"><span className="block font-semibold">{N.byMessage}</span><span className="block text-[14px] text-ink-soft">{N.byMessageHint}</span></span>
          <ChevronRight className="size-5 text-muted" aria-hidden />
        </a>
      )}
      <p className="mono-label px-4 pb-2 pt-6 sm:px-6">{N.choose}</p>
      {me.error && <ErrorBox onRetry={me.reload} />}
      {error && <div className="px-4 pb-3 sm:px-6"><Notice tone="warn">{error.message}</Notice></div>}
      {!me.data ? <div className="p-4"><SkeletonList rows={3} /></div> : (
        <div className="border-t border-line">
          {me.data.reference.documentTypes.map((d) => (
            <button key={d.code} type="button" disabled={busy !== null} onClick={() => create(d.code)} className="flex min-h-[76px] w-full items-center gap-4 border-b border-line px-4 text-left hover:bg-paper-alt disabled:opacity-50 sm:px-6">
              <TypeTag type={d.code} />
              <span className="flex-1">
                <span className="block text-[17px] font-semibold">{d.label}</span>
                <span className="block text-[14px] text-muted">{N.hint[d.code as keyof typeof N.hint] ?? ""}</span>
              </span>
              <ChevronRight className="size-5 text-muted" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
