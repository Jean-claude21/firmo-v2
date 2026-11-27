// Console (spec 013) dans un vrai navigateur : centre de commande, incident, organisation et actions
// sensibles (motif + reconfirmation), montants sur motif, listes, recherche, pilotage, et accès
// « ADMIN » depuis le chat (lien à usage unique).
import { execFileSync } from "node:child_process";
import { api, BASE, browser, check, conversation, shot, sleep, staffLogin, summary } from "./lib.mjs";

const PSQL = process.env.FIRMO_E2E_DB ?? "postgresql://postgres@localhost:54331/firmo";
const db = (q) => execFileSync("psql", [PSQL, "-qtA", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } }).trim();

const staff = await staffLogin();
// Une organisation avec un document émis.
const c = conversation(staff.token, undefined, "+22890332211");
const linkMsg = await c.send("espace");
const access = /\/acces\/([A-Za-z0-9_-]+)/.exec(linkMsg.map((m) => m.text).join(" "))?.[1];
const portal = (await api("/v1/portal/session", { body: { token: access } })).token;
await api("/v1/portal/profile", { token: portal, method: "PATCH", body: { name: "Froid Services Komla" } });
const doc = await api("/v1/portal/documents", { token: portal, body: { type: "quote", title: "Climatisation", client: { name: "Clinique Saint-Luc" }, lines: [{ label: "Climatiseur split", quantity: "3", unitPrice: "285000" }] } });
await api(`/v1/portal/documents/${doc.id}/issue`, { token: portal, body: {} });
const org = c.orgId;
check(Boolean(org), "organisation créée par le chat");
// Un incident : un vocal dont le traitement a échoué (situation réelle reproduite en base).
const identity = db(`select id from public.channel_identities where org_id = '${org}' limit 1`);
const failed = db(`insert into public.messages (org_id, identity_id, channel, direction, kind, status, error, media_type)
  values ('${org}', '${identity}', 'simulator', 'in', 'audio', 'failed', 'transcription vide après 3 essais', 'audio/ogg') returning id`).split("\n")[0];

const b = await browser();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, async (e) => { await shot(page, "adm-FAIL").catch(() => {}); console.error("ÉCHEC :", e?.message ?? e); summary(); process.exit(1); });
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.evaluate((s) => localStorage.setItem("firmo.session.staff", s), JSON.stringify({ token: staff.token, expiresAt: staff.expiresAt }));

// ---------------------------------------------------------------- centre de commande
console.log("\nCentre de commande (P-70)");
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot(page, "adm-01-command");
check(await page.getByRole("heading", { name: "Centre de commande" }).isVisible(), "titre");
check(await page.getByText("Incidents ouverts").first().isVisible() && await page.getByText(/incidents? nécessite/).first().isVisible(), "incident signalé en bandeau");
check(await page.getByText("File de traitement").first().isVisible(), "file de traitement");
check(await page.getByText("Services essentiels").first().isVisible() && await page.getByText("Événements récents").first().isVisible(), "services et événements");
await page.getByRole("tab", { name: "Vocal" }).click();
await page.waitForTimeout(800);
check(await page.getByText("Transcription vocale").first().isVisible(), "filtre Vocal de la file");

