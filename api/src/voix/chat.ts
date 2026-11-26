// LES MESSAGES DU CHAT — voix de la v1 (`docs/product/VOIX.md`, PARITE_V1 P-38).
// Tu, une à deux lignes, une question à la fois, aucun point d'exclamation, aucun emoji, aucun
// jargon. Firmo constate, il ne félicite pas. Quand quelque chose échoue, c'est Firmo qui n'a pas su.
// Aucun autre module n'écrit de phrase destinée à l'artisan.

export interface ChatLine {
  n: number;
  label: string;
  description: string | null;
  kind: "priced" | "flat" | "text";
  qty: string | null;
  unit: string | null;
  price: string | null;
  flat: string | null;
  total: string | null;
  toConfirm: boolean;
}

/** Le type de document dans une phrase, avec ses accords (« ce devis », « cette facture »). */
export interface Noun {
  word: string;
  a: string;
  this: string;
  your: string;
  Your: string;
  of: string;
  ready: string;
}

const FR_NOUNS: Record<string, Noun> = {
  quote: { word: "devis", a: "un devis", this: "ce devis", your: "ton devis", Your: "Ton devis", of: "du devis", ready: "prêt" },
  proforma: { word: "proforma", a: "une proforma", this: "cette proforma", your: "ta proforma", Your: "Ta proforma", of: "de la proforma", ready: "prête" },
  invoice: { word: "facture", a: "une facture", this: "cette facture", your: "ta facture", Your: "Ta facture", of: "de la facture", ready: "prête" },
  delivery_note: { word: "bon de livraison", a: "un bon de livraison", this: "ce bon de livraison", your: "ton bon de livraison", Your: "Ton bon de livraison", of: "du bon de livraison", ready: "prêt" },
  receipt: { word: "reçu", a: "un reçu", this: "ce reçu", your: "ton reçu", Your: "Ton reçu", of: "du reçu", ready: "prêt" },
};
const EN_NOUNS: Record<string, Noun> = Object.fromEntries(
  Object.entries({ quote: "quote", proforma: "pro forma", invoice: "invoice", delivery_note: "delivery note", receipt: "receipt" })
    .map(([k, w]) => [k, { word: w, a: `a ${w}`, this: `this ${w}`, your: `your ${w}`, Your: `Your ${w}`, of: `of the ${w}`, ready: "ready" }]),
);

export function noun(locale: string, type: string): Noun {
  const table = locale.startsWith("en") ? EN_NOUNS : FR_NOUNS;
  return table[type] ?? table.quote!;
}

export interface ChatDraft {
  typeLabel: string;
  noun: Noun;
  title: string | null;
  client: string | null;
  sections: Array<{ n: number; title: string | null; subtotal: string | null; lines: ChatLine[] }>;
  adjustments: Array<{ n: number; label: string; percent: string | null; amount: string | null; missing: boolean }>;
  /** Total provisoire, seulement si tout est chiffré. */
  total: string | null;
  deposit: { percent: string; amount: string } | null;
  details: Array<{ label: string; value: string }>;
}

/** Ce qui manque, dans l'ordre de la v1 : une seule question à la fois. */
export type Missing =
  | { kind: "no_lines" }
  | { kind: "client" }
  | { kind: "quantity"; label: string }
  | { kind: "unit_price"; label: string }
  | { kind: "flat_amount"; label: string }
  | { kind: "adjustment"; label: string }
  | { kind: "subject" }
  | { kind: "negative" };

