// Parcours réel dans le simulateur de la console : vente, émission, aperçu et PDF reçus.
import { chromium } from "playwright";
const [base, out, email] = process.argv.slice(2);
const login = await (await fetch(`${base}/v1/admin/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) })).json();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 }, locale: "fr-FR" })).newPage();
await page.goto(base, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => { localStorage.setItem("firmo.session.staff", s); localStorage.removeItem("firmo.simulator.conversation"); }, JSON.stringify({ token: login.token, expiresAt: login.expiresAt }));
await page.goto(`${base}/admin/simulateur`, { waitUntil: "networkidle" });
const say = async (text, wait) => {
  await page.getByPlaceholder(/Écrivez une vente/).fill(text);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(wait);
};
await say("Devis pour la Clinique Saint-Luc : 3 climatiseurs split à 285000, installation 45000 par appareil, et 20 mètres de goulotte à 2500", 30000);
await say("Électricité Komla", 4000);
await page.getByRole("button", { name: /Émettre/ }).last().click();
await page.waitForTimeout(4000);
await say("Électricité Komla", 20000);
await page.screenshot({ path: `${out}/sim-run.png`, fullPage: false });
const texts = await page.locator(".whitespace-pre-line").allInnerTexts();
console.log(texts.slice(-6).join("\n---\n"));
await browser.close();
