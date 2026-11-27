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

/** Montant sans symbole, pour les colonnes en chasse fixe (le symbole est posé à côté, plus petit). */
export function figure(minor: string | number | bigint, c: Currency): string {
  const full = money(minor, c);
  return full.replace(c.symbol, "").trim();
}

/** « il y a 8 min », « hier », sinon la date : pour « modifié … » (v1). */
export function ago(iso: string, locale: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const fr = locale !== "en";
  if (s < 60) return fr ? "à l'instant" : "just now";
  if (s < 3600) return fr ? `il y a ${Math.floor(s / 60)} min` : `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return fr ? `il y a ${Math.floor(s / 3600)} h` : `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return fr ? "hier" : "yesterday";
  return date(iso, locale);
}
