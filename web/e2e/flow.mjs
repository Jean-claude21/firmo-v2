// Parcours fonctionnel complet sur l'application réelle (API + worker + rendu), sans interface :
import { fileURLToPath } from "node:url";
// chat → document → espace artisan (présentation, logo, numérotation, clauses) → document web →
// émission → PDF vérifié dans son contenu → partage et décision du client → facture → paiement →
// reçu → révision, duplication → clients → abonnement.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";
import { api, BASE, check, conversation, linkIn, OUT, sleep, staffLogin, summary } from "./lib.mjs";

const PY = process.env.PYTHON ?? "python";
const inspect = (...args) => execFileSync(PY, ["-I", fileURLToPath(new URL("./pdfcheck.py", import.meta.url)), ...args], { encoding: "utf8" });

/** PNG uni (carré de couleur sur fond blanc) : un logo reconnaissable dans le rendu. */
function pngLogo(size, [r, g, b]) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = x > size * 0.15 && x < size * 0.85 && y > size * 0.15 && y < size * 0.85;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = inside ? r : 255;
      raw[o + 1] = inside ? g : 255;
      raw[o + 2] = inside ? b : 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function download(path, token, name) {
  const res = await api(path, { token, raw: true });
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = `${OUT}${name}`;
  writeFileSync(file, bytes);
  return { file, bytes, type: res.headers.get("content-type"), status: res.status };
}

async function waitRendered(token, id, timeout = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const doc = await api(`/v1/portal/documents/${id}`, { token });
    if (doc.rendered) return doc;
    await sleep(800);
  }
  return api(`/v1/portal/documents/${id}`, { token });
}

const staff = await staffLogin();

// ---------------------------------------------------------------- 1. le chat jusqu'au PDF
console.log("\n1. Chat : vente → PDF final");
const c = conversation(staff.token);
let out = await c.send("Devis pour la Clinique Saint-Luc : 3 climatiseurs split à 285000, et 20 mètres de goulotte à 2500");
const answers = [
  [/Quel objet/, "objet : climatisation du bloc administratif"],
  [/Pour qui/, "client Clinique Saint-Luc"],
  [/Sous quel nom/, "Froid Services Komla"],
  [/prépare le PDF maintenant|réponds OK pour le PDF final/, "OK"],
];
let issued = false;
for (let turn = 0; turn < 8 && !issued; turn++) {
  const last = out.filter((m) => m.kind === "text").at(-1)?.text ?? "";
  if (/Je prépare le PDF final/.test(out.map((m) => m.text).join("\n"))) {
    issued = true;
    break;
  }
  const answer = answers.find(([re]) => re.test(last));
  if (!answer) {
    console.log("    réponse inattendue :", last);
    break;
  }
  out = await c.send(answer[1]);
}
check(issued, "le chat émet le PDF final après confirmation");
await sleep(6000);
const all = await c.all();
const pdfMsg = all.filter((m) => m.direction === "out" && m.kind === "document" && /\.pdf$/.test(m.mediaKey ?? "") && !/apercu/.test(m.mediaKey ?? "")).at(-1);
check(Boolean(pdfMsg), "le PDF final numéroté arrive dans la conversation", all.slice(-4).map((m) => `${m.kind}:${m.mediaKey ?? m.text}`).join(" | "));
check(all.some((m) => m.direction === "out" && m.kind === "image"), "l'aperçu image arrive dans la conversation");

// ---------------------------------------------------------------- 2. l'espace artisan
console.log("\n2. Lien d'accès");
out = await c.send("espace");
const link = linkIn(out.map((m) => m.text));
check(Boolean(link), "« espace » renvoie un lien d'accès");
const token = link.split("/acces/")[1];
const session = await api("/v1/portal/session", { body: { token } });
check(Boolean(session.token), "le lien ouvre une session");
const again = await api("/v1/portal/session", { body: { token }, raw: true });
check(again.status === 200, "P-68 le même lien rouvre l'espace pendant sa durée", `statut ${again.status}`);
const T = session.token;

