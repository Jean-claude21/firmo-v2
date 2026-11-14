// Argent : lecture des montants dits par l'artisan, formatage selon la devise.
// Aucun calcul de total ici (SQL) : seulement des conversions exactes texte ↔ unités mineures.

export interface Currency {
  code: string;
  minorUnits: number;
  symbol: string;
  symbolBefore: boolean;
  thousandsSeparator: string;
  decimalSeparator: string;
}

/** Montant mineur (entier, en chaîne ou bigint) → texte : « 15 000 F CFA », « $1,250.50 ». */
export function formatMoney(minor: bigint | string | number, currency: Currency, withSymbol = true): string {
  const value = BigInt(minor);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const factor = 10n ** BigInt(currency.minorUnits);
  const major = abs / factor;
  const fraction = abs % factor;
  const grouped = major.toString().replace(/\B(?=(\d{3})+(?!\d))/g, currency.thousandsSeparator);
  const number =
    currency.minorUnits > 0
      ? `${grouped}${currency.decimalSeparator}${fraction.toString().padStart(currency.minorUnits, "0")}`
      : grouped;
  const signed = negative ? `-${number}` : number;
  if (!withSymbol) return signed;
  return currency.symbolBefore ? `${currency.symbol}${signed}` : `${signed} ${currency.symbol}`;
}

/** Quantité (numeric en chaîne) → texte court : « 1,5 », « 3 ». */
export function formatQuantity(quantity: string | number, decimalSeparator = ","): string {
  const n = typeof quantity === "number" ? quantity.toString() : quantity;
  const [int, frac = ""] = n.split(".");
  const trimmed = frac.replace(/0+$/, "");
  return trimmed ? `${int}${decimalSeparator}${trimmed}` : (int ?? "0");
}

const MULTIPLIERS: Record<string, bigint> = {
  k: 1_000n,
  mille: 1_000n,
  mil: 1_000n,
  thousand: 1_000n,
  m: 1_000_000n,
  million: 1_000_000n,
  millions: 1_000_000n,
  mio: 1_000_000n,
  milliard: 1_000_000_000n,
  milliards: 1_000_000_000n,
  billion: 1_000_000_000n,
};

/**
 * Montant écrit en chiffres → unités mineures, ou null si le texte n'est pas un montant.
 * Accepte « 15 000 », « 15.000 », « 15000F », « 12,50 », « 15k », « 1,5 million », « 2 mille ».
 * Un séparateur suivi d'exactement 3 chiffres est un séparateur de milliers ; sinon décimal.
 */
export function parseAmount(text: string, minorUnits: number): bigint | null {
  const cleaned = text
    .toLowerCase()
    .replace(/ | /g, " ")
    .replace(/(f\s?cfa|fcfa|cfa|xof|xaf|francs?|euros?|eur|usd|dollars?|€|\$|₦|ksh|gh₵|dh|fg|fc|frw|f)(?![a-z])/g, " ")
    .trim();
  const match = /^(\d{1,3}(?:[ .,']\d{3})+|\d+)(?:[.,](\d+))?\s*([a-zé]+)?$/.exec(cleaned);
  if (!match) return null;
  const [, intPart = "", fracPart, word] = match;
  let multiplier = 1n;
  if (word) {
    const m = MULTIPLIERS[word];
    if (!m) return null;
    multiplier = m;
  }
  const digits = intPart.replace(/[ .,']/g, "");
  // Décimales : exactes jusqu'à la précision de la devise × multiplicateur.
  const scale = 10n ** BigInt(minorUnits);
  let value = BigInt(digits) * multiplier * scale;
  if (fracPart) {
    const fracScale = 10n ** BigInt(fracPart.length);
    const fracValue = BigInt(fracPart) * multiplier * scale;
    if (fracValue % fracScale !== 0n) return null; // plus précis que la devise : refusé, pas arrondi
    value += fracValue / fracScale;
  }
  return value;
}

/** Quantité écrite → chaîne décimale (« 1,5 » → « 1.5 »), ou null. Trois décimales au plus. */
export function parseQuantity(text: string): string | null {
  const m = /^\s*(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!m) return null;
  const value = m[2] ? `${m[1]}.${m[2]}` : (m[1] ?? "");
  return Number(value) > 0 ? value : null;
}

/** Chiffres significatifs d'un texte, pour la garde anti-invention. */
export function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/** Unités mineures → nombre majeur exact en chaîne (« 1250.5 »), pour l'IA et les formulaires. */
export function minorToMajorString(minor: bigint | string, minorUnits: number): string {
  const v = BigInt(minor);
  if (minorUnits === 0) return v.toString();
  const factor = 10n ** BigInt(minorUnits);
  const frac = (v % factor).toString().padStart(minorUnits, "0").replace(/0+$/, "");
  return frac ? `${v / factor}.${frac}` : (v / factor).toString();
}
