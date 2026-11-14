import { describe, expect, it } from "vitest";
import { amountFromUser, guardLines } from "../src/ai/guard.js";

// Lectures réelles renvoyées par l'IA lors des essais (spec 004).
describe("valeurs dites autrement", () => {
  it.each([
    ["35000 chacune", 35000n],
    ["environ 15 000 F", 15000n],
    ["quinze mille", 15000n],
    ["450 mille", 450000n],
    ["entre 10000 et 12000", null],
  ])("« %s »", (text, expected) => {
    expect(amountFromUser(text, 0)).toBe(expected);
  });

  it("vente réelle : trois lignes complètes", () => {
    const text =
      "Bonsoir, fais-moi un devis pour l'Hôtel du Lac : portail coulissant en tube carré 450 mille, 4 grilles de fenêtre à 35000 chacune, et la pose quinze mille";
    const r = guardLines(
      [
        { label: "Portail coulissant en tube carré", quantityText: null, unit: null, unitPriceText: "450 mille", lineTotalText: null },
        { label: "Grilles de fenêtre", quantityText: "4", unit: "unit", unitPriceText: "35000 chacune", lineTotalText: null },
        { label: "Pose", quantityText: null, unit: null, unitPriceText: "quinze mille", lineTotalText: null },
      ],
      text,
      0,
      new Set(["unit", "lump_sum"]),
    );
    expect(r.lines.map((l) => [l.quantity, l.unitPriceMinor])).toEqual([
      ["1", "450000"],
      ["4", "35000"],
      ["1", "15000"],
    ]);
  });
});