// ---------------------------------------------------------------- 3. présentation
console.log("\n3. Présentation (P-64)");
const me = await api("/v1/portal/me", { token: T });
const legal = me.reference.countries.find((x) => x.code === me.org.countryCode)?.legalIds ?? [];
check(legal.length > 0, "identifiants légaux proposés pour le pays", me.org.countryCode);
const legalIds = Object.fromEntries(legal.map((l, i) => [l.code, i === 0 ? "RC-2026-B-0412" : "NIF-1000456789"]));
await api("/v1/portal/profile", { token: T, method: "PATCH", body: {
  name: "Froid Services Komla", tradeLabel: "Froid · Climatisation", phone: "+228 90 11 22 33", email: "contact@froid-komla.example",
  address: "Rue des Artisans, Lot 14", legalIds, brandColor: "#1F6F43", paymentMethods: "Mobile Money : 90 11 22 33", footerNote: "Merci de votre confiance.",
} });
const me2 = await api("/v1/portal/me", { token: T });
check(me2.org.name === "Froid Services Komla" && me2.org.brandColor === "#1F6F43" && me2.org.tradeLabel === "Froid · Climatisation", "nom, métier et couleur enregistrés");
check(Object.entries(legalIds).every(([k, v]) => me2.org.legalIds?.[k] === v), "identifiants légaux enregistrés", `${JSON.stringify(me2.org.legalIds)} ≠ ${JSON.stringify(legalIds)}`);

// Logo : vrai PNG, retrouvé tel quel, puis dans le PDF.
const MAGENTA = [214, 0, 120];
const logo = pngLogo(240, MAGENTA);
const up = await api("/v1/portal/logo", { token: T, body: { base64: logo.toString("base64") } });
check("suggestedColor" in up, "logo accepté (couleur suggérée renvoyée)", JSON.stringify(up));
const back = await download("/v1/portal/logo", T, "logo-back.png");
check(back.status === 200 && back.type === "image/png" && back.bytes.length > 100, "logo relu depuis l'espace");
const meLogo = await api("/v1/portal/me", { token: T });
check(meLogo.org.hasLogo === true, "l'organisation a un logo");
const bad = await api("/v1/portal/logo", { token: T, body: { base64: Buffer.from("pas une image du tout").toString("base64") }, raw: true });
check(bad.status === 422, "un fichier qui n'est pas une image est refusé avec un message", `statut ${bad.status}`);

// Aperçu en direct (P-64) : une couleur tapée, pas enregistrée, apparaît dans l'aperçu ; rien ne change.
const live = await api("/v1/portal/presentation/preview", { token: T, body: { brandColor: "#2B4FD6", name: "Nom pas encore enregistré" }, raw: true });
const liveFile = `${OUT}live-preview.png`;
writeFileSync(liveFile, Buffer.from(await live.arrayBuffer()));
check(live.status === 200 && live.headers.get("content-type") === "image/png", "aperçu en direct de la présentation");
check(Number(inspect("color", liveFile, "#2B4FD6", "20").trim()) > 20, "l'aperçu montre la couleur tapée avant l'enregistrement");
check(Number(inspect("color", liveFile, "#D60078", "30").trim()) > 50, "l'aperçu montre le logo");
check((await api("/v1/portal/me", { token: T })).org.brandColor === "#1F6F43", "l'aperçu n'enregistre rien");
const liveBad = await api("/v1/portal/presentation/preview", { token: T, body: { brandColor: "rouge" }, raw: true });
check(liveBad.status === 422, "valeur refusée par la même règle que l'enregistrement", `statut ${liveBad.status}`);

// Numérotation et clauses.
const numbering = await api("/v1/portal/numbering/quote", { token: T, method: "PUT", body: { prefix: "DV", separator: "/", includeYear: true, width: 4, cadence: "annual" } });
check(/^DV\/\d{4}\/\d{4}$/.test(numbering.preview ?? ""), "format des numéros avec aperçu", JSON.stringify(numbering));
const clause = await api("/v1/portal/clauses", { token: T, body: { body: "Acompte de 40 % à la commande, solde à la livraison.", isDefault: true } });
check(Boolean(clause.id), "clause par défaut enregistrée");

