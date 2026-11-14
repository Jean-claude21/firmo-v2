// Captures de l'espace artisan : échange d'un lien d'accès, puis pages de /app.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const [base, out, token, ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [label, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1366, height: 900 } })) {
  const context = await browser.newContext({ viewport, locale: "fr-FR" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  if (label === "mobile") {
    await page.goto(`${base}/acces/${token}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => localStorage.getItem("firmo.session.org"));
    globalThis.saved = state;
  } else {
    await page.goto(base, { waitUntil: "domcontentloaded" });
    await page.evaluate((s) => localStorage.setItem("firmo.session.org", s), globalThis.saved);
  }
  for (const spec of pages) {
    const [path, name] = spec.split("=");
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${name}-${label}${overflow ? " ⚠ débordement" : ""}${errors.length ? " ⚠ " + errors.join(" | ") : ""}`);
  }
  await context.close();
}
await browser.close();