export interface ChatWords {
  welcome: string;
  privacy: (url: string) => string;
  ackVoice: string;
  ackPhoto: string;
  reading: (d: ChatDraft, next: Missing | null) => string;
  corrected: (changed: string | null, next: Missing | null, d: ChatDraft) => string;
  question: (m: Missing, n: Noun) => string;
  pdfOffer: (n: Noun) => string;
  askBusinessName: (n: Noun) => string;
  businessNameSaved: (name: string) => string;
  previewCaption: (n: Noun) => string;
  previewFollowUp: (remaining: number | null) => string;
  issuing: (n: Noun) => string;
  delivered: (n: Noun) => string;
  shareLink: (url: string) => string;
  pdfCaption: (typeLabel: string, number: string) => string;
  notUnderstood: string;
  outage: string;
  /** L'IA vient de tomber : la lecture qui suit est simplifiée (P-39). */
  degradedNote: string;
  outageVoice: string;
  outagePhoto: string;
  transcribeFailed: string;
  limit: (url: string) => string;
  quotaWarning: (remaining: number) => string;
  quota: (used: number, quota: number, remaining: number, trial: boolean) => string;
  nothingYet: string;
  nothingToIssue: string;
  nothingToConfirm: string;
  newDocument: string;
  help: string;
  stats: (s: { drafts: number; issued: number; quotes: number; invoices: number; accepted: number }) => string;
  search: (items: Array<{ number: string | null; client: string | null; title: string | null; total: string }>) => string;
  latest: (d: ChatDraft, number: string | null, state: string) => string;
  link: (purpose: "settings" | "documents" | "subscription" | "document", url: string, minutes: number) => string;
  converted: (from: string, to: Noun) => string;
  duplicated: (from: string) => string;
  sharePrompt: (number: string, url: string) => string;
  revised: (number: string) => string;
  paymentRecorded: (amount: string, number: string, balance: string, paid: boolean) => string;
  noInvoice: string;
  receiptIssued: (number: string) => string;
  noPayment: string;
  decision: (number: string, accepted: boolean) => string;
  noQuote: string;
  deletionRecorded: string;
  adminLink: (url: string, minutes: number) => string;
  adminDenied: string;
  updated: string;
  lineNotFound: (n: number) => string;
  invalidValue: (raw: string) => string;
  valueNotHeard: (raw: string) => string;
  discountLabel: string;
  error: string;
  subscriptionActive: (quota: number, until: string) => string;
  subscriptionFailed: string;
  /** Recharge confirmée (P-52) : documents ajoutés, reste de la période. */
  topUpAdded: (units: number, remaining: number) => string;
  /** Conditions de fin (Struo) : avant la fin, à la fin (grâce), fin de la grâce. Sans lien : il expirerait. */
  periodEnding: (days: number, until: string) => string;
  periodEnded: (graceUntil: string) => string;
  periodClosed: string;
  /** Émission refusée : la période et sa grâce sont passées. */
  expired: (url: string) => string;
  status: Record<string, string>;
  buttons: { issue: string; preview: string; edit: string; documents: string; settings: string };
}

function lineText(l: ChatLine, w: { at: string; missing: string; check: string }): string {
  if (l.kind === "text") return `• ${l.label}`;
  const parts: string[] = [];
  if (l.kind === "priced") {
    // L'unité n'est pas répétée quand le libellé commence par elle (« 45 Barre tube… », v1).
    const stem = l.unit?.toLowerCase().replace(/s$/, "") ?? "";
    const unit = l.unit && !l.label.toLowerCase().startsWith(stem) ? ` ${l.unit}` : "";
    parts.push(l.qty ? `${l.qty}${unit}` : `(${w.missing})`);
    parts.push(l.label);
    parts.push(l.price ? `${w.at} ${l.price}` : `(${w.missing})`);
  } else {
    parts.push(l.label);
    parts.push(l.flat ?? `(${w.missing})`);
  }
  const desc = l.description ? `\n  ${l.description}` : "";
  return `• ${parts.join(" ")}${l.toConfirm ? ` (${w.check})` : ""}${desc}`;
}

