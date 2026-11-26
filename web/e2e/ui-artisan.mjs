// Parcours de l'espace artisan dans un vrai navigateur (P-62 à P-65, P-68, P-69) : tout ce qu'un
import { fileURLToPath } from "node:url";
// artisan fait au doigt, vérifié dans l'interface et dans le PDF produit.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { api, BASE, browser, check, conversation, linkIn, OUT, portalPage, shot, sleep, staffLogin, summary } from "./lib.mjs";

const PY = process.env.PYTHON ?? "python";
const pdfcheck = (...args) => execFileSync(PY, ["-I", fileURLToPath(new URL("./pdfcheck.py", import.meta.url)), ...args], { encoding: "utf8" });

function pngLogo(size, [r, g, b]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const o = y * (size * 3 + 1) + 1 + x * 3;
    const inside = x > size * 0.15 && x < size * 0.85 && y > size * 0.15 && y < size * 0.85;
    raw[o] = inside ? r : 255; raw[o + 1] = inside ? g : 255; raw[o + 2] = inside ? b : 255;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const staff = await staffLogin();
const c = conversation(staff.token, undefined, "+22890445566");
await c.send("espace");
const out = await c.send("espace");
const link = linkIn(out.map((m) => m.text));
check(Boolean(link), "lien d'accès reçu");

const b = await browser();
const { page, errors } = await portalPage(b, link);
const T = await page.evaluate(() => JSON.parse(localStorage.getItem("firmo.session.org") ?? "{}").token);
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, async (e) => {
    await shot(page, "ui-FAIL").catch(() => undefined);
    console.error("ÉCHEC :", e?.message ?? e);
    summary();
    process.exit(1);
  });
}

// ---------------------------------------------------------------- accueil vide
console.log("\nAccueil (P-62)");
await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
await shot(page, "ui-01-home-empty");
check(await page.getByRole("heading", { name: "Vos documents" }).isVisible(), "titre « Vos documents »");
check(await page.getByText(/documents? disponibles?/).isVisible(), "bande « Ce mois » : documents disponibles");
check(await page.getByText("Aucun document pour l'instant").isVisible(), "état vide expliqué");

// ---------------------------------------------------------------- présentation
console.log("\nPrésentation (P-64)");
await page.goto(`${BASE}/app/profil`, { waitUntil: "networkidle" });
await page.getByLabel("Nom affiché").or(page.getByLabel("Nom de l'entreprise")).first().fill("Menuiserie Afi");
await page.getByLabel(/Métier/).fill("Menuiserie · Ébénisterie");
await page.getByLabel("#1F6F43").click();
const logoFile = `${OUT}logo-ui.png`;
writeFileSync(logoFile, pngLogo(300, [214, 0, 120]));
await page.locator('input[type="file"]').setInputFiles(logoFile);
await page.waitForTimeout(2500);
check(await page.locator('img[alt="Logo"]').isVisible(), "le logo importé s'affiche aussitôt");
await page.waitForTimeout(2500);
const previewSrc = await page.locator('img[alt^="Aperçu de votre document"]').getAttribute("src").catch(() => null);
check(Boolean(previewSrc), "aperçu en direct affiché");
if (previewSrc) {
  const bytes = await page.evaluate(async (src) => Array.from(new Uint8Array(await (await fetch(src)).arrayBuffer())), previewSrc);
  writeFileSync(`${OUT}ui-live.png`, Buffer.from(bytes));
  check(Number(pdfcheck("color", `${OUT}ui-live.png`, "#D60078", "30").trim()) > 50, "l'aperçu montre le logo importé");
  check(Number(pdfcheck("color", `${OUT}ui-live.png`, "#1F6F43", "20").trim()) > 20, "l'aperçu montre la couleur choisie (pas encore enregistrée)");
}
await page.getByRole("button", { name: /Informations professionnelles/ }).click();
const legal = page.locator("input.font-mono").filter({ hasNot: page.locator("[inputmode]") });
await page.getByLabel(/^Adresse/).fill("Quartier des artisans, Lot 7");
await shot(page, "ui-02-presentation");
await page.getByRole("button", { name: "Enregistrer ma présentation" }).click();
await page.waitForTimeout(1500);
const me = await api("/v1/portal/me", { token: T });
check(me.org.name === "Menuiserie Afi" && me.org.brandColor === "#1F6F43" && me.org.tradeLabel === "Menuiserie · Ébénisterie" && me.org.address?.startsWith("Quartier"), "présentation enregistrée", JSON.stringify({ n: me.org.name, c: me.org.brandColor, t: me.org.tradeLabel }));
check(me.org.hasLogo, "logo enregistré");
// Numérotation : préfixe changé, aperçu renvoyé par le serveur.
const prefix = page.getByLabel("Préfixe").first();
await prefix.fill("MA");
await prefix.blur();
await page.waitForTimeout(1200);
check(await page.getByText(/^MA-\d{4}-\d+$/).first().isVisible(), "format des numéros : aperçu mis à jour");
// Clause par défaut.
await page.getByRole("button", { name: /^Clauses/ }).click();
await page.getByLabel("Nouvelle clause").fill("Acompte de 40 % à la commande.");
await page.getByRole("button", { name: "Ajouter" }).last().click();
await page.waitForTimeout(1200);
check(await page.getByText("Acompte de 40 % à la commande.").isVisible(), "clause ajoutée");

