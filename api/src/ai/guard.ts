import { parseAmount, parsePercentBp, parseQuantity } from "../documents/money.js";
import type { AdjustmentInput, DraftContent, LineInput, SectionInput, ToConfirmField } from "../documents/store.js";
import { parseFrenchNumber } from "../documents/words.js";
import type { DocumentType, ReadAdjustment, ReadLine, SaleReading } from "./types.js";

// Garde anti-invention (constitution II, règle de la v1 : « le calcul est à lui ») : une valeur
// lue n'est acceptée que si elle figure dans la source (texte ou transcription). Sinon elle
// devient « à demander ». Pour une photo, la source n'est pas vérifiable : les valeurs lues sont
// marquées « à confirmer ».

/** Tous les nombres présents dans un texte, en valeurs entières (chiffres et lettres). */
export function numbersIn(source: string): Set<string> {
  const found = new Set<string>();
  const text = source.toLowerCase().replace(/ | /g, " ");
  // Chiffres, avec séparateurs de milliers, décimales et suffixes (k, mille, million).
  const re = /\d{1,3}(?:[ .,']\d{3})+(?:[.,]\d+)?\s*(?:k|mille|million|millions)?|\d+(?:[.,]\d+)?\s*(?:k|mille|million|millions)?/g;
  for (const m of text.matchAll(re)) {
    for (const minor of [0, 2]) {
      const v = parseAmount(m[0].trim(), minor);
      if (v !== null) found.add(minor === 0 ? v.toString() : `${v}/100`);
    }
    const q = parseQuantity(m[0].trim());
    if (q) found.add(`q:${q}`);
    const p = parsePercentBp(m[0].trim());
    if (p !== null) found.add(`p:${p}`);
  }
  // Nombres dits en lettres (« quinze mille », « trente pour cent »).
  const words = text.match(/(?:\b(?:zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?|mille|millions?|milliards?|et)\b[\s-]*)+/g) ?? [];
  for (const w of words) {
    const v = parseFrenchNumber(w);
    if (v !== null) {
      found.add(v.toString());
      found.add(`q:${v}`);
      found.add(`p:${v * 100n}`);
    }
  }
  return found;
}

function present(found: Set<string>, minor: bigint, minorUnits: number): boolean {
  if (minorUnits === 0) return found.has(minor.toString());
  const factor = 10n ** BigInt(minorUnits);
  // Montant dit en unités majeures entières, ou avec décimales.
  return (minor % factor === 0n && found.has((minor / factor).toString())) || found.has(`${minor * (100n / factor)}/100`);
}

/** Vérifie une valeur recopiée par l'IA contre la source ; null si absente ou illisible. */
export interface Checker {
  /** Montant en unités mineures, présent dans la source. */
  amount(text: string | null | undefined): bigint | null;
  /** Quantité décimale (« 2.5 »), présente dans la source. */
  quantity(text: string | null | undefined): string | null;
  /** Pourcentage en centièmes de point, présent dans la source. */
  percent(text: string | null | undefined): number | null;
  /** Nombre entier (jours de validité), présent dans la source. */
  integer(text: string | null | undefined): number | null;
  /** Valeurs refusées (mesure de la fidélité). */
  rejected: number;
  /** Source vérifiable (texte) ou non (photo : tout est « à confirmer »). */
  verifiable: boolean;
}

export function checker(source: string | null, minorUnits: number): Checker {
  const found = source !== null ? numbersIn(source) : null;
  const c: Checker = {
    rejected: 0,
    verifiable: found !== null,
    amount(text) {
      if (!text) return null;
      const v = amountFromUser(text, minorUnits);
      if (v === null) return null;
      if (found && !present(found, v, minorUnits)) {
        c.rejected++;
        return null;
      }
      return v;
    },
    quantity(text) {
      if (!text) return null;
      const q = parseQuantity(text.replace(/[^\d.,]/g, "")) ?? (() => {
        const w = parseFrenchNumber(text.toLowerCase());
        return w !== null && w > 0n ? w.toString() : null;
      })();
      if (!q) return null;
      if (found && !found.has(`q:${q}`) && !(q === "1" && /\b(un|une|1)\b/i.test(source ?? ""))) {
        c.rejected++;
        return null;
      }
      return q;
    },
    percent(text) {
      if (!text) return null;
      const bp = parsePercentBp(text.replace(/pour\s*cent|percent|pourcent/gi, "%"));
      if (bp === null) return null;
      if (found && !found.has(`p:${bp}`)) {
        c.rejected++;
        return null;
      }
      return bp;
    },
    integer(text) {
      if (!text) return null;
      const m = /\d+/.exec(text);
      const n = m ? Number(m[0]) : null;
      if (n === null || !Number.isSafeInteger(n) || n <= 0) return null;
      if (found && !found.has(String(n))) {
        c.rejected++;
        return null;
      }
      return n;
    },
  };
  return c;
}

/** Unité telle que dite, nettoyée (jamais normalisée vers un code). */
function unitText(unit: string | null | undefined): string | null {
  const u = unit?.trim().slice(0, 24);
  return u ? u : null;
}

/** Majuscule initiale (v1 : capitalize_initial) ; le reste du libellé n'est jamais touché. */
export function capitalizeInitial(text: string): string {
  const t = text.trim();
  return t ? t[0]!.toLocaleUpperCase("fr") + t.slice(1) : t;
}

/**
 * Libellé propre : sans la quantité recopiée en tête (« 45 barres de tube… » avec quantité 45 →
 * « Barres de tube… »), majuscule initiale. Notation et dimensions intactes.
 */
export function cleanLabel(label: string, quantityText: string | null | undefined): string {
  let l = label.trim();
  const q = quantityText?.trim();
  if (q && l.startsWith(q) && /\s/.test(l.charAt(q.length))) l = l.slice(q.length).trim();
  return capitalizeInitial(l).slice(0, 300);
}

/** Normalisation pour comparer un texte au message (casse, accents, apostrophes, ponctuation). */
function plain(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’`]/g, "'")
    .replace(/[«»"“”.,;:!?()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Un texte recopié par l'IA (nom, objet, condition, libellé) n'est accepté que s'il figure dans le
 * message de l'artisan (v1 : chaque correction porte sa preuve mot pour mot).
 */
export function heard(value: string, message: string): boolean {
  const v = plain(value);
  return v.length > 0 && plain(message).includes(v);
}

/** Une ligne lue → ligne de brouillon, après vérification de chaque nombre. */
export function guardLine(r: ReadLine, c: Checker): LineInput | null {
  const label = cleanLabel(r.label, r.quantityText);
  if (!label) return null;
  const description = r.description?.trim().slice(0, 300) || null;
  if (r.descriptive) {
    return { label, description, kind: "text", quantity: null, unit: null, unitPriceMinor: null, source: "read" };
  }
  const toConfirm = new Set<ToConfirmField>();
  let quantity = c.quantity(r.quantityText);
  let price = c.amount(r.unitPriceText);
  const total = c.amount(r.lineTotalText);

  // Montant sans quantité (« pose 60 000 », « portail 450 000 ») : forfait de ligne.
  if (!quantity && !r.quantityText && (total !== null || price !== null)) {
    const flat = total ?? price!;
    if (!c.verifiable) toConfirm.add("flat_amount");
    return { label, description, kind: "flat", quantity: null, unit: null, unitPriceMinor: null, flatAmountMinor: flat.toString(), toConfirm: [...toConfirm], source: "read" };
  }
  // Total et quantité sans prix unitaire : prix unitaire seulement si la division tombe juste.
  if (price === null && total !== null && quantity) {
    const scaled = Math.round(Number(quantity) * 1000);
    if (Number.isInteger(Number(quantity) * 1000) && (total * 1000n) % BigInt(scaled) === 0n) {
      price = (total * 1000n) / BigInt(scaled);
      toConfirm.add("unit_price");
    }
  }
  if (!c.verifiable) {
    if (quantity) toConfirm.add("quantity");
    if (price !== null) toConfirm.add("unit_price");
  }
  if (!quantity && price !== null) quantity = null;
  return {
    label,
    description,
    kind: "priced",
    quantity,
    unit: unitText(r.unit),
    unitPriceMinor: price !== null ? price.toString() : null,
    toConfirm: [...toConfirm],
    source: "read",
  };
}

/** Compatibilité : lignes à plat. */
export function guardLines(read: ReadLine[], source: string | null, minorUnits: number): { lines: LineInput[]; rejected: number } {
  const c = checker(source, minorUnits);
  const lines = read.map((r) => guardLine(r, c)).filter((l): l is LineInput => l !== null);
  return { lines, rejected: c.rejected };
}

export function guardAdjustment(a: ReadAdjustment, c: Checker): AdjustmentInput | null {
  const label = capitalizeInitial(a.label).slice(0, 160);
  if (!label) return null;
  if (a.mode === "percent") {
    const bp = c.percent(a.valueText);
    return { label, mode: "percent", sign: a.sign, base: a.base, rateBp: bp, toConfirm: bp !== null && !c.verifiable, source: "read" };
  }
  const v = c.amount(a.valueText);
  return { label, mode: "amount", sign: a.sign, base: a.base, valueMinor: v !== null && v > 0n ? v.toString() : null, toConfirm: v !== null && !c.verifiable, source: "read" };
}

export interface GuardedReading {
  type: DocumentType | null;
  content: DraftContent;
  client: { name: string; phone: string | null; address: string | null } | null;
  lines: number;
  /** Valeurs refusées car absentes de la source. */
  rejected: number;
  /** Valeurs lues sur une photo, à confirmer. */
  toConfirm: number;
}

/** Lecture complète → contenu de brouillon vérifié (sections, ajustements, champs latents). */
export function guardReading(r: SaleReading, source: string | null, minorUnits: number): GuardedReading {
  const c = checker(source, minorUnits);
  const sections: SectionInput[] = [];
  // v1 : « la main-d'œuvre n'est pas une ligne ». Un forfait de main-d'œuvre, de transport ou une
  // remise lu comme une ligne devient un ajustement en montant (mode gardé, jamais converti).
  const moved: AdjustmentInput[] = [];
  for (const s of r.sections) {
    const lines: LineInput[] = [];
    for (const read of s.lines) {
      const line = guardLine(read, c);
      if (!line) continue;
      if (line.kind === "flat" && ADJUSTMENT_LABEL.test(line.label)) {
        moved.push({
          label: line.label, mode: "amount", sign: /^(remise|r[ée]duction|rabais)/i.test(line.label) ? -1 : 1,
          base: "items_total", valueMinor: line.flatAmountMinor ?? null, toConfirm: Boolean(line.toConfirm?.length), source: "read",
        });
        continue;
      }
      lines.push(line);
    }
    // Un groupe nommé montre son sous-total, comme sur les documents validés de la v1.
    if (lines.length) sections.push({ title: s.title?.trim().slice(0, 160) || null, showSubtotal: Boolean(s.title?.trim()), lines });
  }
  const adjustments = [...moved, ...r.adjustments.map((a) => guardAdjustment(a, c)).filter((a): a is AdjustmentInput => a !== null)];
  const text = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;
  const content: DraftContent = { sections, adjustments };
  if (r.title) content.title = text(r.title, 200);
  if (r.site) content.site = text(r.site, 200);
  if (r.deliveryText) content.delivery_text = text(r.deliveryText, 200);
  if (r.warrantyText) content.warranty_text = text(r.warrantyText, 200);
  if (r.assumptions) content.assumptions = text(r.assumptions, 1000);
  const validity = c.integer(r.validityDaysText);
  if (validity !== null && validity <= 365) content.validity_days = validity;
  const deposit = c.percent(r.depositPercentText);
  if (deposit !== null && deposit <= 10000) content.deposit_bp = deposit;
  const name = r.clientName ? capitalizeInitial(r.clientName).slice(0, 160) || null : null;
  const all = sections.flatMap((s) => s.lines);
  return {
    type: r.documentType,
    content,
    client: name ? { name, phone: text(r.clientPhone, 32), address: text(r.clientAddress, 300) } : null,
    lines: all.length,
    rejected: c.rejected,
    toConfirm: all.reduce((n, l) => n + (l.toConfirm?.length ?? 0), 0) + adjustments.filter((a) => a.toConfirm).length,
  };
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

/** Libellés qui sont des ajustements et non des lignes (v1, `model.md`). */
const ADJUSTMENT_LABEL = /^(main[ -]?d['’ ]?(?:œ|oe)uvre|mo\b|transport|remise|r[ée]duction|rabais)/i;