function draftBody(d: ChatDraft, L: { head: string; subject: string; client: string; services: string; subtotal: string; adjustments: string; total: string; deposit: string; at: string; missing: string; check: string }): string {
  const out: string[] = [L.head];
  if (d.title) out.push(`${L.subject} : ${d.title}`);
  if (d.client) out.push(`${L.client} : ${d.client}`);
  out.push(`${L.services} :`);
  for (const s of d.sections) {
    if (s.title) out.push(`${s.title} :`);
    for (const l of s.lines) out.push(lineText(l, L));
    if (s.title && s.subtotal) out.push(`${L.subtotal} : ${s.subtotal}`);
  }
  if (d.adjustments.length) {
    out.push(`${L.adjustments} :`);
    for (const a of d.adjustments) out.push(`• ${a.label} : ${a.missing ? L.missing : (a.percent ?? a.amount)}`);
  }
  if (d.total) out.push(`${L.total} : ${d.total}`);
  if (d.deposit) out.push(`${L.deposit} (${d.deposit.percent}) : ${d.deposit.amount}`);
  for (const x of d.details) out.push(`${x.label} : ${x.value}`);
  return out.join("\n");
}

const frDraft = (d: ChatDraft, head = "J'ai lu :") => draftBody(d, {
  head, subject: "Objet", client: "Client", services: "Prestations", subtotal: "Sous-total",
  adjustments: "Ajustements", total: "Total provisoire", deposit: "Acompte", at: "à", missing: "à préciser", check: "à vérifier",
});

const frQuestion = (m: Missing, n: Noun): string => {
  switch (m.kind) {
    case "no_lines": return "Je n'ai pas encore trouvé de prestation à chiffrer. Que veux-tu facturer ? Donne si possible le libellé, la quantité et le prix unitaire.";
    case "client": return `Pour qui est ${n.this} ?`;
    case "quantity": return `Quelle quantité faut-il prévoir pour « ${m.label} » ?`;
    case "unit_price": return `Quel est le prix unitaire de « ${m.label} » ?`;
    case "flat_amount": return `Quel montant pour « ${m.label} » ?`;
    case "adjustment": return `Quel montant ou pourcentage veux-tu appliquer pour « ${m.label} » ?`;
    case "subject": return `Quel objet veux-tu mettre sur ${n.this} ?`;
    case "negative": return "Une remise dépasse le montant sur lequel elle porte. Quel montant veux-tu garder ?";
  }
};

