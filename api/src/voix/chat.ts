// LES MESSAGES DU CHAT (constitution IV) : courts, numérotés, une action claire à la fin.
// Aucun autre module n'écrit de phrase destinée à l'artisan.

export interface DraftLineView {
  n: number;
  label: string;
  qty: string | null;
  unit: string | null;
  price: string | null;
  total: string | null;
  toConfirm: string[];
}

export interface DraftView {
  typeLabel: string;
  lines: DraftLineView[];
  total: string;
  complete: boolean;
  client: string | null;
  title: string | null;
  discount: string | null;
  tax: string | null;
  simulated: boolean;
}

export interface ChatWords {
  welcome: (name: string | null) => string;
  help: string;
  draft: (d: DraftView) => string;
  askBusinessName: string;
  businessNameSaved: (name: string) => string;
  missing: (items: string[]) => string;
  missingItem: Record<string, string>;
  issued: (typeLabel: string, number: string) => string;
  delivered: (typeLabel: string, number: string, link: string) => string;
  pdfCaption: (typeLabel: string, number: string) => string;
  previewCaption: (typeLabel: string, number: string, total: string) => string;
  cancelled: string;
  nothingToCancel: string;
  nothingToIssue: string;
  notUnderstood: string;
  readFailed: string;
  readEmpty: string;
  transcribeFailed: string;
  readingUnavailable: string;
  quotaExhausted: (link: string) => string;
  quotaWarning: (remaining: number) => string;
  portalLink: (link: string, minutes: number) => string;
  list: (items: Array<{ number: string | null; type: string; client: string | null; total: string; status: string }>) => string;
  listEmpty: string;
  converted: (fromNumber: string) => string;
  nothingToConvert: string;
  paymentRecorded: (amount: string, number: string, balance: string, paid: boolean) => string;
  noInvoice: string;
  receiptIssued: (number: string) => string;
  noPayment: string;
  decision: (number: string, accepted: boolean) => string;
  noQuote: string;
  status: Record<string, string>;
  buttons: { issue: string; edit: string; cancel: string; documents: string; settings: string };
  editHint: string;
  lineNotFound: (n: number) => string;
  invalidValue: (raw: string) => string;
  discountLabel: string;
  updated: string;
  error: string;
  revised: (number: string) => string;
  typeChanged: (label: string) => string;
  subscriptionActive: (quota: number, until: string) => string;
  subscriptionFailed: string;
}

function lineText(l: DraftLineView, w: { price: string; qty: string }): string {
  const qty = l.qty ?? `❓${w.qty}`;
  const unit = l.unit ? ` ${l.unit}` : "";
  const price = l.price ?? `❓${w.price}`;
  const total = l.total ? ` = ${l.total}` : "";
  const flag = l.toConfirm.length > 0 && l.price && l.qty ? " ⚠️" : "";
  return `${l.n}. ${l.label} — ${qty}${unit} × ${price}${total}${flag}`;
}

