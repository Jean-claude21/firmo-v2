import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type AdjustmentInput, type DraftContent, pgDocumentStore } from "../src/documents/store.js";
import { renderModel } from "../src/render/model.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

// Les dix cas de référence de la v1 (PARITE_V1 P-18, P-27) rejoués de bout en bout sur la vraie
// base : création, émission, totaux exacts attendus par la v1, rendu PDF + PNG relus à l'œil
// (test/__output__/cases, ignoré par git).

const CASES_DIR = path.resolve("test/fixtures/v1-cases");
const OUT = path.resolve("test/__output__/cases");
const TYPES: Record<string, string> = { DEVIS: "quote", "FACTURE PROFORMA": "proforma", FACTURE: "invoice" };

interface V1Line { label: string; description?: string; quantity?: number; unit?: string; unit_price?: number; flat_amount?: number }
interface V1Case {
  id: string;
  type: string;
  issuer: { name: string; trade?: string; color?: string; phone?: string; email?: string; tax_id?: string; rccm?: string };
  client?: { name: string; address?: string; phone?: string; tax_id?: string };
  object?: string;
  summary?: string;
  site?: string;
  delivery?: string;
  validity_days?: number;
  deposit_percent?: number;
  tax_rate?: number;
  sections: Array<{ title?: string; show_subtotal?: boolean; lines: V1Line[] }>;
  adjustments?: Array<{ label: string; mode: "percent" | "fixed"; value: number; base?: string }>;
  payments?: Array<{ amount: number; method?: string }>;
  conditions?: string[];
  origin?: { number: string };
  expected: Record<string, number>;
}

function content(c: V1Case): DraftContent {
  return {
    title: c.object ?? null,
    summary: c.summary ?? null,
    site: c.site ?? null,
    delivery_text: c.delivery ?? null,
    validity_days: c.validity_days ?? null,
    deposit_bp: c.deposit_percent ? Math.round(c.deposit_percent * 100) : null,
    sections: c.sections.map((s) => ({
      title: s.title ?? null,
      showSubtotal: s.show_subtotal ?? false,
      lines: s.lines.map((l) => ({
        label: l.label,
        description: l.description ?? null,
        kind: l.flat_amount !== undefined ? ("flat" as const) : ("priced" as const),
        quantity: l.quantity !== undefined ? String(l.quantity) : null,
        unit: l.unit ?? null,
        unitPriceMinor: l.unit_price !== undefined ? String(l.unit_price) : null,
        flatAmountMinor: l.flat_amount !== undefined ? String(l.flat_amount) : null,
      })),
    })),
    adjustments: (c.adjustments ?? []).map((a): AdjustmentInput => ({
      label: a.label,
      mode: a.mode === "percent" ? "percent" : "amount",
      sign: a.value < 0 ? -1 : 1,
      base: (a.base ?? "items_total") as AdjustmentInput["base"],
      rateBp: a.mode === "percent" ? Math.round(Math.abs(a.value) * 100) : null,
      valueMinor: a.mode === "fixed" ? String(Math.abs(a.value)) : null,
    })),
    clauses: (c.conditions ?? []).map((body) => ({ body })),
  };
}

describe.skipIf(!hasDatabase)("dix cas de référence v1", () => {
  const pool = testPool();
  const documents = pgDocumentStore(pool, { shareSecret: "secret-de-partage-pour-les-tests-1234" });
  const renderer = new DocumentRenderer();
  afterAll(() => pool.end());
  mkdirSync(OUT, { recursive: true });

  const files = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();

  it("le corpus contient exactement dix cas", () => {
    expect(files).toHaveLength(10);
  });

  for (const file of files) {
    const c = JSON.parse(readFileSync(path.join(CASES_DIR, file), "utf8")) as V1Case;
    it(`${c.id} : totaux exacts, émission, rendu`, async () => {
      const r = await pool.query<{ org_id: string }>(
        "select org_id from app.ensure_identity('simulator', $1, null, '+22890000000', null)",
        [uid(c.id)],
      );
      const orgId = r.rows[0]!.org_id;
      const legal: Record<string, string> = {};
      if (c.issuer.rccm) legal.rccm = c.issuer.rccm;
      if (c.issuer.tax_id) legal.nif = c.issuer.tax_id;
      await pool.query("select app.update_profile($1, $2::jsonb)", [orgId, JSON.stringify({
        name: c.issuer.name, trade_label: c.issuer.trade ?? null, phone: c.issuer.phone ?? null, email: c.issuer.email ?? null,
        brand_color: c.issuer.color ?? null, legal_ids: legal, tax_registered: c.tax_rate !== undefined,
      })]);

      const type = TYPES[c.type]!;
      let id: string;
      if (c.origin) {
        // Conversion (cas 08) : le devis d'origine est émis puis converti, sans ressaisie.
        const quote = await documents.createDraftContent(orgId, "quote", content(c), "web");
        await documents.issue(orgId, quote);
        id = await documents.convert(orgId, quote, type);
        await documents.setDocumentClauses(orgId, id, (c.conditions ?? []).map((body) => ({ body })));
      } else {
        id = await documents.createDraftContent(orgId, type, content(c), "web");
      }
      if (c.client) {
        await documents.setClient(orgId, id, c.client.name, { address: c.client.address ?? null, phone: c.client.phone ?? null, legal_id: c.client.tax_id ?? null });
      }
      const draft = await documents.get(orgId, id);
      expect(draft.blockers).toEqual([]);
      const doc = await documents.issue(orgId, id);
      for (const p of c.payments ?? []) await documents.recordPayment(orgId, id, String(p.amount), null, p.method ?? null);
      const final = await documents.get(orgId, id);

      const e = c.expected;
      const observed: Record<string, string | null> = {
        items_total: final.subtotalMinor,
        adjustments_total: final.adjustmentsTotalMinor,
        total_before_tax: final.taxableMinor,
        tax_amount: final.taxMinor,
        grand_total: final.totalMinor,
        deposit: final.depositMinor,
        paid_total: final.paidMinor,
        balance: final.depositMinor !== null
          ? String(BigInt(final.totalMinor) - BigInt(final.depositMinor))
          : String(BigInt(final.totalMinor) - BigInt(final.paidMinor)),
      };
      for (const [field, value] of Object.entries(e)) {
        if (field === "min_pages") continue;
        expect(observed[field], `${c.id} · ${field}`).toBe(String(value));
      }
      expect(doc.number).toBeTruthy();
      if (c.origin) expect(final.sourceNumber).toBeTruthy();

      const out = await renderer.render({ model: renderModel(final, { hasLogo: false, hasQr: true }), qrUrl: "https://firmo.test/d/exemple" });
      expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
      if (e.min_pages) expect(out.pages).toBeGreaterThanOrEqual(e.min_pages);
      writeFileSync(path.join(OUT, `${c.id}.png`), out.png);
      writeFileSync(path.join(OUT, `${c.id}.pdf`), out.pdf);
      writeFileSync(path.join(OUT, `${c.id}.svg`), out.svg);

      // Aperçu du brouillon (P-25) : filigrane, sans numéro.
      if (c.id === "01-minimal") {
        const copy = await documents.duplicate(orgId, id);
        const draftModel = renderModel(await documents.get(orgId, copy), { hasLogo: false, hasQr: false });
        expect(draftModel.draft).toBe(true);
        expect(draftModel.number).toBe(draftModel.labels.draft_mark);
        const preview = await renderer.render({ model: draftModel });
        writeFileSync(path.join(OUT, "01-minimal-brouillon.png"), preview.png);
        expect(preview.pages).toBe(1);
      }
    }, 60_000);
  }
});
