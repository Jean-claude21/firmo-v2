import { afterAll, describe, expect, it } from "vitest";
import { pgDocumentStore } from "../src/documents/store.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

describe.skipIf(!hasDatabase)("documents sur Postgres", () => {
  const pool = testPool();
  const docs = pgDocumentStore(pool, { shareSecret: "secret-de-test-assez-long-pour-hmac" });
  afterAll(() => pool.end());

  async function org(): Promise<string> {
    const r = await pool.query<{ org_id: string }>(
      "select org_id from app.ensure_identity('simulator', $1, 'Test', '+22890000000', null)",
      [uid("doc")],
    );
    const id = r.rows[0]!.org_id;
    await pool.query("update public.organizations set name = 'Menuiserie Test' where id = $1", [id]);
    return id;
  }

  it("brouillon → corrections → émission → partage → décision → facture → paiement → reçu", async () => {
    const orgId = await org();
    const draft = await docs.createDraft(orgId, "quote", [
      { label: "Porte isoplane", quantity: "2", unit: "unit", unitPriceMinor: null, toConfirm: ["unit_price"], source: "read" },
      { label: "Pose", quantity: "1", unit: "lump_sum", unitPriceMinor: "10000", source: "read" },
    ]);
    expect((await docs.get(orgId, draft)).blockers).toContain("missing_price");
    expect(await docs.currentDraft(orgId)).toBe(draft);

    await docs.patchLine(orgId, draft, 1, { unitPriceMinor: "45000" });
    await docs.setClient(orgId, draft, "École Les Palmiers", { phone: "+22890000009" });
    const issued = await docs.issue(orgId, draft);
    expect(issued.status).toBe("issued");
    expect(issued.number).toMatch(/^DEV-\d{4}-001$/);
    expect(issued.totalMinor).toBe("100000");
    expect(issued.lines[0]?.toConfirm).toEqual([]);
    expect(issued.client.name).toBe("École Les Palmiers");
    expect(await docs.findByNumber(orgId, issued.number!.toLowerCase())).toBe(draft);

    const { token } = await docs.share(orgId, draft);
    const pub = await docs.publicDocument(token);
    expect(pub.id).toBe(draft);
    const decided = await docs.clientDecision(token, "accepted", null);
    expect(decided.status).toBe("accepted");

    const invoice = await docs.convert(orgId, draft);
    const inv = await docs.issue(orgId, invoice);
    expect(inv.number).toMatch(/^FAC-/);
    expect(inv.sourceNumber).toBe(issued.number);

    const payment = await docs.recordPayment(orgId, invoice, "100000", null, "Espèces");
    const receipt = await docs.issueReceipt(orgId, payment);
    const rec = await docs.get(orgId, receipt);
    expect(rec.type).toBe("receipt");
    expect(rec.totalMinor).toBe("100000");
    expect((await docs.get(orgId, invoice)).status).toBe("paid");

    const list = await docs.list(orgId);
    expect(list.total).toBe(3);
    const ent = await docs.entitlement(orgId);
    expect(ent).toMatchObject({ kind: "trial", used: 2, remaining: 1 });
  });

  it("une autre organisation ne voit pas le document", async () => {
    const a = await org();
    const b = await org();
    const doc = await docs.createDraft(a, "invoice", [{ label: "X", quantity: "1", unit: null, unitPriceMinor: "1" }]);
    await expect(docs.get(b, doc)).rejects.toMatchObject({ status: 404 });
    await expect(docs.issue(b, doc)).rejects.toMatchObject({ status: 404 });
  });
});
