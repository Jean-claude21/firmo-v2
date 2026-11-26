// Contenu des exemples de la page Formats (P-67). Des documents d'exemple, présentés comme tels sur
// la page ; montants en unités majeures, convertis selon la devise du pays par défaut.

export type FormatScenario = "express" | "detaille" | "professionnel" | "facture";

export interface FormatWords {
  issuer: { name: string; trade: string; phone: string };
  client: { name: string; phone: string };
  title: Record<FormatScenario, string>;
  site: string;
  delivery: string;
  warranty: string;
  condition: string;
  express: { label: string; amount: number };
  supplies: { title: string; lines: Array<{ label: string; description?: string; quantity: string; unit: string; price: number }> };
  install: { title: string; lines: Array<{ label: string; quantity: string; unit: string; price: number }> };
  labor: { label: string; amount: number };
  transport: { label: string; amount: number };
  discount: { label: string; percent: number };
  depositPercent: number;
}

const fr: FormatWords = {
  issuer: { name: "Atelier Exemple", trade: "Climatisation · Électricité", phone: "+000 00 00 00 00" },
  client: { name: "Hôtel Les Palmiers", phone: "+000 11 22 33 44" },
  title: {
    express: "Réparation d'un climatiseur",
    detaille: "Fourniture de matériel électrique",
    professionnel: "Climatisation des chambres du 1er étage",
    facture: "Climatisation des chambres du 1er étage",
  },
  site: "Bâtiment principal, 1er étage",
  delivery: "15 jours après acompte",
  warranty: "12 mois pièces et main-d'œuvre",
  condition: "Livraison après validation de l'acompte.",
  express: { label: "Réparation et recharge de gaz d'un climatiseur split", amount: 85000 },
  supplies: {
    title: "Fournitures",
    lines: [
      { label: "Climatiseur split 12 000 BTU", description: "Classe énergétique A, télécommande fournie", quantity: "6", unit: "unité", price: 245000 },
      { label: "Tuyau cuivre isolé 1/4 - 3/8", quantity: "48", unit: "m", price: 4500 },
      { label: "Goulotte PVC 60 × 40", quantity: "30", unit: "m", price: 2500 },
    ],
  },
  install: {
    title: "Installation",
    lines: [
      { label: "Support mural renforcé", quantity: "6", unit: "unité", price: 12000 },
      { label: "Mise en service et essais", quantity: "6", unit: "unité", price: 8000 },
    ],
  },
  labor: { label: "Pose et configuration", amount: 180000 },
  transport: { label: "Transport", amount: 25000 },
  discount: { label: "Remise commerciale", percent: 5 },
  depositPercent: 30,
};

const en: FormatWords = {
  ...fr,
  issuer: { name: "Example Workshop", trade: "Air conditioning · Electrical", phone: "+000 00 00 00 00" },
  client: { name: "Palm Tree Hotel", phone: "+000 11 22 33 44" },
  title: {
    express: "Air conditioner repair",
    detaille: "Supply of electrical equipment",
    professionnel: "Air conditioning of first-floor rooms",
    facture: "Air conditioning of first-floor rooms",
  },
  site: "Main building, 1st floor",
  delivery: "15 days after deposit",
  warranty: "12 months parts and labour",
  condition: "Delivery after the deposit is confirmed.",
  express: { label: "Repair and gas refill of a split air conditioner", amount: 85000 },
  supplies: {
    title: "Supplies",
    lines: [
      { label: "Split air conditioner 12,000 BTU", description: "Energy class A, remote included", quantity: "6", unit: "unit", price: 245000 },
      { label: "Insulated copper pipe 1/4 - 3/8", quantity: "48", unit: "m", price: 4500 },
      { label: "PVC trunking 60 × 40", quantity: "30", unit: "m", price: 2500 },
    ],
  },
  install: {
    title: "Installation",
    lines: [
      { label: "Reinforced wall bracket", quantity: "6", unit: "unit", price: 12000 },
      { label: "Commissioning and tests", quantity: "6", unit: "unit", price: 8000 },
    ],
  },
  labor: { label: "Installation and setup", amount: 180000 },
  transport: { label: "Transport", amount: 25000 },
  discount: { label: "Commercial discount", percent: 5 },
};

export function formatWords(locale: string): FormatWords {
  return locale.startsWith("en") ? en : fr;
}
