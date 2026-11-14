import { formatMoney, formatQuantity } from "../documents/money.js";
import type { DocumentView } from "../documents/store.js";
import { amountInWords } from "../documents/words.js";
import { documentWords, formatDate } from "../voix/document.js";
import { palette } from "./colors.js";

// Données du gabarit Typst : tout est déjà formaté (montants, dates, libellés). Le gabarit ne
// calcule rien ; les montants viennent du SQL (constitution III).

export interface RenderOptions {
  /** Le logo est fourni au compilateur sous /assets/logo.png. */
  hasLogo: boolean;
  /** Le QR code est fourni sous /assets/qr.svg. */
  hasQr: boolean;
  /** Aperçu d'un brouillon : filigrane. */
  draft?: boolean;
}

function percent(bp: number, sep: string): string {
  const value = (bp / 100).toFixed(2).replace(/\.?0+$/, "");
  return value.replace(".", sep);
}

export function renderModel(doc: DocumentView, options: RenderOptions) {
  const w = documentWords(doc.locale);
  const cur = doc.currency;
  const issuer = (doc.issuer ?? {}) as Record<string, any>;
  const money = (v: string) => formatMoney(v, cur);
  const num = (v: string) => formatMoney(v, cur, false);
  const isReceipt = doc.type === "receipt";

  const meta: Array<{ key: string; label: string; value: string }> = [];
  if (doc.number) meta.push({ key: "number", label: w.number, value: doc.number });
  if (doc.issueDate) meta.push({ key: "date", label: w.date, value: formatDate(doc.issueDate, doc.locale) });
  if (doc.validUntil) meta.push({ key: "valid_until", label: w.validUntil, value: formatDate(doc.validUntil, doc.locale) });
  if (doc.sourceNumber && !isReceipt) meta.push({ key: "source", label: w.source, value: doc.sourceNumber });

  const totals: Array<{ label: string; value: string; strong: boolean }> = [];
  const hasAdjustments = BigInt(doc.discountTotalMinor) > 0n || BigInt(doc.taxMinor) > 0n;
  if (!isReceipt) {
    if (hasAdjustments) totals.push({ label: w.subtotal, value: money(doc.subtotalMinor), strong: false });
    if (BigInt(doc.discountTotalMinor) > 0n) {
      totals.push({
        label: w.discount(doc.discountBp ? percent(doc.discountBp, cur.decimalSeparator) : null),
        value: `− ${money(doc.discountTotalMinor)}`,
        strong: false,
      });
    }
    if (BigInt(doc.taxMinor) > 0n) {
      totals.push({ label: w.tax(doc.taxLabel ?? "", percent(doc.taxRateBp, cur.decimalSeparator)), value: money(doc.taxMinor), strong: false });
    }
    totals.push({ label: doc.payable ? w.totalDue : w.total, value: money(doc.totalMinor), strong: true });
    if (doc.payable && BigInt(doc.paidMinor) > 0n) {
      totals.push({ label: w.paid, value: money(doc.paidMinor), strong: false });
      totals.push({ label: w.balance, value: money((BigInt(doc.totalMinor) - BigInt(doc.paidMinor)).toString()), strong: true });
    }
  }

  const stampKey = doc.status as keyof typeof w.stamps;
  const stamp = !doc.number ? null : (w.stamps[stampKey] ?? null);
  const stampColor = doc.status === "refused" || doc.status === "cancelled" ? "#B42318" : "#067647";

  const clientLines = [doc.client.address, doc.client.phone, doc.client.email, doc.client.legalId].filter(
    (v): v is string => Boolean(v),
  );
  const legal = ((issuer.legal_ids as Array<{ label: string; value: string }> | undefined) ?? [])
    .map((l) => `${l.label} : ${l.value}`)
    .join(" · ");

  return {
    style: doc.template,
    lang: doc.locale.startsWith("en") ? "en" : "fr",
    colors: palette(String(issuer.brand_color ?? "#1F3A5F")),
    labels: { columns: w.columns, client: w.client, subject: w.subject, paymentMethods: w.paymentMethods, notes: w.notes, draft: w.draft },
    doc: {
      kind: doc.typeLabel,
      number: doc.number ?? "—",
      title: isReceipt ? null : doc.title,
      meta,
      stamp,
      stampColor,
      draft: options.draft ?? !doc.number,
    },
    issuer: {
      name: String(issuer.name ?? ""),
      trade: issuer.trade ? String(issuer.trade) : null,
      lines: [issuer.address, issuer.phone, issuer.email, issuer.country].filter(Boolean).map(String),
      logo: options.hasLogo,
    },
    client: doc.client.name ? { name: doc.client.name, lines: clientLines } : null,
    currencyNote: w.currencyNote(cur.symbol),
    rows: doc.lines.map((l) => ({
      n: String(l.position),
      label: l.label,
      detail: null,
      qty: l.quantity ? formatQuantity(l.quantity, cur.decimalSeparator) : "—",
      unit: l.unitLabel ?? "",
      price: l.unitPriceMinor != null ? num(l.unitPriceMinor) : "—",
      total: l.lineTotalMinor != null ? num(l.lineTotalMinor) : "—",
    })),
    receipt: isReceipt
      ? {
          text: w.receipt(doc.title ?? doc.sourceNumber ?? "", formatDate(doc.issueDate ?? doc.createdAt, doc.locale)),
          amount: money(doc.totalMinor),
          // Pour un reçu, `notes` porte le moyen de paiement noté par l'artisan.
          method: doc.notes ? w.paidBy(doc.notes) : null,
        }
      : null,
    totals,
    words: w.words(doc.typeLabel, amountInWords(BigInt(doc.totalMinor), cur.minorUnits, doc.locale), cur.symbol),
    paymentMethods: isReceipt ? null : (issuer.payment_methods ?? null),
    notes: isReceipt ? null : (doc.notes ?? null),
    footerNote: issuer.footer_note ?? null,
    qr: options.hasQr,
    qrCaption: w.qrCaption,
    footer: { legal: legal || String(issuer.name ?? ""), brand: w.generatedBy },
  };
}

export type RenderModel = ReturnType<typeof renderModel>;
