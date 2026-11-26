// Landing (P-61) : sections de la référence v1, images réelles chargées, prix réel, pas de débordement.
import { BASE, browser, check, shot, summary } from "./lib.mjs";

const b = await browser();
for (const [label, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const page = await (await b.newContext({ viewport, locale: "fr-FR" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: "networkidle" });
  for (let y = 0; y < 12000; y += 700) { await page.mouse.wheel(0, 700); await page.waitForTimeout(120); }
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  check(await page.getByRole("heading", { level: 1 }).innerText().then((t) => /Tu parles\.\s*Firmo rédige\./.test(t)), `${label} accroche`);
  for (const h of ["Tu as déjà écrit ? Photographie.", "Ça vit dans ta messagerie", "Ce qui se passe vraiment", "C'est ton document, pas le nôtre", "Ton espace, quand tu en as besoin", "Ce qu'on ne fera jamais", "Le prix", "Dis ta première vente"]) {
    check(await page.getByRole("heading", { name: h }).isVisible(), `${label} section « ${h} »`);
  }
  const broken = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && !i.classList.contains("hidden")).map((i) => i.src));
  check(broken.length === 0, `${label} toutes les images chargent`, broken.join(", "));
  check(await page.getByText(/2 000/).first().isVisible() && await page.getByText(/15 documents finaux par période/).isVisible(), `${label} prix réel de l'offre`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, `${label} pas de débordement horizontal`);
  await page.getByRole("radio", { name: "Couleur #1F6F43" }).click();
  check(await page.locator(`img[src="/landing/doc-1f6f43.webp"]`).waitFor({ timeout: 5000 }).then(() => true, () => false), `${label} le choix de couleur montre le vrai rendu`);
  check(errors.length === 0, `${label} aucune erreur`, errors.join(" | "));
  await shot(page, `landing-${label}`);
}
await b.close();
process.exit(summary() ? 1 : 0);
