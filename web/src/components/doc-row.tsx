import { Link } from "@tanstack/react-router";
import { ChevronRight, Download } from "lucide-react";
import { useState } from "react";
import { type Currency, figure } from "@/lib/format";
import { downloadPdf } from "@/lib/files";
import type { DocumentSummary } from "@/lib/portal";
import { useI18n } from "@/l10n";

/** Étiquette carrée du type (DEV, FAC, PRO…) en chasse fixe, comme la maquette v1. */
export function TypeTag({ type }: { type: string }) {
  const { t } = useI18n();
  return (
    <span className="flex size-12 shrink-0 items-center justify-center border border-line bg-surface font-mono text-[12px] font-semibold text-ink">
      {t.app.typeTag[type as keyof typeof t.app.typeTag] ?? type.slice(0, 3).toUpperCase()}
    </span>
  );
}

/** Ligne de document (P-62) : type, objet ou client, numéro et statut, téléchargement. */
export function DocRow({ doc, currency, showAmount = false }: { doc: DocumentSummary & { title?: string | null }; currency: Currency; showAmount?: boolean }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const expired = doc.status === "issued" && doc.validUntil !== null && doc.validUntil < new Date().toISOString().slice(0, 10);
  const status = t.status[(expired ? "expired" : doc.status) as keyof typeof t.status] ?? doc.status;
  const title = doc.title || doc.clientName || t.app.documents.noClient;
  return (
    <div className="flex min-h-[76px] items-center gap-3 border-b border-line px-4 sm:px-6">
      <Link to="/app/documents/$id" params={{ id: doc.id }} className="flex min-w-0 flex-1 items-center gap-4 py-3">
        <TypeTag type={doc.type} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{title}</p>
          <p className="truncate text-[14px] text-muted">
            <span className="font-mono">{doc.number ?? t.app.documents.draftNumber}</span> · {status}
          </p>
        </div>
        {showAmount && (
          <span className="hidden whitespace-nowrap font-mono text-[15px] sm:block">
            {figure(doc.totalMinor, currency)} <span className="text-[11px] text-muted">{currency.symbol}</span>
          </span>
        )}
      </Link>
      {doc.status !== "draft" ? (
        <button
          type="button"
          aria-label={`${t.app.document.download} ${doc.number ?? ""}`}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await downloadPdf(doc.id, doc.number ?? "document").catch(() => undefined);
            setBusy(false);
          }}
          className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-field)] text-ink hover:bg-ink/5 disabled:opacity-40"
        >
          <Download className="size-5" aria-hidden />
        </button>
      ) : (
        <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
      )}
    </div>
  );
}
