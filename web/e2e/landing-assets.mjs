// Captures réelles pour la landing (P-61) : un compte de démonstration (fictif, présenté comme tel)
// passe par le vrai chat, le vrai rendu et le vrai espace. Les fichiers vont dans web/public/landing.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { api, BASE, browser, conversation, linkIn, sleep, staffLogin } from "./lib.mjs";

const DEST = fileURLToPath(new URL("../public/landing/", import.meta.url));
const staff = await staffLogin();
const c = conversation(staff.token, `landing-${Date.now().toString(36)}`, "+22890778899");

// 1. La conversation, telle que Firmo répond (lecture simplifiée : le format reste celui du produit).
const sale = "Devis pour la mairie : 45 barres tube 80x40 à 17000, 8 cornières 50x5 à 14000, 2 boîtes peinture alu à 12000, 10 litres diluant à 1200, 60 chevilles à 500";
const transcript = [{ from: "me", text: sale }];
let out = await c.send(sale);
for (const m of out) if (m.kind === "text" && !/^Tes prix restent|^Envoie-moi une vente/.test(m.text)) transcript.push({ from: "firmo", text: m.text });

const link = linkIn((await c.send("espace")).map((m) => m.text));
const T = (await api("/v1/portal/session", { body: { token: link.split("/acces/")[1] } })).token;
await api("/v1/portal/profile", { token: T, method: "PATCH", body: { name: "Atelier Kodjo", tradeLabel: "Chaudronnerie · Soudure", brandColor: "#A8391F" } });

// 2. Le devis de la feuille manuscrite, émis par les vraies règles.
const quote = await api("/v1/portal/documents", { token: T, body: {
  type: "quote", title: "Supports pour 60 modules", summary: "Fourniture et main-d'œuvre comprises, garantie 24 mois.",
  client: { name: "Services techniques de la mairie" }, deliveryText: "30 jours", validityDays: 30, warrantyText: "24 mois",
  sections: [{ title: "Fournitures", showSubtotal: true, lines: [
    { label: "Barre tube rectangulaire 80 × 40", quantity: "45", unit: "barre", unitPrice: "17000" },
    { label: "Barre fer cornière 50 × 5", quantity: "8", unit: "barre", unitPrice: "14000" },
    { label: "Boîte de peinture aluminium", quantity: "2", unit: "boîte", unitPrice: "12000" },
    { label: "Diluant", quantity: "10", unit: "litre", unitPrice: "1200" },
    { label: "Cheville métallique", quantity: "60", unit: "pièce", unitPrice: "500" },
  ] }],
  adjustments: [{ label: "Main-d'œuvre", mode: "amount", value: "160000" }],
} });
await api(`/v1/portal/documents/${quote.id}/issue`, { token: T, body: {} });
let doc = await api(`/v1/portal/documents/${quote.id}`, { token: T });
for (let i = 0; i < 30 && !doc.rendered; i++) {
  await sleep(1000);
  doc = await api(`/v1/portal/documents/${quote.id}`, { token: T });
}
// Couleurs : rendu du document émis (sans filigrane) avec la couleur essayée, rien enregistré.
for (const color of ["#A8391F", "#1F6F43", "#2C5A8C", "#6B3FA0", "#15171A"]) {
  const res = await api("/v1/portal/presentation/preview", { token: T, body: { brandColor: color }, raw: true });
  writeFileSync(`${DEST}doc-${color.slice(1).toLowerCase()}.png`, Buffer.from(await res.arrayBuffer()));
}
writeFileSync(`${DEST}doc-final.png`, Buffer.from(await (await api(`/v1/portal/documents/${quote.id}/file.png`, { token: T, raw: true })).arrayBuffer()));
writeFileSync(`${DEST}firmo-exemple-devis.pdf`, Buffer.from(await (await api(`/v1/portal/documents/${quote.id}/file.pdf`, { token: T, raw: true })).arrayBuffer()));
transcript.push({ from: "me", text: "OK" });
transcript.push({ from: "firmo", text: `Je prépare le PDF final du devis.`, file: `${doc.number}.pdf` });

// 3. Un brouillon long, pour l'éditeur.
const draft = await api("/v1/portal/documents", { token: T, body: {
  type: "quote", title: "Portail et garde-corps de l'école", client: { name: "École Les Palmiers" },
  sections: [
    { title: "Portail", showSubtotal: true, lines: [
      { label: "Tube rectangulaire 60 × 40", quantity: "24", unit: "barre", unitPrice: "15500" },
      { label: "Tôle noire 15/10", quantity: "6", unit: "feuille", unitPrice: "32000" },
      { label: "Paumelle renforcée", quantity: "4", unit: "pièce", unitPrice: "6500" },
    ] },
    { title: "Garde-corps", showSubtotal: true, lines: [
      { label: "Tube carré 40 × 40", quantity: "18", unit: "barre", unitPrice: "11000" },
      { label: "Main courante", quantity: "22", unit: "m", unitPrice: "4500" },
    ] },
    { title: "Pose", showSubtotal: true, lines: [{ label: "Pose et soudure sur place", kind: "flat", flatAmount: "180000" }] },
  ],
} });
const share = await api(`/v1/portal/documents/${quote.id}/share`, { token: T, body: {} });

// 4. Captures d'écran (téléphone, haute densité).
const b = await browser();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "fr-FR" });
const page = await ctx.newPage();
await page.goto(link.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
await page.waitForURL(/\/app/);
const snap = async (path, name, wait = 1500) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${DEST}${name}.png`, fullPage: false });
};
await snap("/app", "espace-accueil");
await snap(`/app/documents/${draft.id}`, "espace-editeur");
await snap("/app/profil", "espace-presentation", 3500);
await page.goto(share.url.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${DEST}page-client.png`, fullPage: false });
await b.close();

writeFileSync(fileURLToPath(new URL("../src/l10n/landing-chat.json", import.meta.url)), JSON.stringify(transcript, null, 2));
console.log(JSON.stringify(transcript, null, 2));
