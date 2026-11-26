import type { AiCall, AiReader, ReadContext, ReadLine, SaleReading, TurnContext, TurnDecision } from "./types.js";

// Lecture simplifiée, sans IA (constitution IV : service indisponible → simulé et signalé ; v1 :
// « le mode dégradé est réel »). Comprend les ventes écrites simplement (« 2 portes à 45000, pose
// 10000 ») et le format de secours annoncé dans le chat : « quantité | libellé | prix ».

const AMOUNT = String.raw`(\d[\d\s.,']*(?:\s?(?:k|mille|millions?))?)\s*(?:f\s?cfa|fcfa|cfa|francs?|f|€|\$)?`;
const UNIT = String.raw`(m2|m²|m3|m³|ml|m[eè]tres?|m|kg|t|l|h|j|sacs?|voyages?|jours?|heures?|litres?|lots?|forfaits?|barres?|boites?|boîtes?|feuilles?|pieces?|pièces?|unites?|unités?)`;

/** « 3 | Barre tube 80 x 40 | 17 000 », « forfait | Pose | 60 000 » (format de secours). */
function readPipe(seg: string): ReadLine | null {
  const parts = seg.split("|").map((p) => p.trim());
  if (parts.length !== 3) return null;
  const [qty, label, price] = parts as [string, string, string];
  if (!label) return null;
  if (/^\d+(?:[.,]\d{1,3})?$/.test(qty)) {
    return { label, quantityText: qty, unit: null, unitPriceText: price || null, lineTotalText: null };
  }
  return { label, quantityText: null, unit: null, unitPriceText: null, lineTotalText: price || null };
}

export function readSimple(text: string): SaleReading {
  const segments = text
    // Virgule suivie d'un espace : séparateur de lignes (« 45,000 » reste un montant).
    .split(/\n|;|,\s+|\bet\b(?=\s*\d)|\+(?![^|]*\|)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const lines: ReadLine[] = [];
  const adjustments: SaleReading["adjustments"] = [];
  for (const raw of segments) {
    // « Devis pour la Clinique Saint-Luc : 3 climatiseurs à 285000 » : l'en-tête (type, client) est
    // retiré avant de lire la ligne ; le client est repris plus bas.
    const header = /^([^\d|:]*\b(?:devis|facture|proforma|pour|client|quote|invoice)\b[^\d|:]*):\s*(.+)$/i.exec(raw);
    const seg = header ? header[2]!.trim() : raw;
    const pipe = seg.includes("|") ? readPipe(seg) : null;
    if (pipe) {
      lines.push(pipe);
      continue;
    }
    // « main d'œuvre 30 % », « remise 10% » : ajustement en pourcentage (dit explicitement).
    const pct = /^(.+?)\s*:?\s*(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:%|pour\s*cent)$/i.exec(seg);
    if (pct) {
      const label = pct[1]!.trim();
      adjustments.push({ label, mode: "percent", sign: /remise|r[ée]duction|rabais|discount/i.test(label) ? -1 : 1, base: "items_total", valueText: pct[2]! });
      continue;
    }
    // « 2 portes à 45000 », « 3 m2 carrelage à 8000 », « 4 sacs de ciment x 5000 »
    const unitPrice = new RegExp(String.raw`^(\d+(?:[.,]\d{1,3})?)\s+(?:${UNIT}(?=\s)\s*(?:de\s+)?)?(.+?)\s+(?:a|à|@|x|au prix de|prix)\s+${AMOUNT}\s*(?:l'unite|l'unité|chacune?|piece|pièce|each)?$`, "i").exec(seg);
    if (unitPrice) {
      lines.push({ label: unitPrice[3]!.trim(), quantityText: unitPrice[1]!, unit: unitPrice[2] ?? null, unitPriceText: unitPrice[4]!.trim(), lineTotalText: null });
      continue;
    }
    // « 3 portes pour 150000 » : montant total de la ligne.
    const total = new RegExp(String.raw`^(\d+(?:[.,]\d{1,3})?)\s+(.+?)\s+(?:pour|=|:|total)\s+${AMOUNT}$`, "i").exec(seg);
    if (total) {
      lines.push({ label: total[2]!.trim(), quantityText: total[1]!, unit: null, unitPriceText: null, lineTotalText: total[3]!.trim() });
      continue;
    }
    // « main d'œuvre 160 000 », « transport : 30 000 » : ajustement en montant ; « pose 60000 » : forfait.
    const lump = new RegExp(String.raw`^([^\d].*?)\s*[:=-]?\s+${AMOUNT}$`, "i").exec(seg);
    if (lump) {
      const label = lump[1]!.trim();
      if (/^(main[ -]d.?(?:œ|oe)uvre|transport|remise|r[ée]duction|rabais)\b/i.test(label)) {
        adjustments.push({ label, mode: "amount", sign: /remise|r[ée]duction|rabais/i.test(label) ? -1 : 1, base: "items_total", valueText: lump[2]!.trim() });
      } else {
        lines.push({ label, quantityText: null, unit: null, unitPriceText: null, lineTotalText: lump[2]!.trim() });
      }
      continue;
    }
    // « 2 portes » : quantité sans prix (à demander).
    const qtyOnly = /^(\d+(?:[.,]\d{1,3})?)\s+([^\d].+)$/.exec(seg);
    if (qtyOnly) {
      lines.push({ label: qtyOnly[2]!.trim(), quantityText: qtyOnly[1]!, unit: null, unitPriceText: null, lineTotalText: null });
    }
  }
  const client = /\b(?:pour|client)\s*:?\s+(?:(?:la|le|les|l'|du|de la)\s+)?([A-ZÀ-Ý][\w'À-ÿ-]*(?:\s+[A-ZÀ-Ý][\w'À-ÿ-]*){0,4})/.exec(text)?.[1] ?? null;
  const documentType = /\bfacture\b|\binvoice\b/i.test(text) ? "invoice" : /\bproforma\b/i.test(text) ? "proforma" : null;
  return {
    documentType,
    clientName: client,
    title: null,
    sections: lines.length ? [{ title: null, showSubtotal: false, lines }] : [],
    adjustments,
  };
}

/**
 * Décision sans IA : les commandes courantes sont déjà reconnues par `commands.ts` ; ici, une vente
 * lisible devient une source, le reste reçoit le format de secours (réponse du moteur).
 */
export function decideSimple(message: string, ctx: Pick<TurnContext, "draft">): TurnDecision {
  const base: TurnDecision = { intent: "other", corrections: [], reply: null, searchQuery: null, targetType: null, startNewDocument: false };
  const t = message.trim().toLowerCase();
  if (/^(bonjour|bonsoir|salut|hello|hi|coucou|bjr)\b/.test(t) && !/\d/.test(t)) return { ...base, intent: "greeting" };
  if (/suppression de mes donn[ée]es|delet(e|ion of) my data/.test(t)) return { ...base, intent: "delete_data" };
  if (readSimple(message).sections.length) return { ...base, intent: "source", startNewDocument: !ctx.draft };
  return base;
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
      return { value: { documentType: null, clientName: null, title: null, sections: [], adjustments: [] }, usage: { model: "aucun", durationMs: 0 } };
    },
    async decide(message: string, ctx: TurnContext): Promise<AiCall<TurnDecision>> {
      const started = Date.now();
      return { value: decideSimple(message, ctx), usage: usage(started) };
    },
  };
}
