import { afterAll, describe, expect, it } from "vitest";
import type { AiReader, SaleReading } from "../src/ai/types.js";
import { simulatorChannel } from "../src/channels/simulator.js";
import type { Channel } from "../src/channels/types.js";
import { ConversationEngine } from "../src/conversation/engine.js";
import { pgConversationStore } from "../src/conversation/store.js";
import { pgDocumentStore } from "../src/documents/store.js";
import { memoryStore } from "../src/lib/storage.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

// IA factice : renvoie une lecture fixée. Elle « invente » un prix (50 000 au lieu de 45 000)
// pour vérifier que la garde le refuse.
function fakeReader(readings: Record<string, SaleReading>): AiReader {
  const usage = { model: "fake", durationMs: 1 };
  return {
    simulated: false,
    transcribe: async () => ({ value: "2 portes isoplanes à 45000 et la pose 10000 pour l'École Les Palmiers", usage }),
    readText: async (text) => ({ value: readings[text] ?? { documentType: null, clientName: null, title: null, lines: [] }, usage }),
    readImage: async () => ({ value: { documentType: null, clientName: null, title: null, lines: [] }, usage }),
    interpret: async () => ({ value: { action: "other", ops: [] }, usage }),
  };
}

const SALE = "2 portes isoplanes à 45000 et la pose 10000 pour l'École Les Palmiers";