const fr: ChatWords = {
  welcome: "Envoie-moi une vente, je t'en fais un devis. Tu peux parler : dis ce que tu as chiffré, comme tu le dirais à quelqu'un.",
  privacy: (url) => `Tes prix restent à toi : personne d'autre ne les voit, et un lien de partage n'ouvre qu'un seul document. Le détail : ${url}`,
  ackVoice: "J'écoute…",
  ackPhoto: "Je regarde ta feuille…",
  reading: (d, next) => `${frDraft(d)}\n\n${next ? frQuestion(next, d.noun) : `C'est juste ? Si oui, je prépare l'aperçu ${d.noun.of}.`}`,
  corrected: (changed, next, d) => [`C'est corrigé.${changed ? `\n${changed}` : ""}`, next ? frQuestion(next, d.noun) : fr.pdfOffer(d.noun)].join("\n"),
  question: frQuestion,
  pdfOffer: (n) => `${n.Your} est ${n.ready}. Souhaites-tu que je prépare le PDF maintenant ?`,
  askBusinessName: (n) => `Sous quel nom doit partir ${n.this} ?`,
  businessNameSaved: (name) => `C'est noté : tes documents partiront au nom de ${name}.`,
  previewCaption: (n) => `Aperçu ${n.of}, pas encore numéroté.`,
  previewFollowUp: (r) => `Si tout est bon, réponds OK pour le PDF final numéroté.${r !== null ? ` Il utilise 1 document : il t'en restera ${Math.max(r - 1, 0)}.` : ""} Sinon, dis-moi ce qu'il faut changer.`,
  issuing: (n) => `Je prépare le PDF final ${n.of}.`,
  delivered: (n) => `${n.Your} est ${n.ready}.`,
  shareLink: (url) => `Lien à transférer à ton client : ${url}`,
  pdfCaption: (t, n) => `${t} ${n}`,
  notUnderstood: "Je n'ai pas bien saisi la fin. Redis-moi juste les dernières lignes, ou écris-les.",
  outage: "Je n'arrive pas à lire une nouvelle source en ce moment. Écris chaque ligne comme ceci : quantité | libellé | prix. Ton devis déjà commencé reste disponible.",
  degradedNote: "Je lis en mode simplifié en ce moment. Si une ligne manque ou est mal lue, écris-la comme ceci : quantité | libellé | prix.",
  outageVoice: "J'ai bien reçu ton vocal, mais je n'arrive pas à l'écouter en ce moment. Ton brouillon est conservé. Écris chaque ligne comme ceci : quantité | libellé | prix.",
  outagePhoto: "J'ai bien reçu ta photo, mais je n'arrive pas à lire la feuille en ce moment. Ton brouillon est conservé. Écris chaque ligne comme ceci : quantité | libellé | prix.",
  transcribeFailed: "Je n'ai pas bien saisi ce vocal. Redis-le, ou écris les lignes.",
  limit: (url) => `Tes documents du mois sont utilisés. Ton brouillon reste disponible. Pour continuer, réponds ABONNEMENT ou RECHARGE, ou ouvre : ${url}`,
  quotaWarning: (r) => `Il te reste ${r} document${r > 1 ? "s" : ""} ce mois.`,
  quota: (used, quota, remaining, trial) => trial
    ? `Essai : ${used} document${used > 1 ? "s" : ""} utilisé${used > 1 ? "s" : ""} sur ${quota}. Il t'en reste ${remaining}.`
    : `Ce mois : ${used} document${used > 1 ? "s" : ""} utilisé${used > 1 ? "s" : ""} sur ${quota}. Il t'en reste ${remaining}.`,
  nothingYet: "Tu n'as pas encore de devis. Le premier prend une minute.",
  nothingToIssue: "Il n'y a pas de brouillon en cours. Envoie-moi d'abord ta vente.",
  nothingToConfirm: "Je n'ai rien en attente de ta réponse. Envoie-moi une vente, ou dis-moi ce que tu veux faire.",
  newDocument: "D'accord, on repart de zéro. Envoie-moi la nouvelle vente.",
  help: "Envoie un vocal, une photo de ta feuille ou un texte : je te montre ce que j'ai lu, tu corriges, puis je prépare le PDF. Tu peux aussi demander tes documents, ton quota, une facture à partir d'un devis ou le lien de ton espace.",
  stats: (s) => `Tu as ${s.drafts} brouillon${s.drafts > 1 ? "s" : ""} et ${s.issued} document${s.issued > 1 ? "s" : ""} finalisé${s.issued > 1 ? "s" : ""}, dont ${s.quotes} devis et ${s.invoices} facture${s.invoices > 1 ? "s" : ""}. ${s.accepted} devis accepté${s.accepted > 1 ? "s" : ""}.`,
  search: (items) => items.length
    ? `J'ai trouvé :\n${items.map((i) => `• ${i.number ?? "brouillon"} · ${i.title ?? i.client ?? "sans objet"} · ${i.total}`).join("\n")}`
    : "Je n'ai trouvé aucun document avec ces mots.",
  latest: (d, number, state) => `${frDraft(d, `${d.typeLabel}${number ? ` ${number}` : ""} :`)}\nÉtat : ${state}`,
  link: (purpose, url, minutes) => ({
    settings: `Configure ton identité, ton logo, ta couleur et ta numérotation ici (lien valable ${minutes} minutes) : ${url}`,
    documents: `Retrouve ici tes brouillons et tes PDF finalisés (lien valable ${minutes} minutes) : ${url}`,
    subscription: `Pour t'abonner ou recharger, ouvre ce lien (valable ${minutes} minutes) : ${url}`,
    document: `Ouvre le document ici (lien valable ${minutes} minutes) : ${url}`,
  })[purpose],
  converted: (from, to) => `J'ai préparé ${to.a} à partir de ${from}.`,
  duplicated: (from) => `J'ai copié ${from} dans un nouveau brouillon.`,
  sharePrompt: (n, url) => `Voici le lien de ${n} à transférer : ${url}`,
  revised: (n) => `${n} est déjà émis : j'en prépare une révision.`,
  paymentRecorded: (a, n, b, paid) => paid ? `Paiement de ${a} noté : la facture ${n} est soldée. Écris « reçu » pour envoyer un reçu.` : `Paiement de ${a} noté sur ${n}. Reste à payer : ${b}. Écris « reçu » pour envoyer un reçu.`,
  noInvoice: "Je n'ai pas trouvé de facture à régler. Donne-moi son numéro.",
  receiptIssued: (n) => `Je prépare le reçu ${n}.`,
  noPayment: "Je ne vois aucun paiement noté pour faire un reçu. Écris d'abord le paiement, par exemple « payé 50 000 ».",
  decision: (n, ok) => ok ? `${n} est noté comme accepté. Écris « facture » pour la préparer.` : `${n} est noté comme refusé.`,
  noQuote: "Je n'ai pas trouvé ce devis.",
  deletionRecorded: "C'est noté : ta demande de suppression est enregistrée. Je te confirme ici quand elle est traitée.",
  adminLink: (url, minutes) => `Ton accès à l'administration, valable ${minutes} minutes : ${url}`,
  adminDenied: "Cette identité n'ouvre pas l'administration.",
  updated: "C'est enregistré.",
  lineNotFound: (n) => `Je ne vois pas de ligne ${n}.`,
  invalidValue: (raw) => `Je n'ai pas pu lire « ${raw} ». Écris-le en chiffres, par exemple 15 000.`,
  valueNotHeard: (raw) => `Je n'ai pas retrouvé « ${raw} » dans ton message. Redis-moi la valeur exacte.`,
  discountLabel: "Remise",
  error: "Je n'ai pas su traiter ce message. Ton brouillon est conservé : réessaie dans un instant.",
  subscriptionActive: (q, until) => `Ton abonnement est actif : ${q} documents jusqu'au ${until}.`,
  subscriptionFailed: "Le paiement n'est pas passé. Ton brouillon reste disponible ; tu peux réessayer depuis le même lien.",
  topUpAdded: (u, r) => `Recharge ajoutée : ${u} documents de plus. Il t'en reste ${r} jusqu'à la fin de la période.`,
  periodEnding: (d, until) => d > 1
    ? `Ton abonnement se termine dans ${d} jours, le ${until}. Il ne se renouvelle pas tout seul : pour continuer, réponds ABONNEMENT.`
    : `Ton abonnement se termine demain, le ${until}. Il ne se renouvelle pas tout seul : pour continuer, réponds ABONNEMENT.`,
  periodEnded: (g) => `Ton abonnement est arrivé à sa fin. Tu peux encore émettre tes documents jusqu'au ${g}. Pour continuer, réponds ABONNEMENT.`,
  periodClosed: "Ton abonnement est terminé. Tes documents restent consultables et téléchargeables, tes brouillons sont gardés. Pour émettre de nouveau, réponds ABONNEMENT.",
  expired: (url) => `Ton abonnement est terminé. Ton brouillon reste disponible. Pour l'émettre, réponds ABONNEMENT ou ouvre : ${url}`,
  status: {
    draft: "brouillon", issued: "émis", accepted: "accepté", refused: "refusé", no_response: "sans réponse",
    partially_paid: "acompte reçu", paid: "payé", cancelled: "annulé", replaced: "remplacé",
  },
  buttons: { issue: "PDF final", preview: "Voir l'aperçu", edit: "Corriger", documents: "Mes documents", settings: "Mon espace" },
};

