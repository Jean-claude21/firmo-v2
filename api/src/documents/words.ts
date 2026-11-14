// Montant en lettres (DOC-8) et lecture des nombres dits en lettres (« quinze mille »).
// Français et anglais ; une autre langue retombe sur le français.

const FR_UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const FR_TENS = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante", "soixante", "quatre-vingt", "quatre-vingt"];

function frBelow100(n: number): string {
  if (n < 20) return FR_UNITS[n] ?? "";
  const ten = Math.floor(n / 10);
  const unit = n % 10;
  if (ten === 7 || ten === 9) {
    const rest = 10 + unit;
    const join = ten === 7 && unit === 1 ? " et " : "-";
    return `${FR_TENS[ten]}${join}${FR_UNITS[rest]}`;
  }
  if (unit === 0) return ten === 8 ? "quatre-vingts" : (FR_TENS[ten] ?? "");
  if (unit === 1 && ten !== 8) return `${FR_TENS[ten]} et un`;
  return `${FR_TENS[ten]}-${FR_UNITS[unit]}`;
}

function frBelow1000(n: number, last: boolean): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  let out = "";
  if (hundred > 0) {
    out = hundred === 1 ? "cent" : `${FR_UNITS[hundred]} cent${rest === 0 && last ? "s" : ""}`;
  }
  if (rest > 0) {
    let r = frBelow100(rest);
    // « quatre-vingts » perd son s devant un autre mot (mille, million).
    if (!last && r === "quatre-vingts") r = "quatre-vingt";
    out = out ? `${out} ${r}` : r;
  }
  return out;
}

export function frenchWords(value: bigint): string {
  if (value === 0n) return "zéro";
  const scales: Array<[bigint, string, string]> = [
    [1_000_000_000n, "milliard", "milliards"],
    [1_000_000n, "million", "millions"],
    [1_000n, "mille", "mille"],
  ];
  let n = value;
  const parts: string[] = [];
  for (const [size, one, many] of scales) {
    const count = n / size;
    n %= size;
    if (count === 0n) continue;
    if (size === 1_000n) {
      parts.push(count === 1n ? "mille" : `${frenchWords(count).replace(/s$/, "")} mille`);
    } else {
      parts.push(`${frenchWords(count)} ${count === 1n ? one : many}`);
    }
  }
  if (n > 0n) parts.push(frBelow1000(Number(n), true));
  return parts.join(" ");
}

const EN_UNITS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function enBelow1000(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${EN_UNITS[hundred]} hundred`);
  if (rest) {
    parts.push(rest < 20 ? (EN_UNITS[rest] ?? "") : `${EN_TENS[Math.floor(rest / 10)]}${rest % 10 ? `-${EN_UNITS[rest % 10]}` : ""}`);
  }
  return parts.join(" and ");
}

export function englishWords(value: bigint): string {
  if (value === 0n) return "zero";
  const scales: Array<[bigint, string]> = [
    [1_000_000_000n, "billion"],
    [1_000_000n, "million"],
    [1_000n, "thousand"],
  ];
  let n = value;
  const parts: string[] = [];
  for (const [size, name] of scales) {
    const count = n / size;
    n %= size;
    if (count > 0n) parts.push(`${englishWords(count)} ${name}`);
  }
  if (n > 0n) parts.push(enBelow1000(Number(n)));
  return parts.join(" ");
}

/** Montant mineur → lettres : « quinze mille » ; décimales : « … et cinquante centimes » (fr). */
export function amountInWords(minor: bigint, minorUnits: number, locale: string): string {
  const factor = 10n ** BigInt(minorUnits);
  const major = minor / factor;
  const fraction = minor % factor;
  const en = locale.startsWith("en");
  const words = en ? englishWords : frenchWords;
  const main = words(major);
  if (minorUnits === 0 || fraction === 0n) return main;
  return en
    ? `${main} and ${fraction.toString().padStart(minorUnits, "0")}/${factor}`
    : `${main} et ${words(fraction)} centimes`;
}

// ---------------------------------------------------------------- lecture (fr)

const FR_VALUES: Record<string, number> = {
  zero: 0, "zéro": 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
  neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
};

/** Nombre dit en lettres (français) → valeur, ou null. « quinze mille », « deux cent cinquante ». */
export function parseFrenchNumber(text: string): bigint | null {
  const tokens = text
    .toLowerCase()
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t && t !== "et");
  if (tokens.length === 0) return null;
  let total = 0n;
  let current = 0n;
  let seen = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] as string;
    if (t === "quatre" && (tokens[i + 1] === "vingt" || tokens[i + 1] === "vingts")) {
      current += 80n;
      i++;
      seen = true;
      continue;
    }
    if (t in FR_VALUES) {
      current += BigInt(FR_VALUES[t] as number);
      seen = true;
    } else if (t === "cent" || t === "cents") {
      current = (current === 0n ? 1n : current) * 100n;
      seen = true;
    } else if (t === "mille" || t === "mil") {
      total += (current === 0n ? 1n : current) * 1000n;
      current = 0n;
      seen = true;
    } else if (t === "million" || t === "millions") {
      total += (current === 0n ? 1n : current) * 1_000_000n;
      current = 0n;
      seen = true;
    } else if (t === "milliard" || t === "milliards") {
      total += (current === 0n ? 1n : current) * 1_000_000_000n;
      current = 0n;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + current : null;
}
