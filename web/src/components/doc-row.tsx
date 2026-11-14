import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui";
import { type Currency, date, money } from "@/lib/format";
import type { DocumentSummary } from "@/lib/portal";
import { useI18n } from "@/l10n";

/** Ligne de document (listes) : type et numéro, client, montant, statut. */
export function DocRow({ doc, currency }: { doc: DocumentSummary; currency: Currency }) {
  const { t, locale } = useI18n();
  const expired = doc.status === "issued" && doc.validUntil !== null && doc.validUntil < new Date().toISOString().slice(0, 10);
  return (
    <Link
      to="/app/documents/$id"
      params={{ id: doc.id }}
      className="flex min-h-16 items-center gap-3 px-4 py-3 transition hover:bg-paper"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {doc.typeLabel} <span className="font-normal text-muted">· {doc.number ?? t.app.documents.draftNumber}</span>
        </p>
        <p className="truncate text-sm text-muted">
          {doc.clientName ?? t.app.documents.noClient} · {date(doc.issueDate ?? doc.createdAt, locale)}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="font-semibold tabular-nums">{money(doc.totalMinor, currency)}</span>
        <StatusBadge status={expired ? "expired" : doc.status} />
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
