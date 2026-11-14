// Vocabulaire imprimé sur les documents (DOC-8, PARITE_V1 §2). Les libellés des types, pays et taxes
// viennent des référentiels ; ici, la structure du document validée en v1 (« Bon pour accord »,
// « Total général », « Acompte », « Solde restant »…). Voix : `docs/product/VOIX.md`.

export interface DocumentWords {
  designation: string;
  qty: string;
  unitPrice: string;
  amount: string;
  section: string;
  recipient: string;
  frame: string;
  object: string;
  issuedOn: string;
  validity: string;
  delivery: string;
  site: string;
  warranty: string;
  /** Document d'origine selon son type (« Issu du devis »). */
  origin: (sourceType: string | null) => string;
  subtotalOf: (title: string | null) => string;
  itemsTotal: string;
  tax: (label: string, percent: string) => string;
  adjustment: (label: string, percent: string | null) => string;
  deposit: (percent: string) => string;
  balanceAfterDeposit: string;
  paid: (method: string | null) => string;
  paidTotal: string;
  balance: string;
  conditions: string;
  assumptions: string;
  payment: string;
  /** Libellé du total général, du pied de signature, selon le type et l'état. */
  totalLabel: (type: string, opts: { tax: boolean; paid: boolean }) => string;
  signature: (type: string, opts: { paid: boolean; date: string | null }) => { label: string; hint: string };
  issuer: string;
  draftMark: string;
  qr: string;
  days: (n: number) => string;
  words: (docType: string, words: string, currencyName: string) => string;
  receiptLine: (invoice: string) => string;
  clientLegalId: (value: string) => string;
}

const fr: DocumentWords = {
  designation: "DÉSIGNATION",
  qty: "QTÉ",
  unitPrice: "PRIX UNIT.",
  amount: "MONTANT",
  section: "SECTION",
  recipient: "DESTINATAIRE",
  frame: "CADRE",
  object: "OBJET",
  issuedOn: "Émis le",
  validity: "Validité",
  delivery: "Délai",
  site: "Chantier",
  warranty: "Garantie",
  origin: (t) => (t === "quote" ? "Issu du devis" : t === "proforma" ? "Issu de la proforma" : t === "invoice" ? "Facture" : "Document source"),
  subtotalOf: (title) => `SOUS-TOTAL ${title ? title.toUpperCase() : "POSTES"}`,
  itemsTotal: "Sous-total",
  tax: (label, p) => `${label} (${p} %)`,
  adjustment: (label, p) => (p ? `${label} (${p} %)` : label),
  deposit: (p) => `Acompte (${p} %)`,
  balanceAfterDeposit: "Solde restant",
  paid: (m) => (m ? `Payé · ${m}` : "Payé"),
  paidTotal: "Total payé",
  balance: "Solde restant",
  conditions: "CONDITIONS",
  assumptions: "HYPOTHÈSES",
  payment: "RÈGLEMENT",
  totalLabel: (type, { tax, paid }) => {
    if (type === "invoice") return paid ? "TOTAL FACTURÉ" : "NET À PAYER";
    if (type === "receipt") return "MONTANT REÇU";
    return tax ? "TOTAL TTC" : "TOTAL GÉNÉRAL";
  },
  signature: (type, { paid, date }) => {
    if (type === "invoice") {
      return paid
        ? { label: "FACTURE ACQUITTÉE", hint: date ? `Règlement intégral reçu le ${date}` : "Règlement intégral reçu" }
        : { label: "RÉCEPTION DU DOCUMENT", hint: "Date, nom et signature du client" };
    }
    if (type === "receipt") return { label: "REÇU PAR", hint: "Signature de l'émetteur" };
    if (type === "delivery_note") return { label: "RÉCEPTION DE LA LIVRAISON", hint: "Date, nom et signature du client" };
    return { label: "BON POUR ACCORD", hint: "Date, nom et signature du client" };
  },
  issuer: "ÉMETTEUR",
  draftMark: "APERÇU · BROUILLON",
  qr: "VÉRIFIER EN LIGNE",
  days: (n) => `${n} jour${n > 1 ? "s" : ""}`,
  words: (t, w, c) => `Arrêté le présent document (${t.toLowerCase()}) à la somme de ${w} ${c}.`,
  receiptLine: (inv) => `Règlement de la facture ${inv}`,
  clientLegalId: (v) => `N° fiscal ${v}`,
};

const en: DocumentWords = {
  designation: "DESCRIPTION",
  qty: "QTY",
  unitPrice: "UNIT PRICE",
  amount: "AMOUNT",
  section: "SECTION",
  recipient: "BILL TO",
  frame: "TERMS",
  object: "SUBJECT",
  issuedOn: "Issued on",
  validity: "Valid for",
  delivery: "Lead time",
  site: "Site",
  warranty: "Warranty",
  origin: (t) => (t === "quote" ? "From quote" : t === "proforma" ? "From pro forma" : t === "invoice" ? "Invoice" : "Source document"),
  subtotalOf: (title) => `SUBTOTAL ${title ? title.toUpperCase() : "ITEMS"}`,
  itemsTotal: "Subtotal",
  tax: (label, p) => `${label} (${p}%)`,
  adjustment: (label, p) => (p ? `${label} (${p}%)` : label),
  deposit: (p) => `Deposit (${p}%)`,
  balanceAfterDeposit: "Balance",
  paid: (m) => (m ? `Paid · ${m}` : "Paid"),
  paidTotal: "Total paid",
  balance: "Balance due",
  conditions: "TERMS",
  assumptions: "ASSUMPTIONS",
  payment: "PAYMENT",
  totalLabel: (type, { tax, paid }) => {
    if (type === "invoice") return paid ? "TOTAL INVOICED" : "AMOUNT DUE";
    if (type === "receipt") return "AMOUNT RECEIVED";
    return tax ? "TOTAL INCL. TAX" : "GRAND TOTAL";
  },
  signature: (type, { paid, date }) => {
    if (type === "invoice") {
      return paid
        ? { label: "PAID IN FULL", hint: date ? `Full payment received on ${date}` : "Full payment received" }
        : { label: "RECEIVED BY", hint: "Date, name and client signature" };
    }
    if (type === "receipt") return { label: "RECEIVED BY", hint: "Issuer signature" };
    if (type === "delivery_note") return { label: "GOODS RECEIVED", hint: "Date, name and client signature" };
    return { label: "ACCEPTED", hint: "Date, name and client signature" };
  },
  issuer: "ISSUER",
  draftMark: "PREVIEW · DRAFT",
  qr: "VERIFY ONLINE",
  days: (n) => `${n} day${n > 1 ? "s" : ""}`,
  words: (_t, w, c) => `Amount in words: ${w} ${c}.`,
  receiptLine: (inv) => `Payment of invoice ${inv}`,
  clientLegalId: (v) => `Tax ID ${v}`,
};

export function documentWords(locale: string): DocumentWords {
  return locale.startsWith("en") ? en : fr;
}

/** Date ISO → date du document : 08.08.2026 (format validé en v1, lisible partout). */
export function formatDate(iso: string, _locale: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