// ---------------------------------------------------------------- 4. document créé dans l'espace
console.log("\n4. Document créé dans l'espace (P-63)");
const draft = await api("/v1/portal/documents", { token: T, body: {
  type: "quote", title: "Climatisation des bureaux", site: "Bâtiment B",
  client: { name: "Société Bati Plus", phone: "+228 90 00 11 22" },
  sections: [
    { title: "Fourniture", showSubtotal: true, lines: [
      { label: "Climatiseur split 18 000 BTU", quantity: "4", unit: "unit", unitPrice: "310000" },
      { label: "Goulotte PVC", quantity: "30", unit: "m", unitPrice: "2500" },
    ] },
    { title: "Pose", showSubtotal: true, lines: [{ label: "Pose et mise en service", kind: "flat", flatAmount: "120000" }] },
  ],
  adjustments: [{ label: "Remise fidélité", mode: "percent", sign: -1, value: "5" }],
  depositPercent: "40", validityDays: 30, warrantyText: "Garantie 12 mois pièces et main-d'œuvre",
} });
check(draft.status === "draft" && draft.blockers?.length === 0, "brouillon complet, rien ne bloque", JSON.stringify(draft.blockers));
check(String(draft.totalMinor) === String(Math.round((4 * 310000 + 30 * 2500 + 120000) * 0.95)), "total calculé en base (remise comprise)", `${draft.totalMinor}`);
check(draft.clauses?.some?.((x) => /Acompte de 40 %/.test(x.body)), "la clause par défaut est reprise dans le nouveau document", JSON.stringify(draft.clauses));

const preview = await download(`/v1/portal/documents/${draft.id}/file.png`, T, "draft-preview.png");
check(preview.type === "image/png", "aperçu image du brouillon");
const magenta = Number(inspect("color", preview.file, "#D60078", "30").trim());
check(magenta > 50, "P-64 le logo apparaît dans l'aperçu du document", `${magenta} pixels`);
const green = Number(inspect("color", preview.file, "#1F6F43", "20").trim());
check(green > 20, "la couleur de l'artisan apparaît dans le document", `${green} pixels`);

const iss = await api(`/v1/portal/documents/${draft.id}/issue`, { token: T, body: {} });
const doc = await waitRendered(T, draft.id);
check(/^DV\/\d{4}\/\d{4}$/.test(doc.number ?? ""), "numéro au format choisi (la série continue)", doc.number);
check(doc.rendered, "rendu final prêt (PDF, PNG)");
const pdf = await download(`/v1/portal/documents/${draft.id}/file.pdf?download=1`, T, "issued.pdf");
const text = inspect("text", pdf.file);
for (const [needle, label] of [
  [doc.number, "numéro"], ["Froid Services Komla", "nom"], ["Société Bati Plus", "client"], ["Climatisation des bureaux", "objet"],
  ["RC-2026-B-0412", "RCCM"], ["Rue des Artisans", "adresse"], ["Acompte de 40 %", "clause"], ["Mobile Money", "moyens de paiement"],
  ["Garantie 12 mois", "garantie"], ["Fourniture", "section"],
]) check(text.includes(needle), `PDF : ${label}`, needle);
check(Number(inspect("images", pdf.file).trim()) >= 1, "PDF : le logo est inclus comme image");
check(!/brouillon|aperçu/i.test(text.slice(0, 400)), "PDF final sans filigrane de brouillon");

// ---------------------------------------------------------------- 5. partage et décision du client
console.log("\n5. Partage, page publique, décision (ART-7)");
const share = await api(`/v1/portal/documents/${draft.id}/share`, { token: T, body: {} });
const shareToken = share.url.split("/d/")[1];
check(Boolean(shareToken), "lien de partage", share.url);
const pub = await api(`/v1/public/documents/${shareToken}`);
check(pub.number === doc.number && !("orgId" in pub), "page publique : le document, rien d'interne");
const pubPdf = await download(`/v1/public/documents/${shareToken}/file.pdf`, null, "public.pdf");
check(pubPdf.status === 200 && pubPdf.type === "application/pdf", "le client télécharge le PDF");
const decided = await api(`/v1/public/documents/${shareToken}/decision`, { body: { decision: "accepted", note: "Bon pour accord" } });
check(decided.status === "accepted", "le client accepte le devis", decided.status);

