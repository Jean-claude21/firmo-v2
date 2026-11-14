// Affichage seulement : les montants arrivent de l'API en unités mineures (chaînes) et sont
// formatés selon la devise renvoyée par l'API. Aucun calcul de total ici.

export interface Currency {
  code: string;
  minorUnits: number;
  symbol: string;
  symbolBefore: boolean;
  thousandsSeparator: string;
  decimalSeparator: string;
}

export function money(minor: string | number | bigint, c: Currency): string {
  const v = BigInt(minor);
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const f = 10n ** BigInt(c.minorUnits);
  const major = (abs / f).toString().replace(/\B(?=(\d{3})+(?!\d))/g, c.thousandsSeparator);
  const n = c.minorUnits ? `${major}${c.decimalSeparator}${(abs % f).toString().padStart(c.minorUnits, "0")}` : major;
  const s = `${neg ? "-" : ""}${n}`;
  return c.symbolBefore ? `${c.symbol}${s}` : `${s} ${c.symbol}`;
}

/** Unités mineures → texte majeur éditable (« 15000 », « 12.5 ») pour pré-remplir un champ. */
export function majorText(minor: string | null, c: Currency): string {
  if (minor === null) return "";
  const v = BigInt(minor);
  if (!c.minorUnits) return v.toString();
  const f = 10n ** BigInt(c.minorUnits);
  const frac = (v % f).toString().padStart(c.minorUnits, "0").replace(/0+$/, "");
  return frac ? `${v / f}${c.decimalSeparator}${frac}` : (v / f).toString();
}

export function quantity(q: string | null, sep = ","): string {
  if (!q) return "";
  const [i, f = ""] = q.split(".");
  const t = f.replace(/0+$/, "");
  return t ? `${i}${sep}${t}` : (i ?? "");
}

export function date(iso: string | null, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(locale === "en" ? "en-GB" : "fr-FR", { day: "numeric", month: "short", year: "numeric" });
}