const fr: ChatWords = {
  welcome: (name) =>
    `Bonjour${name ? ` ${name}` : ""} 👋 Je suis Firmo.\nDicte-moi ta vente, écris-la ou envoie la photo de ton devis papier : je te renvoie un document professionnel.\n\nLe calcul est à toi, la présentation est à moi : je ne touche jamais à tes prix.`,
  help:
    "Comment ça marche :\n1. Envoie ta vente (vocal, texte ou photo).\n2. Je te montre ce que j'ai lu ; corrige si besoin : « ligne 2 prix 15000 », « enlève la 3 », « client Hôtel du Lac », « remise 10% ».\n3. Réponds OK : je t'envoie le PDF et le lien à transférer à ton client.\n\nAutres commandes : « mes documents », « facture » (après un devis), « payé 50000 », « reçu », « réglages ».",
  draft: (d) => {
    const head = `📄 ${d.typeLabel} — brouillon${d.simulated ? " (lecture simplifiée)" : ""}`;
    const lines = d.lines.map((l) => lineText(l, { price: "prix", qty: "qté" })).join("\n");
    const extra = [
      d.client ? `Client : ${d.client}` : null,
      d.title ? `Objet : ${d.title}` : null,
      d.discount ? `Remise : ${d.discount}` : null,
      d.tax ? `Taxe : ${d.tax}` : null,
      `Total : ${d.total}${d.complete ? "" : " (incomplet)"}`,
    ].filter(Boolean).join("\n");
    const action = d.complete
      ? "✅ Réponds OK pour émettre, ou corrige (ex. « ligne 2 prix 15000 »)."
      : "✏️ Complète ce qui manque (❓), ex. « ligne 2 prix 15000 ».";
    const warn = d.lines.some((l) => l.toConfirm.length > 0 && l.price && l.qty) ? "\n⚠️ = déduit ou lu sur une photo : vérifie." : "";
    return `${head}\n\n${lines}\n\n${extra}${warn}\n\n${action}`;
  },
  askBusinessName: "Sous quel nom veux-tu que ce document parte ? (ex. « Soudure Kossi »)",
  businessNameSaved: (name) => `C'est noté : tes documents partiront au nom de « ${name} ».`,
  missing: (items) => `Il manque encore :\n${items.map((i) => `• ${i}`).join("\n")}`,
  missingItem: {
    no_lines: "au moins une ligne",
    missing_quantity: "une quantité (❓)",
    missing_price: "un prix (❓)",
    missing_business_name: "le nom de ton entreprise",
  },
  issued: (t, n) => `✅ ${t} ${n} émis. Je prépare le PDF…`,
  delivered: (t, n, link) => `Voici ton ${t.toLowerCase()} ${n}.\n\nLien à transférer à ton client (il pourra l'accepter en ligne) :\n${link}`,
  pdfCaption: (t, n) => `${t} ${n}`,
  previewCaption: (t, n, total) => `${t} ${n} — ${total}`,
  cancelled: "Brouillon supprimé. Envoie une nouvelle vente quand tu veux.",
  nothingToCancel: "Il n'y a pas de brouillon en cours.",
  nothingToIssue: "Il n'y a pas de brouillon à émettre. Envoie d'abord ta vente.",
  notUnderstood: "Je n'ai pas compris. Envoie ta vente, ou écris « aide ».",
  readFailed: "Je n'ai pas réussi à lire ce message. Réessaie, ou écris la vente en texte.",
  readEmpty: "Je n'ai trouvé aucune ligne de vente. Exemple : « 2 portes à 45000, pose 10000 ».",
  transcribeFailed: "Je n'ai pas bien entendu ce vocal. Peux-tu le refaire, ou l'écrire ?",
  readingUnavailable: "La lecture automatique est indisponible pour l'instant : écris tes lignes, ex. « 2 portes à 45000 ».",
  quotaExhausted: (link) => `Tu as utilisé tous tes documents de la période. Ton brouillon est gardé.\nPour continuer, active l'abonnement ici :\n${link}`,
  quotaWarning: (r) => `ℹ️ Il te reste ${r} document${r > 1 ? "s" : ""} sur ta période.`,
  portalLink: (link, minutes) => `Ton espace Firmo (logo, couleur, coordonnées, documents) :\n${link}\nCe lien est valable ${minutes} minutes et ne sert qu'une fois.`,
  list: (items) => `Tes derniers documents :\n${items.map((i) => `• ${i.number ?? "brouillon"} — ${i.type}${i.client ? ` — ${i.client}` : ""} — ${i.total} (${i.status})`).join("\n")}`,
  listEmpty: "Tu n'as encore aucun document. Envoie ta première vente !",
  converted: (n) => `Facture préparée à partir du devis ${n}.`,
  nothingToConvert: "Je n'ai pas trouvé de devis émis à transformer en facture.",
  paymentRecorded: (a, n, b, paid) => (paid ? `💰 Paiement de ${a} noté : la facture ${n} est soldée.` : `💰 Paiement de ${a} noté sur ${n}. Reste à payer : ${b}.`) + "\nÉcris « reçu » pour envoyer un reçu.",
  noInvoice: "Je n'ai pas trouvé de facture à régler. Précise le numéro, ex. « payé 50000 FAC-2026-0003 ».",
  receiptIssued: (n) => `🧾 Reçu ${n} émis. Je prépare le PDF…`,
  noPayment: "Aucun paiement noté pour faire un reçu. Écris d'abord « payé 50000 ».",
  decision: (n, ok) => (ok ? `👍 ${n} noté comme accepté. Écris « facture » pour la préparer.` : `${n} noté comme refusé.`),
  noQuote: "Je n'ai pas trouvé ce devis.",
  status: {
    draft: "brouillon", issued: "émis", accepted: "accepté", refused: "refusé",
    partially_paid: "acompte", paid: "payé", cancelled: "annulé", replaced: "remplacé",
  },
  buttons: { issue: "✅ Émettre", edit: "✏️ Corriger", cancel: "🗑️ Annuler", documents: "📂 Documents", settings: "⚙️ Réglages" },
  editHint: "Dis-moi quoi changer, ex. « ligne 2 prix 15000 », « enlève la 3 », « client Hôtel du Lac ».",
  lineNotFound: (n) => `Il n'y a pas de ligne ${n}.`,
  discountLabel: "Remise",
  invalidValue: (raw) => `Je n'ai pas compris la valeur « ${raw} ». Écris-la en chiffres, ex. 15000.`,
  updated: "C'est corrigé.",
  error: "Un problème est survenu de mon côté. Réessaie dans un instant.",
  revised: (n) => `${n} est déjà émis : j'en ai fait un nouveau brouillon que tu peux corriger.`,
  typeChanged: (l) => `C'est maintenant : ${l}.`,
  subscriptionActive: (q, until) => `🎉 Merci ! Ton abonnement est actif jusqu'au ${until} : ${q} documents. Envoie ta prochaine vente.`,
  subscriptionFailed: "Le paiement de ton abonnement n'a pas abouti. Tu peux réessayer depuis ton espace (« réglages »).",
};

