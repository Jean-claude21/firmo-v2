import { parseAmount, parseQuantity } from "../documents/money.js";
import type { LineInput } from "../documents/store.js";
import { parseFrenchNumber } from "../documents/words.js";
import type { ReadLine } from "./types.js";

// Garde anti-invention (constitution II) : une valeur lue n'est acceptée que si elle figure dans
// la source (texte ou transcription). Sinon elle devient « à demander ». Pour une photo, la source
// n'est pas vérifiable : les valeurs lues sont marquées « à confirmer ».

/** Tous les nombres présents dans un texte, en valeurs entières (chiffres et lettres). */
export function numbersIn(source: string): Set<string> {
  const found = new Set<string>();
  const text = source.toLowerCase().replace(/ | /g, " ");
  // Chiffres, avec séparateurs de milliers, décimales et suffixes (k, mille, million).
  const re = /\d{1,3}(?:[ .,']\d{3})+(?:[.,]\d+)?\s*(?:k|mille|million|millions)?|\d+(?:[.,]\d+)?\s*(?:k|mille|million|millions)?/g;
  for (const m of text.matchAll(re)) {
    for (const minor of [0, 2]) {
      const v = parseAmount(m[0].trim(), minor);
      if (v !== null) found.add(minor === 0 ? v.toString() : `${v}/100`);
    }
    const q = parseQuantity(m[0].trim());
    if (q) found.add(`q:${q}`);
  }
  // Nombres dits en lettres (« quinze mille »).
  const words = text.match(/(?:\b(?:zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?|et)\b[\s-]*)+/g) ?? [];
  for (const w of words) {
    const v = parseFrenchNumber(w);
    if (v !== null) found.add(v.toString());
  }
  return found;
}

function present(found: Set<string>, minor: bigint, minorUnits: number): boolean {
  if (minorUnits === 0) return found.has(minor.toString());
  const factor = 10n ** BigInt(minorUnits);
  // Montant dit en unités majeures entières, ou avec décimales.
  return (minor % factor === 0n && found.has((minor / factor).toString())) || found.has(`${minor * (100n / factor)}/100`);
}

export interface GuardResult {
  lines: LineInput[];
  /** Valeurs rejetées car absentes de la source (pour la mesure). */
  rejected: number;
}

/**
 * Lignes lues → lignes de brouillon. `source` : texte ou transcription (null pour une photo).
 * Règles : quantité absente + montant seul → forfait de 1 ; total + quantité sans prix → prix
 * unitaire seulement si la division tombe juste (à confirmer) ; jamais d'arrondi.
 */
export function guardLines(read: ReadLine[], source: string | null, minorUnits: number, units: Set<string>): GuardResult {
  const found = source !== null ? numbersIn(source) : null;
  let rejected = 0;
  const lines: LineInput[] = [];
  for (const r of read) {
    const label = r.label.trim().slice(0, 300);
    if (!label) continue;
    const toConfirm = new Set<"label" | "quantity" | "unit" | "unit_price">();
    let unit = r.unit && units.has(r.unit) ? r.unit : null;

    let quantity: string | null = r.quantityText ? parseQuantity(r.quantityText.replace(/[^\d.,]/g, "")) : null;
    if (quantity && found && !found.has(`q:${quantity}`) && !(quantity === "1" && /\b(un|une|1)\b/i.test(source ?? ""))) {
      quantity = null;
      rejected++;
    }
    let price: bigint | null = r.unitPriceText ? amountFromUser(r.unitPriceText, minorUnits) : null;
    if (price !== null && found && !present(found, price, minorUnits)) {
      price = null;
      rejected++;
    }
    const total: bigint | null = r.lineTotalText ? amountFromUser(r.lineTotalText, minorUnits) : null;
    const totalOk = total !== null && (!found || present(found, total, minorUnits));
    if (total !== null && !totalOk) rejected++;

    if (price === null && totalOk && total !== null) {
      if (!quantity) {
        // « pose 60 000 » : un forfait.
        quantity = "1";
        unit = unit ?? (units.has("lump_sum") ? "lump_sum" : null);
        price = total;
      } else {
        const q = Number(quantity);
        const scaled = Math.round(q * 1000);
        if (Number.isInteger(q * 1000) && (total * 1000n) % BigInt(scaled) === 0n) {
          price = (total * 1000n) / BigInt(scaled);
          toConfirm.add("unit_price");
        }
      }
    }
    if (price !== null && !quantity) {
      // « portail 450 000 » : prix donné sans quantité → 1, à vérifier par l'artisan.
      quantity = "1";
      toConfirm.add("quantity");
    }
    if (source === null) {
      if (quantity) toConfirm.add("quantity");
      if (price !== null) toConfirm.add("unit_price");
    }
    lines.push({
      label,
      quantity,
      unit,
      unitPriceMinor: price !== null ? price.toString() : null,
      toConfirm: [...toConfirm],
      source: "read",
    });
  }
  return { lines, rejected };
}

/**
 * Montant écrit ou dit → unités mineures, ou null. Accepte un mot autour du nombre
 * (« 35000 chacune », « environ 15 000 F ») et les nombres en lettres (« quinze mille »).
 */
export function amountFromUser(text: string, minorUnits: number): bigint | null {
  const direct = parseAmount(text, minorUnits);
  if (direct !== null) return direct;
  const tokens = text.toLowerCase().match(/\d{1,3}(?:[ .,']\d{3})+(?:[.,]\d+)?(?:\s*(?:k|mille|millions?)\b)?|\d+(?:[.,]\d+)?(?:\s*(?:k|mille|millions?)\b)?/g) ?? [];
  if (tokens.length === 1) {
    const v = parseAmount(tokens[0]!.trim(), minorUnits);
    if (v !== null) return v;
  }
  if (tokens.length > 1) return null; // plusieurs nombres : ambigu, on demande.
  const words = text.toLowerCase().match(/(?:\b(?:zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?|et)\b[\s-]*)+/g) ?? [];
  if (words.length !== 1) return null;
  const v = parseFrenchNumber(words[0]!);
  return v === null ? null : v * 10n ** BigInt(minorUnits);
}