// ---------------------------------------------------------------- 6. facture, paiement, reçu
console.log("\n6. Facture, paiement, reçu (DOC-6)");
const inv = await api(`/v1/portal/documents/${draft.id}/convert`, { token: T, body: { type: "invoice" } });
const invDraft = await api(`/v1/portal/documents/${inv.id}`, { token: T });
check(invDraft.type === "invoice" && String(invDraft.totalMinor) === String(doc.totalMinor), "conversion en facture, mêmes montants");
await api(`/v1/portal/documents/${inv.id}/issue`, { token: T, body: {} });
const invoice = await waitRendered(T, inv.id);
check(Boolean(invoice.number), "facture émise", invoice.number);
const pay = await api(`/v1/portal/documents/${inv.id}/payments`, { token: T, body: { amount: "500 000", method: "Mobile Money" } });
const afterPay = await api(`/v1/portal/documents/${inv.id}`, { token: T });
check(afterPay.status === "partially_paid", "acompte noté : facture partiellement payée", afterPay.status);
const receipt = await api(`/v1/portal/payments/${pay.id}/receipt`, { token: T, body: {} });
const rec = await waitRendered(T, receipt.id);
check(rec.type === "receipt" && Boolean(rec.number), "reçu émis pour le paiement", `${rec.type} ${rec.number}`);
const restMinor = BigInt(afterPay.totalMinor) - 500000n;
await api(`/v1/portal/documents/${inv.id}/payments`, { token: T, body: { amount: restMinor.toString() } });
check((await api(`/v1/portal/documents/${inv.id}`, { token: T })).status === "paid", "solde noté : facture payée");

// ---------------------------------------------------------------- 7. révision, duplication
console.log("\n7. Révision, duplication (P-10, P-12)");
const dup = await api(`/v1/portal/documents/${draft.id}/duplicate`, { token: T, body: {} });
const dupDoc = await api(`/v1/portal/documents/${dup.id}`, { token: T });
check(dupDoc.status === "draft" && dupDoc.number === null && String(dupDoc.totalMinor) === String(doc.totalMinor), "duplication : nouveau brouillon, mêmes lignes");
const rev = await api(`/v1/portal/documents/${draft.id}/revise`, { token: T, body: {} }).catch((e) => ({ error: e.message }));
if (rev.id) {
  await api(`/v1/portal/documents/${rev.id}/issue`, { token: T, body: {} });
  const revDoc = await api(`/v1/portal/documents/${rev.id}`, { token: T });
  check(revDoc.number === `${doc.number}/R2`, "révision numérotée /R2", revDoc.number);
} else check(false, "révision d'un devis émis", rev.error);

// ---------------------------------------------------------------- 8. clients, tableau de bord
console.log("\n8. Clients et accueil");
const clients = await api("/v1/portal/clients", { token: T });
check(clients.items.some((x) => x.name === "Société Bati Plus"), "le client du document est dans la liste");
const created = await api("/v1/portal/clients", { token: T, body: { name: "Hôtel du Lac", phone: "+228 22 22 22 22" } });
await api(`/v1/portal/clients/${created.id}`, { token: T, method: "PUT", body: { name: "Hôtel du Lac", address: "Boulevard du Lac" } });
check((await api("/v1/portal/clients", { token: T })).items.some((x) => x.address === "Boulevard du Lac"), "client créé puis modifié");
const dash = await api("/v1/portal/dashboard", { token: T });
check(dash.recent.length >= 3 && dash.entitlement, "accueil : documents récents et documents disponibles", JSON.stringify(dash.entitlement));

// ---------------------------------------------------------------- 9. abonnement
console.log("\n9. Abonnement (spec 011)");
const billing = await api("/v1/billing", { token: T });
check(billing.plans.length > 0 && billing.providers.some((p) => p.code === "simulator"), "offre et paiement simulé proposés");
const checkout = await api("/v1/billing/checkout", { token: T, body: { planCode: billing.plans[0].code, provider: "simulator" } });
await api(`/v1/billing/simulator/${checkout.id}`, { token: T, body: { outcome: "succeeded" } });
const ent = (await api("/v1/billing", { token: T })).entitlement;
check(ent?.kind === "paid" && ent.quota === billing.plans[0].quota, "abonnement actif après paiement", JSON.stringify(ent));
await sleep(3000);
check((await c.all()).some((m) => m.direction === "out" && /Ton abonnement est actif/.test(m.text ?? "")), "confirmation reçue dans le chat (file de confirmation)");

// ---------------------------------------------------------------- 10. logo retiré
await api("/v1/portal/logo", { token: T, method: "DELETE" });
check((await api("/v1/portal/me", { token: T })).org.hasLogo === false, "logo retiré");

console.log(`\nfichiers : ${OUT}  ·  ${BASE}`);
process.exit(summary() ? 1 : 0);
