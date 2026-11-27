import { Link } from "@tanstack/react-router";
import { Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import { api, type ApiError, session, useApi } from "@/lib/api";
import { date } from "@/lib/format";
import { useI18n } from "@/l10n";

/** Télécharge l'archive des données de l'artisan (P-82). */
export async function downloadExport(): Promise<void> {
  const res = await fetch("/v1/portal/export", { headers: { Authorization: `Bearer ${session.get("org")}` } });
  if (!res.ok) throw new Error(String(res.status));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `firmo-export-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Vos données (P-82, P-83) : export immédiat, demande de suppression suivie. */
export function MyData() {
  const { t, locale } = useI18n();
  const D = t.app.myData;
  const requests = useApi<{ items: Array<{ kind: string; status: string; createdAt: string; handledAt: string | null }> }>("org", "/v1/portal/data-requests");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const pending = requests.data?.items.find((r) => r.kind === "deletion" && r.status === "pending");
  return (
    <div className="space-y-4">
      <p className="text-[15px] text-ink-soft">{D.exportText}</p>
      <Button variant="outline" icon={<Download className="size-4" />} loading={busy === "export"} onClick={async () => {
        setBusy("export");
        setError(null);
        try {
          await downloadExport();
          requests.reload();
        } catch (e) {
          setError(e as Error);
        } finally {
          setBusy(null);
        }
      }}>{D.export}</Button>
      <div className="border-t border-line pt-4">
        <p className="text-[15px] text-ink-soft">{D.deleteText} <Link to="/suppression-donnees" className="underline underline-offset-4">{D.learnMore}</Link></p>
        {pending ? (
          <div className="mt-3"><Notice tone="info">{D.pending(date(pending.createdAt, locale))}</Notice></div>
        ) : (
          <Button variant="danger" className="mt-3" icon={<Trash2 className="size-4" />} loading={busy === "delete"} onClick={async () => {
            if (!confirm(D.deleteConfirm)) return;
            setBusy("delete");
            setError(null);
            try {
              await api("org", "/v1/portal/data-requests", { body: { kind: "deletion" } });
              requests.reload();
            } catch (e) {
              setError(e as ApiError);
            } finally {
              setBusy(null);
            }
          }}>{D.delete}</Button>
        )}
      </div>
      {error && <Notice tone="warn">{error.message}</Notice>}
    </div>
  );
}
