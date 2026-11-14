import type { DocumentView } from "../../src/documents/store.js";

// Cas difficiles du rendu (constitution VII) : montants déjà calculés comme le ferait le SQL.

const XOF = { code: "XOF", minorUnits: 0, symbol: "F CFA", symbolBefore: false, thousandsSeparator: " ", decimalSeparator: "," };
const USD = { code: "USD", minorUnits: 2, symbol: "$", symbolBefore: true, thousandsSeparator: ",", decimalSeparator: "." };

const issuer = {
  name: "Soudure & Métallerie Kossi",
  trade: "Chaudronnerie, métallerie, soudure",
  phone: "+228 90 12 34 56",
  email: "contact@soudure-kossi.tg",
  address: "Rue des Artisans, Bè-Kpota, Lomé",
  country: "Togo",
  legal_ids: [
    { label: "RCCM", value: "TG-LFW-01-2024-A10-01234" },
    { label: "NIF", value: "1000123456" },
  ],
  payment_methods: "Mobile Money : +228 90 12 34 56 (Flooz, T-Money) · Espèces à la livraison",
  footer_note: "Merci pour votre confiance.",
  brand_color: "#1F3A5F",
  logo_key: null,
};

function line(position: number, label: string, qty: string, unit: string, price: number) {
  const total = Math.round(Number(qty) * price);
  return {
    position,
    label,
    quantity: qty,
    unit,
    unitLabel: unit === "unit" ? "u" : unit === "m2" ? "m²" : unit === "lump_sum" ? "forfait" : unit,
    unitPriceMinor: String(price),
    lineTotalMinor: String(total),
    toConfirm: [],
    source: "typed" as const,
  };
}

function base(overrides: Partial<DocumentView>): DocumentView {
  const lines = overrides.lines ?? [
    line(1, "Portail coulissant en tube carré 40×40, peinture antirouille", "1", "unit", 450000),
    line(2, "Grille de protection fenêtre 120×100", "4", "unit", 35000),
    line(3, "Pose et scellement", "1", "lump_sum", 60000),
  ];
  const subtotal = lines.reduce((s, l) => s + Number(l.lineTotalMinor), 0);
  return {
    id: "00000000-0000-0000-0000-000000000001",
    orgId: "org",
    type: "quote",
    typeLabel: "Devis",
    status: "issued",
    number: "DEV-2026-0042",
    title: "Portail et grilles — villa Agoè",
    notes: "Devis valable 30 jours. Acompte de 50 % à la commande.",
    locale: "fr",
    template: "classic",
    currency: XOF,
    client: { id: null, name: "Hôtel du Lac", phone: "+228 22 21 00 00", email: null, address: "Boulevard du Mono, Lomé", legalId: null },
    issuer,
    issueDate: "2026-11-14",
    validUntil: "2026-12-14",
    expired: false,
    discountBp: null,
    discountMinor: null,
    applyTax: false,
    taxLabel: null,
    taxRateBp: 0,
    subtotalMinor: String(subtotal),
    discountTotalMinor: "0",
    taxMinor: "0",
    totalMinor: String(subtotal),
    paidMinor: "0",
    sourceDocumentId: null,
    sourceNumber: null,
    revisesId: null,
    acceptable: true,
    payable: false,
    renderVersion: 1,
    sharedAt: null,
    viewedAt: null,
    decidedAt: null,
    decisionBy: null,
    decisionNote: null,
    createdAt: "2026-11-14T10:00:00.000Z",
    issuedAt: "2026-11-14T10:00:00.000Z",
    lines,
    payments: [],
    blockers: [],
    ...overrides,
  };
}

const many = Array.from({ length: 60 }, (_, i) =>
  line(i + 1, `Fourniture ${i + 1} : tôle galvanisée, découpe sur mesure et pliage`, String((i % 5) + 1), "unit", 2500 + i * 150),
);
const manyTotal = many.reduce((s, l) => s + Number(l.lineTotalMinor), 0);

export const CASES: Record<string, DocumentView> = {
  devis_simple: base({}),
  sans_logo_sans_client: base({ client: { id: null, name: null, phone: null, email: null, address: null, legalId: null }, title: null }),
  nom_tres_long: base({
    issuer: { ...issuer, name: "Établissements Kossi Frères — Menuiserie générale, charpente, coffrage et agencement intérieur" },
    lines: [line(1, "Placard trois portes coulissantes en bois rouge massif, finition vernis mat, poignées en laiton, montage et réglage compris sur site", "1.5", "m2", 185000)],
  }),
  soixante_lignes: base({ lines: many, subtotalMinor: String(manyTotal), totalMinor: String(manyTotal), template: "modern" }),
  facture_remise_taxe_acompte: base({
    type: "invoice",
    typeLabel: "Facture",
    number: "FAC-2026-0007",
    status: "partially_paid",
    validUntil: null,
    sourceNumber: "DEV-2026-0042",
    acceptable: false,
    payable: true,
    discountBp: 500,
    subtotalMinor: "650000",
    discountTotalMinor: "32500",
    applyTax: true,
    taxLabel: "TVA",
    taxRateBp: 1800,
    taxMinor: "111150",
    totalMinor: "728650",
    paidMinor: "300000",
    template: "modern",
  }),
  recu: base({
    type: "receipt",
    typeLabel: "Reçu",
    number: "REC-2026-0003",
    title: "FAC-2026-0007",
    notes: "Mobile Money",
    sourceNumber: "FAC-2026-0007",
    validUntil: null,
    acceptable: false,
    lines: [line(1, "FAC-2026-0007", "1", "unit", 300000)],
    subtotalMinor: "300000",
    totalMinor: "300000",
    template: "clean",
  }),
  anglais_dollars: base({
    locale: "en",
    typeLabel: "Quote",
    currency: USD,
    template: "clean",
    title: "Website maintenance",
    notes: null,
    lines: [line(1, "Monthly maintenance", "3", "unit", 12550), line(2, "Hosting", "1", "lump_sum", 4999)],
    subtotalMinor: "42649",
    totalMinor: "42649",
    issuer: { ...issuer, name: "Kofi Digital Services", country: "Ghana", legal_ids: [{ label: "TIN", value: "C0001234567" }], payment_methods: "Bank transfer · MoMo 024 000 0000" },
  }),
  couleur_claire_accepte: base({
    status: "accepted",
    template: "modern",
    issuer: { ...issuer, brand_color: "#F4D35E" },
  }),
};
