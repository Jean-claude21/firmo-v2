import { afterAll, describe, expect, it } from "vitest";
import { pgDocumentStore } from "../src/documents/store.js";
import { memoryStore } from "../src/lib/storage.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { pgJobStore, Worker } from "../src/worker/worker.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

describe.skipIf(!hasDatabase)("rendu à l'émission", () => {
  const pool = testPool();
  const secret = "secret-de-partage-pour-les-tests-1234";
  const documents = pgDocumentStore(pool, { shareSecret: secret });
  const files = memoryStore();
  const render = new RenderService({ pool, documents, files, renderer: new DocumentRenderer(), shareSecret: secret, webUrl: "https://firmo.test" });
  afterAll(() => pool.end());

  it("émettre crée une tâche ; le worker rend, stocke et prévient", async () => {
    const r = await pool.query<{ org_id: string }>(
      "select org_id from app.ensure_identity('simulator', $1, null, '+22890000000', null)",
      [uid("render")],
    );
    const orgId = r.rows[0]!.org_id;
    await pool.query("update public.organizations set name = 'Couture Afi', template_code = 'modern' where id = $1", [orgId]);
    const id = await documents.createDraft(orgId, "invoice", [
      { label: "Robe en pagne, coupe sirène", quantity: "2", unit: "unit", unitPriceMinor: "25000" },
    ]);
    const preview = await render.preview(await documents.get(orgId, id));
    expect(preview.pages).toBe(1);
    await documents.issue(orgId, id);

    const seen: string[] = [];
    render.onRendered(async (doc, out) => {
      seen.push(`${doc.number}:${out.version}`);
    });
    // Worker restreint à la tâche de ce document (la file de test peut contenir d'autres tâches).
    const jobs = pgJobStore(pool);
    const worker = new Worker(
      { ...jobs, claim: async (w, n) => (await jobs.claim(w, n)) },
      { name: "t-render", concurrency: 1 },
    ).on("render_document", async (job) => {
      if (job.payload.document_id === id) await render.handleJob(job);
    });
    await worker.drain();

    const current = await render.current(id);
    expect(current?.version).toBe(1);
    expect(files.files.get(current!.pdfKey)?.type).toBe("application/pdf");
    expect(files.files.get(current!.pngKey)?.body.length).toBeGreaterThan(1000);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^FAC-\d{4}-0001:1$/);
    // Le lien du QR code ouvre bien le document.
    const token = render.shareLink(id).split("/d/")[1]!;
    expect((await documents.publicDocument(token)).id).toBe(id);
  }, 60_000);
});
