// Spec 014 dans le navigateur : export des données depuis l'espace, demande de suppression,
// exécution par l'équipe dans la console, documents émis conservés.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { api, BASE, browser, check, conversation, linkIn, OUT, portalPage, shot, staffLogin, summary } from "./lib.mjs";

const PSQL = process.env.FIRMO_E2E_DB ?? "postgresql://postgres@localhost:54331/firmo";
const db = (q) => execFileSync("psql", [PSQL, "-qtA", "-v", "ON_ERROR_STOP=1"], { input: q, encoding: "utf8", env: { ...process.env, PGCLIENTENCODING: "UTF8" } }).trim();

const staff = await staffLogin();
const c = conversation(staff.token, undefined, "+22890556677");
const out = await c.send("espace");
const link = linkIn(out.map((m) => m.text));
const T = (await api("/v1/portal/session", { body: { token: link.split("/acces/")[1] } })).token;
await api("/v1/portal/profile", { token: T, method: "PATCH", body: { name: "Couture Afi" } });
const doc = await api("/v1/portal/documents", { token: T, body: { type: "quote", title: "Uniformes", client: { name: "École Saint-Joseph" }, lines: [{ label: "Uniforme", quantity: "40", unitPrice: "8500" }] } });
await api(`/v1/portal/documents/${doc.id}/issue`, { token: T, body: {} });
await new Promise((r) => setTimeout(r, 4000));

const b = await browser();
const { page, errors } = await portalPage(b, link);
await page.goto(`${BASE}/app/profil`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^Vos données/ }).click();
await shot(page, "data-01-mydata");
const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter mes données" }).click()]);
const zipPath = `${OUT}export.zip`;
await download.saveAs(zipPath);
const zip = readFileSync(zipPath);
check(zip.subarray(0, 2).toString() === "PK" && zip.includes(Buffer.from("firmo/donnees.json")) && zip.includes(Buffer.from("firmo/documents.csv")), "P-82 archive téléchargée : données et liste des documents");
check(zip.includes(Buffer.from("firmo/pdf/")), "P-82 l'archive contient le PDF du document émis");
check(zip.includes(Buffer.from("École Saint-Joseph")), "P-82 les données de l'artisan sont dans l'archive");

page.on("dialog", (d) => d.accept());
await page.getByRole("button", { name: "Demander la suppression", exact: true }).click();
await page.waitForTimeout(1500);
check(await page.getByText(/Votre demande de suppression du .* est en cours de traitement/).isVisible(), "P-83 demande de suppression enregistrée et suivie");
await shot(page, "data-02-pending");

// La console exécute la demande.
const admin = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
const ap = await admin.newPage();
await ap.goto(BASE, { waitUntil: "domcontentloaded" });
await ap.evaluate((s) => localStorage.setItem("firmo.session.staff", s), JSON.stringify({ token: staff.token, expiresAt: staff.expiresAt }));
await ap.goto(`${BASE}/admin/donnees`, { waitUntil: "networkidle" });
await ap.waitForTimeout(800);
await shot(ap, "data-03-admin");
const row = ap.getByRole("row", { name: /Couture Afi/ });
await row.getByRole("button", { name: "Exécuter la suppression" }).click();
await ap.getByLabel("Motif").fill("Demande vérifiée depuis le même numéro");
await ap.getByRole("button", { name: "Continuer" }).click();
await ap.getByRole("dialog").getByRole("button", { name: "Exécuter la suppression" }).click();
await ap.waitForTimeout(2000);
check(await ap.getByText(/Suppression faite/).isVisible(), "P-83 suppression exécutée, résumé affiché");
const org = c.orgId;
check(db(`select status || '|' || coalesce(name, '') from public.organizations where id = '${org}'`) === "deleted|", "P-83 organisation effacée");
check(db(`select count(*) from public.messages where org_id = '${org}'`) === "0", "P-83 conversations supprimées");
check(db(`select status from public.documents where id = '${doc.id}'`) === "issued", "P-83 document émis conservé");

check(errors.length === 0, "aucune erreur", errors.join(" | "));
await b.close();
process.exit(summary() ? 1 : 0);
