import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { palette, contrast } from "../src/render/colors.js";
import { renderModel } from "../src/render/model.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { CASES } from "./render/fixtures.js";

// Rend chaque cas difficile dans chaque modèle. Les images sont écrites dans
// test/__output__/render pour la relecture visuelle (ignorées par git).
const OUT = path.resolve("test/__output__/render");
const renderer = new DocumentRenderer();

describe("couleurs", () => {
  it("une couleur claire reste en fond, texte lisible dessus, accent assombri", () => {
    const p = palette("#F4D35E");
    expect(p.brand).toBe("#F4D35E");
    expect(contrast(p.accent, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.brand, p.onBrand)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("rendu Typst", () => {
  mkdirSync(OUT, { recursive: true });

  for (const [name, doc] of Object.entries(CASES)) {
    const templates = name === "devis_simple" ? ["classic", "modern", "clean"] : [doc.template];
    for (const template of templates) {
      it(`${name} · ${template}`, async () => {
        const model = renderModel({ ...doc, template }, { hasLogo: false, hasQr: true });
        const out = await renderer.render({ model, qrUrl: "https://firmo.example/d/abc123" });
        expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(out.png.subarray(1, 4).toString()).toBe("PNG");
        expect(out.pages).toBeGreaterThanOrEqual(1);
        writeFileSync(path.join(OUT, `${name}-${template}.png`), out.png);
        writeFileSync(path.join(OUT, `${name}-${template}.pdf`), out.pdf);
        if (name === "soixante_lignes") expect(out.pages).toBeGreaterThan(1);
      }, 30_000);
    }
  }
});
