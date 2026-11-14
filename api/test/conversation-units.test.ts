import { describe, expect, it } from "vitest";
import { guardLines, numbersIn } from "../src/ai/guard.js";
import { readSimple } from "../src/ai/rules.js";
import { parseCommand } from "../src/conversation/commands.js";

const UNITS = new Set(["unit", "lump_sum", "m2", "bag", "day"]);

describe("commandes", () => {
  it.each([
    ["OK", { type: "issue" }],
    ["c'est bon !", { type: "issue" }],
    ["Annuler", { type: "cancel" }],
    ["mes documents", { type: "list" }],
    ["Réglages", { type: "settings" }],
    ["ligne 2 prix 15 000", { type: "set_price", line: 2, value: "15 000" }],
    ["l3 qté 4", { type: "set_quantity", line: 3, value: "4" }],
    ["line 1 label Steel door", { type: "set_label", line: 1, value: "Steel door" }],
    ["enlève la 3", { type: "remove", line: 3 }],
    ["client Hôtel du Lac", { type: "client", name: "Hôtel du Lac" }],
    ["remise 10%", { type: "discount", value: "10%" }],
    ["sans TVA", { type: "tax", enabled: false }],
    ["facture", { type: "invoice", number: null }],
    ["facture DEV-2026-0003", { type: "invoice", number: "DEV-2026-0003" }],
    ["payé 50 000 par Mobile Money", { type: "payment", amount: "50 000", number: null, method: "Mobile Money" }],
    ["acompte 20000 FAC-2026-0001", { type: "payment", amount: "20000", number: "FAC-2026-0001", method: null }],
    ["reçu", { type: "receipt" }],
    ["accepté DEV-2026-0002", { type: "decision", accepted: true, number: "DEV-2026-0002" }],
    ["modèle moderne", { type: "template", template: "modern" }],
    ["cmd:issue", { type: "issue" }],
  ])("« %s »", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it("une vente n'est pas une commande", () => {
    expect(parseCommand("2 portes à 45000 et la pose 10000")).toBeNull();
  });
});

describe("garde anti-invention", () => {
  it("relève les nombres en chiffres et en lettres", () => {
    const found = numbersIn("2 portes à 45 000, pose quinze mille, 1,5 m2");
    expect(found.has("45000")).toBe(true);
    expect(found.has("15000")).toBe(true);
    expect(found.has("q:1.5")).toBe(true);
  });

  it("refuse un prix absent de la source", () => {
    const r = guardLines(
      [{ label: "Porte", quantityText: "2", unit: "unit", unitPriceText: "50000", lineTotalText: null }],
      "2 portes à 45000",
      0,
      UNITS,
    );
    expect(r.lines[0]?.unitPriceMinor).toBeNull();
    expect(r.rejected).toBe(1);
  });

  it("montant seul : forfait de 1", () => {
    const r = guardLines([{ label: "Pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "60 000" }], "pose 60 000", 0, UNITS);
    expect(r.lines[0]).toMatchObject({ quantity: "1", unit: "lump_sum", unitPriceMinor: "60000" });
  });

  it("total + quantité : prix unitaire seulement si la division tombe juste, à confirmer", () => {
    const ok = guardLines([{ label: "Porte", quantityText: "3", unit: "unit", unitPriceText: null, lineTotalText: "150000" }], "3 portes pour 150000", 0, UNITS);
    expect(ok.lines[0]).toMatchObject({ unitPriceMinor: "50000", toConfirm: ["unit_price"] });
    const no = guardLines([{ label: "Porte", quantityText: "3", unit: "unit", unitPriceText: null, lineTotalText: "100000" }], "3 portes pour 100000", 0, UNITS);
    expect(no.lines[0]?.unitPriceMinor).toBeNull();
  });

  it("photo : valeurs lues marquées à confirmer", () => {
    const r = guardLines([{ label: "Tôle", quantityText: "4", unit: "unit", unitPriceText: "7500", lineTotalText: null }], null, 0, UNITS);
    expect([...(r.lines[0]?.toConfirm ?? [])].sort()).toEqual(["quantity", "unit_price"]);
  });
});

describe("lecture simplifiée (sans IA)", () => {
  it("lit une vente écrite simplement", () => {
    const r = readSimple("2 portes à 45 000\n3 sacs de ciment x 5000, pose 10000");
    expect(r.lines).toEqual([
      { label: "portes", quantityText: "2", unit: "unit", unitPriceText: "45 000", lineTotalText: null },
      { label: "ciment", quantityText: "3", unit: "bag", unitPriceText: "5000", lineTotalText: null },
      { label: "pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "10000" },
    ]);
  });
});
