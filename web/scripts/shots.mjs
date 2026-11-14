// Captures des pages pour la relecture visuelle (docs/design). Usage :
//   node scripts/shots.mjs <url de base> <dossier> <chemin>[=nom] ...
// Chaque page est capturée en téléphone (390 px) et en ordinateur (1366 px).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const [base, out, ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const sizes = { mobile: { width: 390, height: 844 }, desktop: { width: 1366, height: 900 } };
for (const spec of pages) {
  const [path, name = path.replace(/[^a-z0-9]+/gi, "_") || "home"] = spec.split("=");
  for (const [label, viewport] of Object.entries(sizes)) {
    const context = await browser.newContext({ viewport, locale: "fr-FR", deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(new URL(path, base).href, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${name}-${label}${overflow ? " ⚠ débordement horizontal" : ""}${errors.length ? ` ⚠ erreurs : ${errors.join(" | ")}` : ""}`);
    await context.close();
  }
}
await browser.close();
