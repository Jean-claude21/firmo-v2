import { authedBlobUrl } from "./api";

/** Télécharge le PDF d'un document de l'espace (session dans l'en-tête, jamais dans l'URL). */
export async function downloadPdf(id: string, name: string): Promise<void> {
  const url = await authedBlobUrl("org", `/v1/portal/documents/${id}/file.pdf`);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[\/:*?"<>|]+/g, "-")}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