// ---------------------------------------------------------------- nouveau document et éditeur
console.log("\nÉditeur (P-63)");
await page.goto(`${BASE}/app/documents/nouveau`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^DEV\s*Devis/ }).click();
await page.waitForURL(/\/app\/documents\/[0-9a-f-]{36}$/);
const docId = page.url().split("/").pop();
await page.getByLabel("Objet").fill("Portes du bloc administratif");
await page.getByRole("button", { name: "Ajouter une ligne" }).click();
await page.getByLabel("Désignation").fill("Porte isoplane 83 cm");
await page.getByLabel("Qté").fill("4");
await page.getByLabel("Unité").fill("porte");
await page.getByLabel(/Prix unitaire/).fill("45000");
await page.getByRole("button", { name: "Terminé" }).click();
await page.getByRole("button", { name: "Ajouter une ligne" }).click();
await page.getByLabel("Désignation").fill("Pose et quincaillerie");
await page.getByRole("radio", { name: "Forfait" }).click();
await page.getByLabel(/Montant/).fill("60000");
await page.getByRole("button", { name: "Terminé" }).click();
await page.getByRole("button", { name: "Ajouter un groupe" }).click();
await page.getByLabel("Désignation").fill("Peinture des cadres");
await page.getByLabel("Qté").fill("4");
await page.getByLabel(/Prix unitaire/).fill("7500");
await page.getByRole("button", { name: "Terminé" }).click();
await page.waitForTimeout(2500);
check(await page.getByText("Enregistré").first().isVisible(), "enregistrement automatique");
let doc = await api(`/v1/portal/documents/${docId}`, { token: T });
check(doc.lines.length === 3 && doc.sections.length === 2, "lignes et groupes enregistrés", `${doc.lines.length} lignes, ${doc.sections.length} groupes`);
check(doc.totalMinor === String(4 * 45000 + 60000 + 4 * 7500), "total calculé par le serveur", doc.totalMinor);
check(await page.getByText("270 000").first().isVisible(), "total affiché dans la bande Objet");
await shot(page, "ui-03-editor-detail");

await page.getByRole("tab", { name: "Conditions" }).click();
await page.getByLabel(/Nom du client/).fill("Collège Saint-Paul");
await page.getByLabel(/Lieu du chantier/).fill("Bâtiment A");
await page.getByLabel("Acompte (%)").fill("40");
await page.getByLabel(/Garantie/).fill("Garantie 12 mois");
check(await page.getByLabel(/Acompte de 40 % à la commande/).isChecked(), "la clause par défaut est cochée sur le nouveau document");
await page.waitForTimeout(2200);
await shot(page, "ui-04-editor-conditions");
await page.getByRole("tab", { name: "Totaux" }).click();
await page.getByRole("button", { name: "Ajouter un ajustement" }).click();
await page.getByPlaceholder(/Libellé/).fill("Remise");
await page.getByLabel("Sens").selectOption("-1");
await page.getByLabel("Valeur").fill("10");
await page.waitForTimeout(2500);
doc = await api(`/v1/portal/documents/${docId}`, { token: T });
check(doc.client.name === "Collège Saint-Paul" && doc.site === "Bâtiment A" && doc.depositBp === 4000 && doc.warrantyText === "Garantie 12 mois", "conditions enregistrées");
check(doc.totalMinor === String(270000 - 27000), "remise de 10 % calculée par le serveur", doc.totalMinor);
check(doc.depositMinor === String((270000 - 27000) * 0.4), "acompte calculé", doc.depositMinor);
await shot(page, "ui-05-editor-totals");

