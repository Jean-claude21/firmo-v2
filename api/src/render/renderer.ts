import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeCompiler } from "@myriaddreamin/typst-ts-node-compiler";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import type { RenderModel } from "./model.js";

// Rendu Typst (décision 0004) : un gabarit, trois sorties. PDF pour l'envoi, SVG pour l'aperçu
// web, PNG de la première page pour l'aperçu dans le chat.

const TEMPLATES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../templates");
const A4 = { width: 595.28, height: 841.89 };

export interface RenderInput {
  model: RenderModel;
  logo?: { bytes: Buffer } | null;
  qrUrl?: string | null;
}

export interface RenderOutput {
  pdf: Buffer;
  svg: string;
  png: Buffer;
  pages: number;
  sha256: string;
  durationMs: number;
}

export class DocumentRenderer {
  private readonly compiler: NodeCompiler;
  private readonly source: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly templatesDir = TEMPLATES) {
    this.compiler = NodeCompiler.create({
      workspace: templatesDir,
      fontArgs: [{ fontPaths: [path.join(templatesDir, "fonts")] }],
    });
    this.source = readFileSync(path.join(templatesDir, "document.typ"), "utf8");
  }

  /** Les rendus passent un par un : le compilateur garde un état (fichiers virtuels). */
  render(input: RenderInput): Promise<RenderOutput> {
    const run = this.queue.then(() => this.renderNow(input));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async renderNow(input: RenderInput): Promise<RenderOutput> {
    const started = Date.now();
    this.compiler.resetShadow();
    if (input.logo) this.compiler.mapShadow(path.join(this.templatesDir, "assets", "logo.png"), input.logo.bytes);
    if (input.qrUrl) {
      const qr = await QRCode.toString(input.qrUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
      this.compiler.mapShadow(path.join(this.templatesDir, "assets", "qr.svg"), Buffer.from(qr));
    }
    const args = { mainFileContent: this.source, inputs: { data: JSON.stringify(input.model) } };
    const compiled = this.compiler.compile(args);
    const error = compiled.takeError();
    if (error || !compiled.result) {
      const diagnostics = error ? this.compiler.fetchDiagnostics(error) : [];
      throw new Error(`rendu Typst en échec : ${JSON.stringify(diagnostics).slice(0, 1500)}`);
    }
    const doc = compiled.result;
    const pdf = this.compiler.pdf(doc);
    // SVG simple : sans variables CSS, lisible par resvg et par les navigateurs.
    const svg = this.compiler.plainSvg(doc);
    const pages = doc.numOfPages;
    const png = firstPagePng(svg);
    return {
      pdf,
      svg,
      png,
      pages,
      sha256: createHash("sha256").update(pdf).digest("hex"),
      durationMs: Date.now() - started,
    };
  }
}

/** PNG de la première page : on restreint la zone visible du SVG à une page A4. */
export function firstPagePng(svg: string, width = 1240): Buffer {
  const firstPage = svg.replace(/<svg\b[^>]*>/, (tag) =>
    tag
      .replace(/\sviewBox="[^"]*"/, "")
      .replace(/\swidth="[^"]*"/, "")
      .replace(/\sheight="[^"]*"/, "")
      .replace(/<svg\b/, `<svg viewBox="0 0 ${A4.width} ${A4.height}" width="${A4.width}" height="${A4.height}"`),
  );
  const resvg = new Resvg(firstPage, {
    fitTo: { mode: "width", value: width },
    background: "#FFFFFF",
    font: { loadSystemFonts: false },
  });
  return Buffer.from(resvg.render().asPng());
}
