import { PNG } from "pngjs";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { pgDocumentStore } from "../src/documents/store.js";
import { sessionSigner } from "../src/lib/session.js";
import { memoryStore } from "../src/lib/storage.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { pgPortalSessionStore } from "../src/routes/portal-session.js";
import { registerPortalRoutes } from "../src/routes/portal.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

function redLogo(): string {
  const png = new PNG({ width: 64, height: 64 });
  for (let i = 0; i < 64 * 64; i++) png.data.set([200, 30, 40, 255], i * 4);
  return PNG.sync.write(png).toString("base64");
}

describe.skipIf(!hasDatabase)("espace artisan et page publique", () => {
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
    modules: [(a) => registerPortalRoutes(a, { pool, signer, documents, render, files, webUrl: "https://firmo.test" })],
  });
  afterAll(() => pool.end());

  let token = "";
  const call = async (method: string, path: string, body?: unknown, auth = true) => {
    const res = await app.request(path, {
      method,
      headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, body: type.includes("json") ? await res.json() : await res.arrayBuffer(), type };
  };

  it("parcours web complet", async () => {
    const r = await pool.query<{ org_id: string }>("select org_id from app.ensure_identity('simulator', $1, null, '+22890000000', null)", [uid("web")]);
    token = await signer.sign({ scope: "org", orgId: r.rows[0]!.org_id }, 3600);

    expect((await call("GET", "/v1/portal/me", undefined, false)).status).toBe(401);
    const me = await call("GET", "/v1/portal/me");
    expect(me.status).toBe(200);
    expect(me.body.currency.code).toBe("XOF");
    expect(me.body.reference.countries.find((c: any) => c.code === "TG").legalIds.map((l: any) => l.code)).toEqual(["rccm", "nif"]);

    expect((await call("PATCH", "/v1/portal/profile", { name: "Électricité Komla", tradeCode: "electricity", legalIds: { rccm: "TG-1" }, paymentMethods: "Flooz" })).status).toBe(200);
    expect((await call("PATCH", "/v1/portal/profile", { plan: "pro" })).status).toBe(422);
    const logo = await call("POST", "/v1/portal/logo", { base64: redLogo() });
    expect(logo.body.suggestedColor).toBe("#C81E28");

    const created = await call("POST", "/v1/portal/documents", {
      type: "quote",
      title: "Installation électrique",
      client: { name: "Clinique Saint-Luc", phone: "+22890000001" },
      lines: [
        { label: "Câble 2,5 mm²", quantity: "50", unit: "m", unitPrice: "750" },
        { label: "Main d'œuvre", quantity: "2", unit: "day", unitPrice: "25 000" },
      ],
      discount: { percent: "5" },
    });
    expect(created.status).toBe(201);
    expect(created.body.totalMinor).toBe("83125");
    const id = created.body.id as string;

    const bad = await call("PUT", `/v1/portal/documents/${id}`, { lines: [{ label: "X", quantity: "1", unit: null, unitPrice: "beaucoup" }] });
    expect(bad.status).toBe(422);

    const draftPdf = await call("GET", `/v1/portal/documents/${id}/file.pdf`);
    expect(draftPdf.type).toBe("application/pdf");

    const issued = await call("POST", `/v1/portal/documents/${id}/issue`);
    expect(issued.body.number).toMatch(/^DEV-/);
    await render.handleJob({ id: "r", kind: "render_document", payload: { document_id: id, version: 1 }, attempts: 1 });
    const detail = await call("GET", `/v1/portal/documents/${id}`);
    expect(detail.body.rendered).toBe(true);

    const share = await call("POST", `/v1/portal/documents/${id}/share`);
    const publicToken = (share.body.url as string).split("/d/")[1]!;
    const pub = await call("GET", `/v1/public/documents/${publicToken}`, undefined, false);
    expect(pub.status).toBe(200);
    expect(pub.body.orgId).toBeUndefined();
    expect(pub.body.issuer.name).toBe("Électricité Komla");
    const svg = await call("GET", `/v1/public/documents/${publicToken}/file.svg`, undefined, false);
    expect(svg.type).toBe("image/svg+xml");
    const decision = await call("POST", `/v1/public/documents/${publicToken}/decision`, { decision: "accepted", note: "Bon pour accord" }, false);
    expect(decision.body.status).toBe("accepted");

    const invoice = await call("POST", `/v1/portal/documents/${id}/convert`);
    await call("POST", `/v1/portal/documents/${invoice.body.id}/issue`);
    const pay = await call("POST", `/v1/portal/documents/${invoice.body.id}/payments`, { amount: "50 000", method: "Espèces" });
    expect(pay.status).toBe(200);
    const receipt = await call("POST", `/v1/portal/payments/${pay.body.id}/receipt`);
    expect(receipt.status).toBe(200);

    const dash = await call("GET", "/v1/portal/dashboard");
    expect(dash.body.stats.collected_this_month_minor).toBe(50000);
    const clients = await call("GET", "/v1/portal/clients");
    expect(clients.body.items[0].name).toBe("Clinique Saint-Luc");
    const list = await call("GET", "/v1/portal/documents?type=invoice");
    expect(list.body.total).toBe(1);
  }, 60_000);
});