// Aperçu puis émission avec un numéro particulier.
await page.getByRole("button", { name: "Voir le PDF" }).last().click();
await page.waitForTimeout(3500);
await shot(page, "ui-06-pdf-sheet");
check(await page.getByRole("dialog").getByRole("img").isVisible(), "aperçu du PDF dans la feuille");
check(await page.getByText(/Utilise 1 document : il vous en restera \d+/).isVisible(), "émission : le quota est annoncé");
await page.getByLabel(/Numéro particulier/).fill("COLLEGE-2026-01");
await page.getByRole("button", { name: "Émettre le PDF final" }).click();
await page.waitForTimeout(4000);
doc = await api(`/v1/portal/documents/${docId}`, { token: T });
check(doc.status === "issued" && doc.number === "COLLEGE-2026-01", "émis avec le numéro particulier", `${doc.status} ${doc.number}`);
for (let i = 0; i < 20 && !doc.rendered; i++) {
  await sleep(1000);
  doc = await api(`/v1/portal/documents/${docId}`, { token: T });
}
await page.reload({ waitUntil: "networkidle" });
await shot(page, "ui-07-issued");
check(await page.getByText("COLLEGE-2026-01").first().isVisible(), "document émis affiché avec son numéro");
check(!(await page.getByRole("button", { name: "Ajouter une ligne" }).isVisible().catch(() => false)), "un document émis ne se modifie plus");

// Téléchargement réel du PDF depuis l'interface.
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Télécharger le PDF" }).last().click()]);
const pdfPath = `${OUT}ui-download.pdf`;
await download.saveAs(pdfPath);
const text = pdfcheck("text", pdfPath);
check(text.includes("COLLEGE-2026-01") && text.includes("Menuiserie Afi") && text.includes("Collège Saint-Paul") && text.includes("Acompte de 40 %"), "le PDF téléchargé contient numéro, nom, client et clause");
check(Number(pdfcheck("images", pdfPath).trim()) >= 1, "le PDF téléchargé contient le logo");

// En facture depuis le menu, puis paiement et reçu.
await page.getByRole("button", { name: "Actions du document" }).click();
await page.getByRole("menuitem", { name: "En facture" }).click();
await page.waitForURL((u) => !u.pathname.endsWith(docId), { timeout: 10000 });
check(await page.getByText(/Facture · Brouillon/).waitFor({ timeout: 8000 }).then(() => true, () => false), "conversion en facture : nouveau brouillon");
await page.getByRole("button", { name: "Voir le PDF" }).last().click();
await page.waitForTimeout(2500);
await page.getByRole("button", { name: "Émettre le PDF final" }).click();
await page.waitForTimeout(3500);
await page.getByRole("button", { name: "Noter un paiement" }).click();
await page.getByLabel(/^Montant/).fill("97200");
await page.getByLabel(/Moyen/).fill("Mobile Money");
await page.getByRole("button", { name: "Enregistrer le paiement" }).click();
await page.waitForTimeout(2000);
check(await page.getByText("Mobile Money").first().isVisible(), "paiement noté dans la liste");
await page.getByRole("button", { name: "Émettre le reçu" }).click();
await page.waitForTimeout(2500);
check(await page.getByRole("link", { name: "Reçu émis" }).isVisible(), "reçu émis depuis l'interface");
await shot(page, "ui-08-invoice-payments");

// Accueil avec des documents.
await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
await shot(page, "ui-09-home");
check(await page.getByText("Portes du bloc administratif").first().isVisible(), "accueil : le document apparaît dans Récents");

// Lien expiré expliqué (P-68).
const expiredCtx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR" });
const ep = await expiredCtx.newPage();
await ep.goto(`${BASE}/acces/${"x".repeat(43)}`, { waitUntil: "networkidle" });
check(await ep.getByRole("heading", { name: "Ce lien ne s'ouvre pas" }).isVisible(), "lien inconnu : expliqué");
await shot(ep, "ui-10-link-invalid");
await expiredCtx.close();

check(errors.filter((e) => !/favicon|404/.test(e)).length === 0, "aucune erreur dans la console", errors.join(" | ").slice(0, 400));
await b.close();
process.exit(summary() ? 1 : 0);