// ---------------------------------------------------------------- incident
console.log("\nIncident (P-71)");
await page.goto(`${BASE}/admin/incidents/message/${failed}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot(page, "adm-02-incident");
check(await page.getByText("Chronologie du traitement").first().isVisible(), "chronologie");
check(await page.getByText("transcription vide après 3 essais").first().isVisible(), "erreur de l'entrée reçue");
await page.getByRole("button", { name: "Demander un nouveau vocal" }).click();
await page.waitForTimeout(3500);
check((await c.all()).some((m) => m.direction === "out" && /Je n'ai pas pu écouter ton dernier vocal/.test(m.text ?? "")), "le message part dans la conversation de l'artisan");
await page.getByLabel(/Note de clôture/).fill("Nouveau vocal demandé à l'artisan");
await page.getByRole("button", { name: "Marquer résolu" }).click();
await page.waitForTimeout(1200);
check(await page.getByText(/Clos par/).first().isVisible(), "incident clos avec la note");

// ---------------------------------------------------------------- organisation
console.log("\nOrganisation (P-72, P-74)");
await page.goto(`${BASE}/admin/organisations/${org}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
await shot(page, "adm-03-organization");
check(await page.getByText("Utilisation").first().isVisible() && await page.getByText("Canal principal").first().isVisible(), "en-tête : offre, utilisation, canal, activité");
check(await page.getByText("•••").first().isVisible(), "P-74 montants masqués par défaut");
await page.getByRole("button", { name: "Afficher les montants" }).click();
await page.getByLabel("Motif").fill("Litige signalé par le client de l'artisan");
await page.getByRole("button", { name: "Continuer" }).click();
check(await page.getByText(/Motif enregistré/).first().isVisible(), "P-74 reconfirmation avec le motif");
await page.getByRole("dialog").getByRole("button", { name: "Afficher les montants" }).click();
await page.waitForTimeout(1200);
check(await page.getByText(/Montants affichés jusqu'à/).first().isVisible() && !(await page.getByText("•••").first().isVisible().catch(() => false)), "montants affichés après le motif");
// Réinitialiser le quota.
const usedBefore = Number(db(`select used from app.entitlement('${org}')`));
await page.getByRole("button", { name: /Réinitialiser le quota/ }).click();
await page.getByLabel("Motif").fill("Document émis par erreur lors d'un test de l'équipe");
await page.getByRole("button", { name: "Continuer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Réinitialiser le quota" }).click();
await page.waitForTimeout(1200);
check(usedBefore > 0 && Number(db(`select used from app.entitlement('${org}')`)) === 0, "P-72 quota réinitialisé", `avant ${usedBefore}`);
// Lien d'accès à l'espace.
await page.getByRole("button", { name: "Envoyer un lien sécurisé" }).click();
await page.waitForTimeout(1200);
const linkText = await page.getByText(/\/acces\//).first().innerText();
check(/\/acces\/[A-Za-z0-9_-]{20,}/.test(linkText), "P-72 lien d'accès à l'espace créé");
// Message à l'artisan.
await page.getByRole("button", { name: /Envoyer un message/ }).click();
await page.getByLabel("Message à l'artisan").fill("Bonjour, votre quota a été remis à zéro après notre erreur.");
await page.getByRole("button", { name: "Envoyer", exact: true }).click();
await page.waitForTimeout(3500);
check((await c.all()).some((m) => m.direction === "out" && /votre quota a été remis à zéro/.test(m.text ?? "")), "P-72 message arrivé dans la conversation");
// Suspendre puis réactiver.
await page.getByRole("button", { name: "Suspendre" }).click();
await page.getByLabel("Motif").fill("ok");
check(await page.getByRole("button", { name: "Continuer" }).isDisabled(), "P-74 un motif trop court ne passe pas");
await page.getByLabel("Motif").fill("Contrôle de sécurité demandé");
await page.getByRole("button", { name: "Continuer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Suspendre" }).click();
await page.waitForTimeout(1200);
check(db(`select status from public.organizations where id = '${org}'`) === "suspended", "suspendue");
await page.getByRole("button", { name: "Réactiver" }).click();
await page.getByLabel("Motif").fill("Contrôle terminé, rien à signaler");
await page.getByRole("button", { name: "Continuer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Réactiver" }).click();
await page.waitForTimeout(1200);
check(db(`select status from public.organizations where id = '${org}'`) === "active", "réactivée");
await page.getByRole("tab", { name: "Journal d'audit" }).click();
await page.waitForTimeout(800);
await shot(page, "adm-04-org-audit");
check(await page.getByText("Contrôle de sécurité demandé").first().isVisible(), "les motifs sont au journal de l'organisation");

// ---------------------------------------------------------------- listes, recherche, pilotage
console.log("\nListes, recherche, pilotage (P-73, P-77, P-78)");
for (const [path, heading] of [["/admin/documents", "Documents"], ["/admin/paiements", "Paiements"], ["/admin/abonnements", "Abonnements"], ["/admin/clients", "Clients"], ["/admin/identites", "Identités"], ["/admin/pilotage", "Pilotage"], ["/admin/incidents", "Incidents"], ["/admin/organisations", "Organisations"], ["/admin/configuration", "Configuration"], ["/admin/journal", "Journal"]]) {
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check(await page.getByRole("heading", { level: 1 }).first().innerText().then((t) => t.includes(heading)), `${path} s'ouvre`);
  await shot(page, `adm-list${path.replace(/\//g, "-")}`);
}
await page.getByPlaceholder(/Rechercher organisation/).first().fill("Froid Services");
await page.waitForTimeout(1200);
check(await page.getByRole("button", { name: /Froid Services Komla/ }).first().isVisible(), "P-77 recherche par nom");

// ---------------------------------------------------------------- ADMIN depuis le chat
console.log("\nAccès « ADMIN » depuis le chat (P-76)");
const before = await c.send("ADMIN");
check(before.some((m) => /n'ouvre pas l'administration/.test(m.text ?? "")), "identité non autorisée : refus");
await page.goto(`${BASE}/admin/identites`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const staffId = db(`select user_id from public.staff where email = 'equipe@firmo.test'`);
await api(`/v1/admin/identities/${identity}/staff`, { token: staff.token, body: { staffUserId: staffId, allow: true } });
const after = await c.send("ADMIN");
const adminLink = after.map((m) => /(https?:\/\/\S+\/admin\/acces\/[A-Za-z0-9_-]+)/.exec(m.text ?? "")?.[1]).find(Boolean);
check(Boolean(adminLink), "identité autorisée : lien d'administration reçu");
const fresh = await b.newContext({ viewport: { width: 1280, height: 800 }, locale: "fr-FR" });
const fp = await fresh.newPage();
await fp.goto(adminLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
await fp.waitForTimeout(1500);
check(await fp.getByRole("heading", { name: "Centre de commande" }).isVisible(), "le lien ouvre la console");
const fp2 = await (await b.newContext({ locale: "fr-FR" })).newPage();
await fp2.goto(adminLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
await fp2.waitForTimeout(1200);
const reused = await fp2.getByRole("heading", { name: "Ce lien n'ouvre plus la console" }).isVisible();
if (!reused) { await shot(fp2, "adm-reused"); console.log("page :", (await fp2.locator("body").innerText()).slice(0, 300), fp2.url()); }
check(reused, "usage unique : le même lien est refusé ensuite");

check(errors.length === 0, "aucune erreur dans la console du navigateur", errors.join(" | ").slice(0, 300));
await b.close();
process.exit(summary() ? 1 : 0);
