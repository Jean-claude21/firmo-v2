// Vocabulaire imprimé sur les documents (DOC-8). Les libellés des types, unités, pays et taxes
// viennent des référentiels ; ici, seulement la structure du document.

export interface DocumentWords {
  columns: [string, string, string, string, string, string];
  client: string;
  subject: string;
  number: string;
  date: string;
  validUntil: string;
  source: string;
  subtotal: string;
  discount: (percent: string | null) => string;
  tax: (label: string, percent: string) => string;
  total: string;
  totalDue: string;
  paid: string;
  balance: string;
  paymentMethods: string;
  notes: string;
  draft: string;
  currencyNote: (symbol: string) => string;
  words: (docType: string, words: string, symbol: string) => string;
  receipt: (invoice: string, date: string) => string;
  paidBy: (method: string) => string;
  qrCaption: string;
  generatedBy: string;
  stamps: Record<"accepted" | "refused" | "paid" | "partially_paid" | "cancelled", string>;
}

const fr: DocumentWords = {
  columns: ["N°", "Désignation", "Qté", "Unité", "Prix unitaire", "Montant"],
  client: "Client",
  subject: "Objet",
  number: "Numéro",
  date: "Date",
  validUntil: "Valable jusqu'au",
  source: "Référence",
  subtotal: "Sous-total",
  discount: (p) => (p ? `Remise (${p} %)` : "Remise"),
  tax: (label, p) => `${label} (${p} %)`,
  total: "Total",
  totalDue: "Total à payer",
  paid: "Déjà payé",
  balance: "Reste à payer",
  paymentMethods: "Moyens de paiement",
  notes: "Conditions",
  draft: "BROUILLON",
  currencyNote: (s) => `Montants en ${s}`,
  words: (t, w, s) => `Arrêté le présent document (${t.toLowerCase()}) à la somme de ${w} ${s}.`,
  receipt: (inv, d) => `Reçu le ${d}, en règlement de la facture ${inv}, la somme de :`,
  paidBy: (m) => `Moyen de paiement : ${m}`,
  qrCaption: "Vérifier en ligne",
  generatedBy: "Établi avec Firmo",
  stamps: { accepted: "ACCEPTÉ", refused: "REFUSÉ", paid: "PAYÉ", partially_paid: "ACOMPTE REÇU", cancelled: "ANNULÉ" },
};

const en: DocumentWords = {
  columns: ["#", "Description", "Qty", "Unit", "Unit price", "Amount"],
  client: "Bill to",
  subject: "Subject",
  number: "Number",
  date: "Date",
  validUntil: "Valid until",
  source: "Reference",
  subtotal: "Subtotal",
  discount: (p) => (p ? `Discount (${p}%)` : "Discount"),
  tax: (label, p) => `${label} (${p}%)`,
  total: "Total",
  totalDue: "Total due",
  paid: "Paid",
  balance: "Balance due",
  paymentMethods: "Payment methods",
  notes: "Terms",
  draft: "DRAFT",
  currencyNote: (s) => `Amounts in ${s}`,
  words: (_t, w, s) => `Amount in words: ${w} ${s}.`,
  receipt: (inv, d) => `Received on ${d}, in payment of invoice ${inv}, the sum of:`,
  paidBy: (m) => `Paid by: ${m}`,
  qrCaption: "Verify online",
  generatedBy: "Made with Firmo",
  stamps: { accepted: "ACCEPTED", refused: "DECLINED", paid: "PAID", partially_paid: "DEPOSIT RECEIVED", cancelled: "CANCELLED" },
};

export function documentWords(locale: string): DocumentWords {
  return locale.startsWith("en") ? en : fr;
}

/** Date ISO → date lisible selon la langue : 14/11/2026 ou 14 Nov 2026. */
export function formatDate(iso: string, locale: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (locale.startsWith("en")) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${Number(d)} ${months[Number(m) - 1]} ${y}`;
  }
  return `${d}/${m}/${y}`;
}