describe.skipIf(!hasDatabase)("conversation de bout en bout (simulateur)", () => {
  const pool = testPool();
  const secret = "secret-de-partage-pour-les-tests-1234";
  const files = memoryStore();
  const documents = pgDocumentStore(pool, { shareSecret: secret });
  const store = pgConversationStore(pool);
  const render = new RenderService({ pool, documents, files, renderer: new DocumentRenderer(), shareSecret: secret, webUrl: "https://firmo.test" });
  const channels = new Map<string, Channel>();
  channels.set("simulator", simulatorChannel(files, {
    async record(to, kind, text, mediaKey, mediaType, buttons) {
      const identity = await store.identityByExternal("simulator", to);
      return store.recordOutbound(identity!, kind, text, mediaKey, mediaType, null, null, buttons ?? null);
    },
  }));
  const reader = fakeReader({
    [SALE]: {
      documentType: null,
      clientName: "École Les Palmiers",
      title: null,
      lines: [
        { label: "Porte isoplane", quantityText: "2", unit: "unit", unitPriceText: "50000", lineTotalText: null },
        { label: "Pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "10000" },
      ],
    },
  });
  const engine = new ConversationEngine({ store, documents, reader, channels, files, render, webUrl: "https://firmo.test" });
  afterAll(() => pool.end());

  const conversation = uid("sim").toLowerCase();

  async function send(text: string | null, media?: { key: string; type: string }) {
    if (media) await files.put(media.key, Buffer.from("audio"), media.type);
    const r = await store.receive({
      channel: "simulator",
      externalId: uid("m"),
      from: { id: conversation, name: "Afi", phone: "+22890112233", locale: null },
      kind: media ? "audio" : text?.startsWith("cmd:") ? "interactive" : "text",
      text,
      media: media ? { ref: media.key, mediaType: media.type } : null,
    });
    await engine.handleJob({ id: "j", kind: "process_message", payload: { message_id: r.messageId }, attempts: 1 });
    return r;
  }

  async function replies(): Promise<string[]> {
    const rows = await pool.query<{ text: string | null; kind: string }>(
      `select m.text, m.kind from public.messages m join public.channel_identities ci on ci.id = m.identity_id
       where ci.external_id = $1 and m.direction = 'out' order by m.created_at, m.id`,
      [conversation],
    );
    return rows.rows.map((r) => `${r.kind}:${r.text ?? ""}`);
  }

  async function renderPending(orgId: string) {
    const jobs = await pool.query<{ payload: Record<string, unknown> }>(
      `select j.payload from public.jobs j join public.documents d on d.id = (j.payload ->> 'document_id')::uuid
       where j.kind = 'render_document' and j.status = 'pending' and d.org_id = $1`,
      [orgId],
    );
    for (const j of jobs.rows) await render.handleJob({ id: "r", kind: "render_document", payload: j.payload, attempts: 1 });
    await pool.query(
      `update public.jobs set status = 'done' where kind = 'render_document' and status = 'pending'
         and (payload ->> 'document_id')::uuid in (select id from public.documents where org_id = $1)`,
      [orgId],
    );
  }

  it("vocal → brouillon gardé → correction → nom → émission → PDF → facture → paiement → reçu", async () => {
    const first = await send(null, { key: `inbox/simulator/${uid("a")}.ogg`, type: "audio/ogg" });
    let out = await replies();
    expect(out[0]).toMatch(/Je suis Firmo/);
    const draftMsg = out.at(-1)!;
    expect(draftMsg).toMatch(/Devis — brouillon/);
    // Le prix inventé (50 000) est refusé : la ligne 1 demande son prix.
    expect(draftMsg).toMatch(/1\. Porte isoplane — 2 u × ❓prix/);
    expect(draftMsg).toMatch(/2\. Pose — 1 forfait × 10 000 F CFA = 10 000 F CFA/);
    expect(draftMsg).toMatch(/Client : École Les Palmiers/);

    await send("ligne 1 prix 45 000");
    out = await replies();
    expect(out.at(-1)).toMatch(/Total : 100 000 F CFA\n/);
    expect(out.at(-1)).toMatch(/Réponds OK pour émettre/);

    await send("OK");
    expect((await replies()).at(-1)).toMatch(/Sous quel nom/);
    await send("Menuiserie Afi");
    out = await replies();
    expect(out.at(-2)).toMatch(/au nom de « Menuiserie Afi »/);
    expect(out.at(-1)).toMatch(/Devis DEV-\d{4}-001 émis/);

    await renderPending(first.orgId);
    out = await replies();
    expect(out.slice(-3).map((o) => o.split(":")[0])).toEqual(["image", "document", "text"]);
    expect(out.at(-1)).toMatch(/https:\/\/firmo\.test\/d\//);

    await send("facture");
    out = await replies();
    expect(out.at(-2)).toMatch(/Facture préparée à partir du devis DEV-/);
    await send("cmd:issue");
    expect((await replies()).at(-1)).toMatch(/Facture FAC-\d{4}-001 émis/);

    await send("payé 40 000 par Mobile Money");
    expect((await replies()).at(-1)).toMatch(/Paiement de 40 000 F CFA noté sur FAC-.*Reste à payer : 60 000 F CFA/s);
    await send("reçu");
    expect((await replies()).at(-1)).toMatch(/Reçu REC-\d{4}-001 émis/);

    await send("mes documents");
    const list = (await replies()).at(-1)!;
    expect(list).toMatch(/REC-.*Reçu/);
    expect(list).toMatch(/FAC-.*acompte/);

    const metrics = await pool.query<{ name: string }>(
      "select name from public.analytics_events where org_id = $1 order by id",
      [first.orgId],
    );
    const names = metrics.rows.map((r) => r.name);
    for (const event of ["org_created", "submission_received", "reading_done", "document_issued", "document_shared", "quote_converted", "payment_recorded"]) {
      expect(names).toContain(event);
    }
  }, 90_000);

  it("un message rejoué n'est traité qu'une fois", async () => {
    const m = {
      channel: "simulator",
      externalId: uid("dup"),
      from: { id: conversation, name: null, phone: null, locale: null },
      kind: "text" as const,
      text: "aide",
      media: null,
    };
    const a = await store.receive(m);
    const b = await store.receive(m);
    expect(b.duplicate).toBe(true);
    expect(b.messageId).toBe(a.messageId);
  });
});
