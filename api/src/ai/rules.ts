import type { AiCall, AiReader, Interpretation, ReadContext, ReadLine, SaleReading } from "./types.js";

// Lecture simplifiée, sans IA (constitution IV : service indisponible → simulateur signalé).
// Comprend les ventes écrites simplement : « 2 portes à 45000, pose 10000 ».

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^(m2|m²|metres? carres?|mètres? carrés?)$/i, "m2"],
  [/^(m3|m³|metres? cubes?|mètres? cubes?)$/i, "m3"],
  [/^(ml|metres? lineaires?|mètres? linéaires?)$/i, "lm"],
  [/^(m|metres?|mètres?)$/i, "m"],
  [/^(kg|kilos?|kilogrammes?)$/i, "kg"],
  [/^(t|tonnes?)$/i, "t"],
  [/^(l|litres?)$/i, "l"],
  [/^(h|heures?|hours?)$/i, "h"],
  [/^(j|jours?|days?)$/i, "day"],
  [/^(sacs?|bags?)$/i, "bag"],
  [/^(voyages?|trips?)$/i, "trip"],
  [/^(lots?)$/i, "lot"],
  [/^(forfaits?|lump ?sum)$/i, "lump_sum"],
];

function unitOf(word: string | undefined): string | null {
  if (!word) return null;
  return UNIT_WORDS.find(([re]) => re.test(word.trim()))?.[1] ?? null;
}

const AMOUNT = String.raw`(\d[\d\s.,']*(?:\s?(?:k|mille|millions?))?)\s*(?:f\s?cfa|fcfa|cfa|francs?|f|€|\$)?`;

export function readSimple(text: string): SaleReading {
  const segments = text
    // Virgule suivie d'un espace : séparateur de lignes (« 45,000 » reste un montant).
    .split(/\n|;|,\s+|\bet\b(?=\s*\d)|\+/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: ReadLine[] = [];
  for (const seg of segments) {
    // « 2 portes à 45000 », « 3 m2 carrelage à 8000 », « 4 sacs de ciment x 5000 »
    const unitPrice = new RegExp(String.raw`^(\d+(?:[.,]\d{1,3})?)\s+(?:(m2|m²|m3|m³|ml|m|kg|t|l|h|j|sacs?|voyages?|jours?|heures?|litres?|lots?|forfaits?)\b\s*(?:de\s+)?)?(.+?)\s+(?:a|à|@|x|au prix de|prix)\s+${AMOUNT}\s*(?:l'unite|l'unité|chacune?|piece|pièce|each)?$`, "i").exec(seg);
    if (unitPrice) {
      lines.push({ label: unitPrice[3]!.trim(), quantityText: unitPrice[1]!, unit: unitOf(unitPrice[2]) ?? "unit", unitPriceText: unitPrice[4]!.trim(), lineTotalText: null });
      continue;
    }
    // « 3 portes pour 150000 » : montant total de la ligne.
    const total = new RegExp(String.raw`^(\d+(?:[.,]\d{1,3})?)\s+(.+?)\s+(?:pour|=|:|total)\s+${AMOUNT}$`, "i").exec(seg);
    if (total) {
      lines.push({ label: total[2]!.trim(), quantityText: total[1]!, unit: "unit", unitPriceText: null, lineTotalText: total[3]!.trim() });
      continue;
    }
    // « pose 60000 », « main d'œuvre : 25 000 » : forfait.
    const lump = new RegExp(String.raw`^([^\d].*?)\s*[:=-]?\s+${AMOUNT}$`, "i").exec(seg);
    if (lump) {
      lines.push({ label: lump[1]!.trim(), quantityText: null, unit: null, unitPriceText: null, lineTotalText: lump[2]!.trim() });
      continue;
    }
    // « 2 portes » : quantité sans prix (à demander).
    const qtyOnly = /^(\d+(?:[.,]\d{1,3})?)\s+([^\d].+)$/.exec(seg);
    if (qtyOnly) {
      lines.push({ label: qtyOnly[2]!.trim(), quantityText: qtyOnly[1]!, unit: "unit", unitPriceText: null, lineTotalText: null });
    }
  }
  const client = /\b(?:pour|client)\s*:?\s+([A-ZÀ-Ý][\w'À-ÿ-]*(?:\s+[A-ZÀ-Ý][\w'À-ÿ-]*){0,4})/.exec(text)?.[1] ?? null;
  const documentType = /\bfacture\b|\binvoice\b/i.test(text) ? "invoice" : /\bproforma\b/i.test(text) ? "proforma" : null;
  return { documentType, clientName: client, title: null, lines };
}

/** Lecteur sans IA : texte seulement, signalé comme « lecture simplifiée ». */
export function rulesReader(): AiReader {
  const usage = (started: number) => ({ model: "regles", durationMs: Date.now() - started });
  return {
    simulated: true,
    async transcribe(): Promise<AiCall<string | null>> {
      return { value: null, usage: { model: "aucun", durationMs: 0 } };
    },
    async readText(text: string, _ctx: ReadContext): Promise<AiCall<SaleReading>> {
      const started = Date.now();
      return { value: readSimple(text), usage: usage(started) };
    },
    async readImage(): Promise<AiCall<SaleReading>> {
      return { value: { documentType: null, clientName: null, title: null, lines: [] }, usage: { model: "aucun", durationMs: 0 } };
    },
    async interpret(): Promise<AiCall<Interpretation>> {
      return { value: { action: "other", ops: [] }, usage: { model: "regles", durationMs: 0 } };
    },
  };
}
