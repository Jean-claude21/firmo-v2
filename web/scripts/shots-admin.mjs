// Captures de la console : connexion (API), puis pages de /admin (téléphone et ordinateur).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const [base, out, email, ...pages] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const login = await (await fetch(`${base}/v1/admin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })).json();
const state = JSON.stringify({ token: login.token, expiresAt: login.expiresAt });
const browser = await chromium.launch();
for (const [label, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1366, height: 900 } })) {
  const context = await browser.newContext({ viewport, locale: "fr-FR" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("firmo.session.staff", s), state);
  for (const spec of pages) {
    const [path, name] = spec.split("=");
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${name}-${label}${overflow ? " ⚠ débordement" : ""}${errors.length ? " ⚠ " + errors.join(" | ") : ""}`);
  }
  await context.close();
}
await browser.close();
