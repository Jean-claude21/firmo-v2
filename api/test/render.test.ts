import { describe, expect, it } from "vitest";
import { contrast, readableOnWhite } from "../src/render/colors.js";
import { monogram, percentText } from "../src/render/model.js";
import { formatDate } from "../src/voix/document.js";

// Règles du rendu sans base. Les rendus complets (dix cas v1) sont dans v1-cases.db.test.ts.

describe("rendu", () => {
  it("monogramme : initiales des deux premiers mots", () => {
    expect(monogram("ATELIER KODJO")).toBe("AK");
    expect(monogram("Établissements Bâtir")).toBe("ÉB");
    expect(monogram("Solvia")).toBe("SO");
    expect(monogram("")).toBe("");
  });

  it("pourcentages lisibles, au-delà de 100 % compris", () => {
    expect(percentText(2500, ",")).toBe("25");
    expect(percentText(1250, ",")).toBe("12,5");
    expect(percentText(15000, ",")).toBe("150");
  });

  it("date du document au format validé 08.08.2026", () => {
    expect(formatDate("2026-08-08", "fr")).toBe("08.08.2026");
  });

  it("une couleur trop claire est assombrie en silence jusqu'au contraste AA", () => {
    for (const color of ["#F4D35E", "#FFFFFF", "#9BE7FF", "#A8391F"]) {
      expect(contrast(readableOnWhite(color), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    }
    expect(readableOnWhite("#A8391F")).toBe("#A8391F");
  });
});
