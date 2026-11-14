import { describe, expect, it } from "vitest";
import { majorText, money, quantity } from "../src/lib/format";
import { en } from "../src/l10n/en";
import { fr } from "../src/l10n/fr";

const XOF = { code: "XOF", minorUnits: 0, symbol: "F CFA", symbolBefore: false, thousandsSeparator: " ", decimalSeparator: "," };
const USD = { code: "USD", minorUnits: 2, symbol: "$", symbolBefore: true, thousandsSeparator: ",", decimalSeparator: "." };

describe("affichage des montants", () => {
  it("formate selon la devise reçue de l'API", () => {
    expect(money("620000", XOF)).toBe("620 000\u00a0F CFA");
    expect(money("125050", USD)).toBe("$1,250.50");
  });
  it("prépare un champ éditable sans perte", () => {
    expect(majorText("125050", USD)).toBe("1250.5");
    expect(majorText("15000", XOF)).toBe("15000");
    expect(quantity("1.500")).toBe("1,5");
  });
});

/** Toutes les clés françaises existent en anglais (aucun texte manquant). */
function keys(o: unknown, prefix = ""): string[] {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return [prefix];
  return Object.entries(o).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("textes", () => {
  it("le français et l'anglais ont les mêmes clés", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });
});