const en: ChatWords = {
  welcome: (name) =>
    `Hello${name ? ` ${name}` : ""} 👋 I'm Firmo.\nSend me your sale by voice, text or a photo of your paper quote: I'll send back a professional document.\n\nThe figures are yours, the presentation is mine: I never touch your prices.`,
  help:
    "How it works:\n1. Send your sale (voice, text or photo).\n2. I show what I read; fix it if needed: \"line 2 price 15000\", \"remove 3\", \"client Lake Hotel\", \"discount 10%\".\n3. Reply OK: I send the PDF and a link for your client.\n\nOther commands: \"my documents\", \"invoice\" (after a quote), \"paid 50000\", \"receipt\", \"settings\".",
  draft: (d) => {
    const head = `📄 ${d.typeLabel} — draft${d.simulated ? " (simple reading)" : ""}`;
    const lines = d.lines.map((l) => lineText(l, { price: "price", qty: "qty" })).join("\n");
    const extra = [
      d.client ? `Client: ${d.client}` : null,
      d.title ? `Subject: ${d.title}` : null,
      d.discount ? `Discount: ${d.discount}` : null,
      d.tax ? `Tax: ${d.tax}` : null,
      `Total: ${d.total}${d.complete ? "" : " (incomplete)"}`,
    ].filter(Boolean).join("\n");
    const action = d.complete ? "✅ Reply OK to issue, or correct it (e.g. \"line 2 price 15000\")." : "✏️ Fill in what is missing (❓), e.g. \"line 2 price 15000\".";
    const warn = d.lines.some((l) => l.toConfirm.length > 0 && l.price && l.qty) ? "\n⚠️ = inferred or read from a photo: please check." : "";
    return `${head}\n\n${lines}\n\n${extra}${warn}\n\n${action}`;
  },
  askBusinessName: "Under which business name should this document go out? (e.g. \"Kofi Welding\")",
  businessNameSaved: (name) => `Noted: your documents will go out as "${name}".`,
  missing: (items) => `Still missing:\n${items.map((i) => `• ${i}`).join("\n")}`,
  missingItem: { no_lines: "at least one line", missing_quantity: "a quantity (❓)", missing_price: "a price (❓)", missing_business_name: "your business name" },
  issued: (t, n) => `✅ ${t} ${n} issued. Preparing the PDF…`,
  delivered: (t, n, link) => `Here is your ${t.toLowerCase()} ${n}.\n\nLink to forward to your client (they can accept it online):\n${link}`,
  pdfCaption: (t, n) => `${t} ${n}`,
  previewCaption: (t, n, total) => `${t} ${n} — ${total}`,
  cancelled: "Draft deleted. Send a new sale whenever you like.",
  nothingToCancel: "There is no draft in progress.",
  nothingToIssue: "There is no draft to issue. Send your sale first.",
  notUnderstood: "I didn't understand. Send your sale, or write \"help\".",
  readFailed: "I couldn't read this message. Try again, or type the sale.",
  readEmpty: "I found no sale lines. Example: \"2 doors at 45000, fitting 10000\".",
  transcribeFailed: "I couldn't hear this voice note well. Can you record it again, or type it?",
  readingUnavailable: "Automatic reading is unavailable right now: type your lines, e.g. \"2 doors at 45000\".",
  quotaExhausted: (link) => `You have used all documents for this period. Your draft is kept.\nTo continue, activate your subscription here:\n${link}`,
  quotaWarning: (r) => `ℹ️ ${r} document${r > 1 ? "s" : ""} left in your period.`,
  portalLink: (link, minutes) => `Your Firmo space (logo, colour, details, documents):\n${link}\nThis link is valid for ${minutes} minutes and works once.`,
  list: (items) => `Your latest documents:\n${items.map((i) => `• ${i.number ?? "draft"} — ${i.type}${i.client ? ` — ${i.client}` : ""} — ${i.total} (${i.status})`).join("\n")}`,
  listEmpty: "You have no documents yet. Send your first sale!",
  converted: (n) => `Invoice prepared from quote ${n}.`,
  nothingToConvert: "I found no issued quote to turn into an invoice.",
  paymentRecorded: (a, n, b, paid) => (paid ? `💰 Payment of ${a} recorded: invoice ${n} is fully paid.` : `💰 Payment of ${a} recorded on ${n}. Balance due: ${b}.`) + "\nWrite \"receipt\" to send a receipt.",
  noInvoice: "I found no invoice to settle. Give the number, e.g. \"paid 50000 FAC-2026-0003\".",
  receiptIssued: (n) => `🧾 Receipt ${n} issued. Preparing the PDF…`,
  noPayment: "No payment recorded yet for a receipt. Write \"paid 50000\" first.",
  decision: (n, ok) => (ok ? `👍 ${n} marked as accepted. Write "invoice" to prepare it.` : `${n} marked as declined.`),
  noQuote: "I couldn't find that quote.",
  status: { draft: "draft", issued: "issued", accepted: "accepted", refused: "declined", partially_paid: "deposit", paid: "paid", cancelled: "cancelled", replaced: "replaced" },
  buttons: { issue: "✅ Issue", edit: "✏️ Correct", cancel: "🗑️ Cancel", documents: "📂 Documents", settings: "⚙️ Settings" },
  editHint: "Tell me what to change, e.g. \"line 2 price 15000\", \"remove 3\", \"client Lake Hotel\".",
  lineNotFound: (n) => `There is no line ${n}.`,
  discountLabel: "Discount",
  invalidValue: (raw) => `I didn't understand the value "${raw}". Write it in figures, e.g. 15000.`,
  updated: "Done.",
  error: "Something went wrong on my side. Please try again shortly.",
  revised: (n) => `${n} is already issued: I made a new draft you can correct.`,
  typeChanged: (l) => `It is now: ${l}.`,
  subscriptionActive: (q, until) => `🎉 Thank you! Your subscription is active until ${until}: ${q} documents. Send your next sale.`,
  subscriptionFailed: "Your subscription payment did not go through. You can try again from your space (\"settings\").",
};

export function chatWords(locale: string): ChatWords {
  return locale.startsWith("en") ? en : fr;
}
