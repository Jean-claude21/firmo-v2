// Exploration : une vente réelle par le simulateur, puis chaque écran de l'espace artisan.
import { browser, check, conversation, linkIn, portalPage, shot, staffLogin, summary } from "./lib.mjs";

const staff = await staffLogin();
const c = conversation(staff.token);
console.log(`conversation ${c.id}`);
let out = await c.send("Devis pour la Clinique Saint-Luc : 3 climatiseurs split à 285000, installation 45000 par appareil, et 20 mètres de goulotte à 2500");
console.log(out.map((m) => `${m.kind}: ${m.text ?? ""}`).join("\n---\n"));
out = await c.send("OK");
console.log(out.map((m) => `${m.kind}: ${m.text ?? ""}`).join("\n---\n"));
out = await c.send("Électricité Komla");
console.log(out.map((m) => `${m.kind}: ${m.text ?? ""}`).join("\n---\n"));
out = await c.send("OK");
console.log(out.map((m) => `${m.kind}: ${m.text ?? ""}`).join("\n---\n"));
out = await c.send("documents");
console.log(out.map((m) => `${m.kind}: ${m.text ?? ""}`).join("\n---\n"));
const link = linkIn(out.map((m) => m.text));
check(Boolean(link), "lien d'accès reçu dans le chat");
if (link) {
  const b = await browser();
  const { page, errors } = await portalPage(b, link);
  for (const [path, name] of [["/app", "home"], ["/app/documents", "documents"], ["/app/profil", "profil"], ["/app/clients", "clients"], ["/app/abonnement", "abonnement"]]) {
    await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    await shot(page, `explore-${name}`);
  }
  check(errors.length === 0, "aucune erreur dans la console", errors.join(" | "));
  await b.close();
}
process.exit(summary() ? 1 : 0);
