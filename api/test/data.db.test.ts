import { inflateRawSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pgDocumentStore } from "../src/documents/store.js";
import { sessionSigner } from "../src/lib/session.js";
import { memoryStore } from "../src/lib/storage.js";
import { type AnalyticsEvent, posthogSink, purgeMedia, relayAnalytics } from "../src/ops/maintenance.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { registerAdminV1Routes } from "../src/routes/admin-v1.js";
import { pgPortalSessionStore } from "../src/routes/portal-session.js";
import { registerPortalRoutes } from "../src/routes/portal.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

/** Noms des fichiers d'une archive ZIP (entrées du répertoire central). */
function zipNames(buf: Buffer): string[] {
  const names: string[] = [];
  let i = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(i + 10);
  let p = buf.readUInt32LE(i + 16);
  for (let n = 0; n < count; n++) {
    const len = buf.readUInt16LE(p + 28);
    names.push(buf.subarray(p + 46, p + 46 + len).toString("utf8"));
    p += 46 + len + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  void inflateRawSync;
  return names;
}

describe.skipIf(!hasDatabase)("mesure et données (spec 014)", () => {
  const pool = testPool();
  const secret = "secret-de-partage-pour-les-tests-1234";
  const signer = sessionSigner("s".repeat(40));
  const files = memoryStore();
  const documents = pgDocumentStore(pool, { shareSecret: secret });
  const render = new RenderService({ pool, documents, files, renderer: new DocumentRenderer(), shareSecret: secret, webUrl: "https://firmo.test" });
  const app = createApp({
    env: "local",
    signer,
    allowedOrigins: [],
    health: { database: async () => true, worker: () => true },
    portalSessions: pgPortalSessionStore(pool),
    modules: [
      (a) => registerPortalRoutes(a, { pool, signer, documents, render, files, webUrl: "https://firmo.test" }),
      (a) => registerAdminV1Routes(a, { pool, signer, webUrl: "https://firmo.test", portalLink: async () => ({ token: "x".repeat(43), minutes: 60 }), files }),
    ],
  });
  afterAll(() => pool.end());

  async function newOrg() {
    const r = await pool.query<{ org_id: string; identity_id: string }>("select org_id, identity_id from app.ensure_identity('simulator', $1, null, '+22890000000', null)", [uid("data")]);
    await pool.query("update public.organizations set name = 'Atelier Données' where id = $1", [r.rows[0]!.org_id]);
    return { org: r.rows[0]!.org_id, identity: r.rows[0]!.identity_id, token: await signer.sign({ scope: "org", orgId: r.rows[0]!.org_id }, 3600) };
  }

  it("P-80 PostHog : propriétés techniques seulement, rien sans clé, relayé une fois", async () => {
    const { org } = await newOrg();
    await pool.query("select app.emit('document_shared', $1, $2::jsonb)", [org, JSON.stringify({ doc_type: "quote", via: "web", client_name: "Hôtel du Lac", phone: "+22890", total_minor: 185000 })]);
    const sent: unknown[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const sink = posthogSink({ host: "https://eu.i.posthog.com", projectKey: "phc_test", fetchImpl: fakeFetch });
    await relayAnalytics(pool, sink, 100_000);
    const batch = (sent[0] as { url: string; body: { api_key: string; batch: Array<{ event: string; distinct_id: string; properties: Record<string, unknown> }> } });
    expect(batch.url).toBe("https://eu.i.posthog.com/batch/");
    const ev = batch.body.batch.find((e) => e.event === "document_shared" && e.distinct_id === org)!;
    expect(ev.properties).toEqual({ doc_type: "quote", via: "web", $lib: "firmo-api" });
    expect(JSON.stringify(batch.body)).not.toMatch(/Hôtel|\+22890|185000/);
    expect(await relayAnalytics(pool, sink, 100_000)).toBe(0);
    // Échec de l'envoi : rien n'est marqué relayé.
    await pool.query("select app.emit('document_shared', $1, '{}')", [org]);
    const failing = { send: async (_e: AnalyticsEvent[]) => { throw new Error("PostHog 503"); } };
    await expect(relayAnalytics(pool, failing)).rejects.toThrow();
    expect((await pool.query("select count(*)::int as n from public.analytics_events where org_id = $1 and forwarded_at is null", [org])).rows[0].n).toBe(1);
  });

  it("P-81 médias sources supprimés du stockage après la durée", async () => {
    const { org, identity } = await newOrg();
    await files.put("inbox/test/old.ogg", Buffer.from("ogg"), "audio/ogg");
    const m = await pool.query<{ id: string }>(`insert into public.messages (org_id, identity_id, channel, direction, kind, status, media_key, created_at)
      values ($1, $2, 'simulator', 'in', 'audio', 'processed', 'inbox/test/old.ogg', now() - interval '45 days') returning id`, [org, identity]);
    expect(await purgeMedia(pool, files, 10_000)).toBeGreaterThanOrEqual(1);
    expect(files.files.has("inbox/test/old.ogg")).toBe(false);
    expect((await pool.query("select media_key, media_purged_at from public.messages where id = $1", [m.rows[0]!.id])).rows[0]).toMatchObject({ media_key: null });
  });

  it("P-82 export : archive avec données, liste des documents et PDF émis", async () => {
    const { org, token } = await newOrg();
    const id = await documents.createDraft(org, "quote", [{ label: "Porte", quantity: "2", unit: null, unitPriceMinor: "45000" }]);
    await documents.issue(org, id);
    const doc = await documents.get(org, id);
    await render.handleJob({ id: "r", kind: "render_document", payload: { document_id: id, version: doc.renderVersion }, attempts: 1 });
    const res = await app.request("/v1/portal/export", { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    const names = zipNames(Buffer.from(await res.arrayBuffer()));
    expect(names).toContain("firmo/donnees.json");
    expect(names).toContain("firmo/documents.csv");
    expect(names.some((n) => n.startsWith("firmo/pdf/") && n.endsWith(".pdf"))).toBe(true);
    expect((await pool.query("select status from public.data_requests where org_id = $1 and kind = 'export'", [org])).rows[0].status).toBe("done");
  });

  it("P-83 suppression exécutée depuis la console : motif, fichiers effacés, documents émis gardés", async () => {
    const { org, identity } = await newOrg();
    await files.put(`brand/${org}/logo.png`, Buffer.from("png"), "image/png");
    await pool.query("update public.organizations set logo_key = $2 where id = $1", [org, `brand/${org}/logo.png`]);
    const id = await documents.createDraft(org, "quote", [{ label: "Porte", quantity: "1", unit: null, unitPriceMinor: "50000" }]);
    await documents.issue(org, id);
    const req = (await pool.query<{ id: string }>("select app.request_data($1, $2, 'deletion', 'chat') as id", [org, identity])).rows[0]!.id;
    const email = `${uid("adm")}@firmo.test`;
    const user = (await pool.query(`insert into neon_auth."user" (name, email, "emailVerified") values ('a', $1, true) returning id`, [email])).rows[0].id;
    await pool.query("insert into public.staff (user_id, email, role) values ($1, $2, 'admin')", [user, email]);
    const staff = await signer.sign({ scope: "staff", userId: user, role: "admin", email }, 3600);
    const call = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${staff}` }, body: JSON.stringify(body) });
    expect((await call(`/v1/admin/data-requests/${req}/execute`, { reason: "ok" })).status).toBe(422);
    const ok = await (await call(`/v1/admin/data-requests/${req}/execute`, { reason: "demande vérifiée depuis le même numéro" })).json();
    expect(ok.filesRemoved).toBeGreaterThanOrEqual(1);
    expect(files.files.has(`brand/${org}/logo.png`)).toBe(false);
    expect((await pool.query("select status, name from public.organizations where id = $1", [org])).rows[0]).toEqual({ status: "deleted", name: null });
    expect((await pool.query("select status from public.documents where id = $1", [id])).rows[0].status).toBe("issued");
  });
});
