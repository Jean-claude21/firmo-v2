import type pg from "pg";
import { sql, sqlOne } from "../lib/db.js";
import type { ObjectStore } from "../lib/storage.js";
import { shareToken, shareUrl } from "../documents/share.js";
import type { DocumentStore, DocumentView } from "../documents/store.js";
import { PermanentJobError, type Job } from "../worker/worker.js";
import { renderModel } from "./model.js";
import type { DocumentRenderer, RenderOutput } from "./renderer.js";

// Rendu des documents émis (DOC-5) : une version = trois fichiers immuables + un lien de
// partage (QR code). Les brouillons ont un aperçu à la demande, jamais stocké.

export interface RenderedFiles {
  pdfKey: string;
  pngKey: string;
  svgKey: string;
  version: number;
  pages: number;
}

export type RenderedListener = (doc: DocumentView, files: RenderedFiles) => Promise<void>;

export interface RenderServiceDeps {
  pool: pg.Pool;
  documents: DocumentStore;
  files: ObjectStore;
  renderer: DocumentRenderer;
  shareSecret: string;
  webUrl: string;
}

export class RenderService {
  private readonly listeners: RenderedListener[] = [];

  constructor(private readonly deps: RenderServiceDeps) {}

  /** Appelé après chaque rendu réussi (envoi dans le chat, spec 004). */
  onRendered(listener: RenderedListener): void {
    this.listeners.push(listener);
  }

  shareLink(documentId: string): string {
    return shareUrl(this.deps.webUrl, shareToken(this.deps.shareSecret, documentId));
  }

  private async logo(doc: DocumentView): Promise<{ bytes: Buffer } | null> {
    const key = (doc.issuer as { logo_key?: string } | null)?.logo_key;
    if (!key) return null;
    try {
      return { bytes: await this.deps.files.get(key) };
    } catch {
      // Logo illisible : le document part sans logo plutôt que pas du tout.
      return null;
    }
  }

  /** Gestionnaire de la tâche `render_document`. */
  async handleJob(job: Job): Promise<void> {
    const documentId = String(job.payload.document_id ?? "");
    const version = Number(job.payload.version ?? 0);
    if (!documentId || !version) throw new PermanentJobError("tâche de rendu incomplète");
    const doc = await this.deps.documents.getAny(documentId);
    if (doc.status === "draft") throw new PermanentJobError("un brouillon ne se rend pas en version");
    // Lien de partage valide avant d'imprimer son QR code.
    await this.deps.documents.share(doc.orgId, doc.id);
    const logo = await this.logo(doc);
    const output = await this.deps.renderer.render({
      model: renderModel(doc, { hasLogo: logo !== null, hasQr: true }),
      qrUrl: this.shareLink(doc.id),
      logo,
    });
    const files = await this.store(doc, version, output);
    for (const listener of this.listeners) await listener(doc, files);
  }

  private async store(doc: DocumentView, version: number, out: RenderOutput): Promise<RenderedFiles> {
    const base = `documents/${doc.orgId}/${doc.id}/v${version}`;
    const files = { pdfKey: `${base}.pdf`, pngKey: `${base}.png`, svgKey: `${base}.svg` };
    await this.deps.files.put(files.pdfKey, out.pdf, "application/pdf");
    await this.deps.files.put(files.pngKey, out.png, "image/png");
    await this.deps.files.put(files.svgKey, Buffer.from(out.svg), "image/svg+xml");
    await sql(this.deps.pool, "select app.record_render($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
      doc.id, version, files.pdfKey, files.pngKey, files.svgKey, out.sha256, out.pages, out.pdf.length, out.durationMs,
    ]);
    return { ...files, version, pages: out.pages };
  }

  /** Fichiers du rendu courant d'un document émis, ou null s'il n'est pas encore prêt. */
  async current(documentId: string): Promise<RenderedFiles | null> {
    const rows = await sql<{ pdf_key: string | null; png_key: string; svg_key: string; version: number; pages: number }>(
      this.deps.pool,
      "select pdf_key, png_key, svg_key, version, pages from app.latest_render($1)",
      [documentId],
    );
    const r = rows[0];
    if (!r?.pdf_key) return null;
    return { pdfKey: r.pdf_key, pngKey: r.png_key, svgKey: r.svg_key, version: r.version, pages: r.pages };
  }

  file(key: string): Promise<Buffer> {
    return this.deps.files.get(key);
  }

  /** Aperçu (brouillon ou document émis non encore rendu) : jamais stocké. */
  async preview(doc: DocumentView): Promise<RenderOutput> {
    // Un brouillon n'a pas d'en-tête figé : on prend celui de l'organisation à l'instant.
    const issuer = doc.issuer ?? (await this.liveIssuer(doc.orgId));
    const view = { ...doc, issuer };
    const logo = await this.logo(view);
    return this.deps.renderer.render({
      model: renderModel(view, { hasLogo: logo !== null, hasQr: false, draft: doc.status === "draft" }),
      logo,
    });
  }

  private async liveIssuer(orgId: string): Promise<Record<string, unknown>> {
    const r = await sqlOne<{ issuer: Record<string, unknown> }>(this.deps.pool, "select app.issuer_snapshot($1) as issuer", [orgId]);
    return r.issuer;
  }

  async logoKey(orgId: string): Promise<string | null> {
    const r = await sqlOne<{ logo_key: string | null }>(this.deps.pool, "select logo_key from public.organizations where id = $1", [orgId]);
    return r.logo_key;
  }
}
