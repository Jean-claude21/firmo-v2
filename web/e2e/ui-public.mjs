// Pages publiques (P-66, P-67) : chaque page s'ouvre, sans erreur, sur mobile et grand écran.
import { BASE, browser, check, shot, summary } from "./lib.mjs";

const b = await browser();
for (const [label, viewport] of Object.entries({ mobile: { width: 390, height: 844 }, desktop: { width: 1366, height: 900 } })) {
  const ctx = await b.newContext({ viewport, locale: "fr-FR" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const [path, heading] of [["/confidentialite", "Confidentialité"], ["/conditions", "Conditions d'utilisation et de vente"], ["/suppression-donnees", "Suppression des données"], ["/contact", "Contact et assistance"], ["/formats", "Voici ce que Firmo produit."]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(path === "/formats" ? 2500 : 600);
    check(await page.getByRole("heading", { level: 1, name: heading }).isVisible(), `${label} ${path} : titre`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(!overflow, `${label} ${path} : pas de débordement horizontal`);
    await shot(page, `pub-${label}${path.replace(/\//g, "-")}`);
  }
  // Conditions : valeurs réelles de l'offre.
  await page.goto(`${BASE}/conditions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check(await page.getByText(/pour 15 documents finaux par période de 30 jours/).isVisible(), `${label} conditions : offre réelle affichée`);
  check(await page.getByText(/3 jours de grâce/).isVisible(), `${label} conditions : grâce réelle affichée`);
  // Formats : retirer une option change le rendu.
  await page.goto(`${BASE}/formats`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const before = await page.locator("main img").first().getAttribute("src");
  await page.getByRole("checkbox", { name: /Remise/ }).uncheck();
  await page.waitForTimeout(2500);
  const after = await page.locator("main img").first().getAttribute("src");
  check(before !== after && /options=/.test(after ?? "") && !/discount/.test(after ?? ""), `${label} formats : retirer la remise recompose le document`);
  check(errors.length === 0, `${label} : aucune erreur`, errors.join(" | "));
  await ctx.close();
}
await b.close();
process.exit(summary() ? 1 : 0);