const enDraft = (d: ChatDraft, head = "Here is what I read:") => draftBody(d, {
  head, subject: "Subject", client: "Client", services: "Items", subtotal: "Subtotal",
  adjustments: "Adjustments", total: "Provisional total", deposit: "Deposit", at: "at", missing: "to confirm", check: "please check",
});

const enQuestion = (m: Missing, n: Noun): string => {
  switch (m.kind) {
    case "no_lines": return "I haven't found anything to price yet. What are you billing? Give the item, the quantity and the unit price if you can.";
    case "client": return `Who is ${n.this} for?`;
    case "quantity": return `What quantity for "${m.label}"?`;
    case "unit_price": return `What is the unit price of "${m.label}"?`;
    case "flat_amount": return `What amount for "${m.label}"?`;
    case "adjustment": return `What amount or percentage for "${m.label}"?`;
    case "subject": return `What subject should ${n.this} carry?`;
    case "negative": return "A discount is larger than the amount it applies to. What amount do you want to keep?";
  }
};

const en: ChatWords = {
  ...fr,
  welcome: "Send me a sale and I'll turn it into a quote. You can speak: say what you priced, as you'd tell someone.",
  privacy: (url) => `Your prices stay yours: nobody else sees them, and a share link opens one document only. Details: ${url}`,
  ackVoice: "Listening…",
  ackPhoto: "Looking at your sheet…",
  reading: (d, next) => `${enDraft(d)}\n\n${next ? enQuestion(next, d.noun) : `Is that right? If so, I'll prepare the preview ${d.noun.of}.`}`,
  corrected: (changed, next, d) => [`Fixed.${changed ? `\n${changed}` : ""}`, next ? enQuestion(next, d.noun) : en.pdfOffer(d.noun)].join("\n"),
  question: enQuestion,
  pdfOffer: (n) => `${n.Your} is ready. Shall I prepare the PDF now?`,
  askBusinessName: (n) => `Under which business name should ${n.this} go out?`,
  businessNameSaved: (name) => `Noted: your documents will go out as ${name}.`,
  previewCaption: (n) => `Preview ${n.of}, not numbered yet.`,
  previewFollowUp: (r) => `If it's all good, reply OK for the final numbered PDF.${r !== null ? ` It uses 1 document: ${Math.max(r - 1, 0)} will remain.` : ""} Otherwise tell me what to change.`,
  issuing: (n) => `Preparing the final PDF ${n.of}.`,
  delivered: (n) => `${n.Your} is ready.`,
  shareLink: (url) => `Link to forward to your client: ${url}`,
  notUnderstood: "I didn't catch the end. Just repeat the last lines, or type them.",
  outage: "I can't read a new source right now. Write each line like this: quantity | item | price. Your current draft is kept.",
  degradedNote: "I'm reading in simplified mode right now. If a line is missing or wrong, write it like this: quantity | item | price.",
  outageVoice: "I got your voice note but can't listen to it right now. Your draft is kept. Write each line like this: quantity | item | price.",
  outagePhoto: "I got your photo but can't read the sheet right now. Your draft is kept. Write each line like this: quantity | item | price.",
  transcribeFailed: "I didn't catch that voice note. Say it again, or type the lines.",
  limit: (url) => `This month's documents are used up. Your draft is kept. To continue, reply SUBSCRIBE or TOP UP, or open: ${url}`,
  quotaWarning: (r) => `You have ${r} document${r > 1 ? "s" : ""} left this month.`,
  quota: (used, quota, remaining, trial) => `${trial ? "Trial" : "This month"}: ${used} of ${quota} documents used. ${remaining} left.`,
  nothingYet: "You don't have a quote yet. The first one takes a minute.",
  nothingToIssue: "There's no draft in progress. Send me your sale first.",
  nothingToConfirm: "Nothing is waiting for your answer. Send me a sale, or tell me what you want to do.",
  newDocument: "Alright, starting over. Send me the new sale.",
  help: "Send a voice note, a photo of your sheet or a text: I show you what I read, you correct it, then I prepare the PDF. You can also ask for your documents, your quota, an invoice from a quote, or your space link.",
  stats: (s) => `You have ${s.drafts} draft(s) and ${s.issued} finalised document(s), including ${s.quotes} quote(s) and ${s.invoices} invoice(s). ${s.accepted} quote(s) accepted.`,
  search: (items) => items.length
    ? `Found:\n${items.map((i) => `• ${i.number ?? "draft"} · ${i.title ?? i.client ?? "no subject"} · ${i.total}`).join("\n")}`
    : "I found no document with those words.",
  latest: (d, number, state) => `${enDraft(d, `${d.typeLabel}${number ? ` ${number}` : ""}:`)}\nStatus: ${state}`,
  link: (purpose, url, minutes) => ({
    settings: `Set your business name, logo, colour and numbering here (link valid ${minutes} minutes): ${url}`,
    documents: `Your drafts and final PDFs are here (link valid ${minutes} minutes): ${url}`,
    subscription: `To subscribe or top up, open this link (valid ${minutes} minutes): ${url}`,
    document: `Open the document here (link valid ${minutes} minutes): ${url}`,
  })[purpose],
  converted: (from, to) => `I prepared ${to.a} from ${from}.`,
  duplicated: (from) => `I copied ${from} into a new draft.`,
  sharePrompt: (n, url) => `Here is the link of ${n} to forward: ${url}`,
  revised: (n) => `${n} is already issued: I'm preparing a revision.`,
  paymentRecorded: (a, n, b, paid) => paid ? `Payment of ${a} recorded: invoice ${n} is settled. Write "receipt" to send a receipt.` : `Payment of ${a} recorded on ${n}. Balance due: ${b}. Write "receipt" to send a receipt.`,
  noInvoice: "I couldn't find an invoice to settle. Give me its number.",
  receiptIssued: (n) => `Preparing receipt ${n}.`,
  noPayment: "I see no recorded payment for a receipt. Write the payment first, e.g. \"paid 50,000\".",
  decision: (n, ok) => ok ? `${n} marked as accepted. Write "invoice" to prepare it.` : `${n} marked as declined.`,
  noQuote: "I couldn't find that quote.",
  deletionRecorded: "Noted: your deletion request is recorded. I'll confirm here once it's done.",
  adminLink: (url, minutes) => `Your admin access, valid ${minutes} minutes: ${url}`,
  adminDenied: "This identity doesn't open the admin console.",
  updated: "Saved.",
  lineNotFound: (n) => `I don't see a line ${n}.`,
  invalidValue: (raw) => `I couldn't read "${raw}". Write it in figures, e.g. 15,000.`,
  valueNotHeard: (raw) => `I couldn't find "${raw}" in your message. Tell me the exact value.`,
  discountLabel: "Discount",
  error: "I couldn't handle this message. Your draft is kept: try again in a moment.",
  subscriptionActive: (q, until) => `Your subscription is active: ${q} documents until ${until}.`,
  subscriptionFailed: "The payment didn't go through. Your draft is kept; you can retry from the same link.",
  topUpAdded: (u, r) => `Top-up added: ${u} more documents. You have ${r} left until the end of the period.`,
  periodEnding: (d, until) => d > 1
    ? `Your subscription ends in ${d} days, on ${until}. It doesn't renew by itself: to continue, reply SUBSCRIBE.`
    : `Your subscription ends tomorrow, on ${until}. It doesn't renew by itself: to continue, reply SUBSCRIBE.`,
  periodEnded: (g) => `Your subscription has reached its end. You can still issue documents until ${g}. To continue, reply SUBSCRIBE.`,
  periodClosed: "Your subscription has ended. Your documents stay readable and downloadable, your drafts are kept. To issue again, reply SUBSCRIBE.",
  expired: (url) => `Your subscription has ended. Your draft is kept. To issue it, reply SUBSCRIBE or open: ${url}`,
  status: {
    draft: "draft", issued: "issued", accepted: "accepted", refused: "declined", no_response: "no answer",
    partially_paid: "deposit received", paid: "paid", cancelled: "cancelled", replaced: "replaced",
  },
  buttons: { issue: "Final PDF", preview: "Preview", edit: "Correct", documents: "My documents", settings: "My space" },
};

export function chatWords(locale: string): ChatWords {
  return locale.startsWith("en") ? en : fr;
}

/** Mots que Firmo ne dit jamais (voix v1). Vérifiés par les tests sur tous les messages. */
export const BANNED_WORDS = [
  "traitement en cours", "veuillez patienter", "une erreur est survenue", "oups", "désolé", "échec", "invalide",
  "non reconnu", "votre demande", "notre système", "optimiser", "solution", "digitaliser", "intelligence artificielle",
];
