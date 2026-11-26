import { formatMoney, formatQuantity } from "../documents/money.js";
import type { DocumentView } from "../documents/store.js";
import { amountInWords } from "../documents/words.js";
import { documentWords, formatDate } from "../voix/document.js";
import { readableOnWhite } from "./colors.js";

// Données du gabarit Typst (templates/document.typ) : tout arrive formaté (montants, dates,
// libellés). Le gabarit ne calcule rien ; les montants viennent du SQL (constitution III).
// Composition qui se referme (P-23) : un bloc vide n'est pas transmis, le gabarit ne le dessine pas.

export interface RenderOptions {
  /** Le logo est fourni au compilateur sous assets/logo.png. */
  hasLogo: boolean;
  /** Le QR code est fourni sous assets/qr.svg. */
  hasQr: boolean;
  /** Aperçu d'un brouillon : filigrane « APERÇU · BROUILLON ». */
  draft?: boolean;
}

/** Centièmes de point → « 25 », « 12,5 ». */
export function percentText(bp: number, decimalSeparator: string): string {
  const value = (bp / 100).toFixed(2).replace(/\.?0+$/, "");
  return value.replace(".", decimalSeparator);
}

/** Monogramme de l'entête : initiales des deux premiers mots du nom (« ATELIER KODJO » → « AK »). */
export function monogram(name: string): string {
  const words = name
    .split(/[\s\-·.]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function renderModel(doc: DocumentView, options: RenderOptions) {
  const w = documentWords(doc.locale);
  const cur = doc.currency;
  const sep = cur.decimalSeparator;
  const issuer = (doc.issuer ?? {}) as Record<string, any>;
  const num = (v: string | bigint) => formatMoney(v, cur, false);
  const isReceipt = doc.type === "receipt";
  const paid = doc.payable && BigInt(doc.paidMinor) > 0n && BigInt(doc.paidMinor) === BigInt(doc.totalMinor);
  const draft = options.draft ?? !doc.number;
  const date = doc.issueDate ? formatDate(doc.issueDate, doc.locale) : null;

  // Cadre : validité, délai, chantier, garantie, document d'origine (seulement s'ils existent).
  const frame: Array<{ label: string; value: string }> = [];
  if (doc.validityDays) frame.push({ label: w.validity, value: w.days(doc.validityDays) });
  if (doc.deliveryText) frame.push({ label: w.delivery, value: doc.deliveryText });
  if (doc.site) frame.push({ label: w.site, value: doc.site });
  if (doc.warrantyText) frame.push({ label: w.warranty, value: doc.warrantyText });
  if (doc.sourceNumber) frame.push({ label: w.origin(doc.sourceType), value: doc.sourceNumber });

  const sections = doc.sections.map((s) => ({
    title: s.title,
    subtotal: s.showSubtotal && s.lines.some((l) => l.lineTotalMinor !== null) ? num(s.subtotalMinor) : null,
    subtotal_label: w.subtotalOf(s.title),
    lines: s.lines.map((l) => ({
      label: l.label,
      description: l.description,
      qty: l.kind === "priced" && l.quantity ? `${formatQuantity(l.quantity, sep)}${l.unit ? ` ${l.unit}` : ""}` : null,
      unit_price: l.kind === "priced" && l.unitPriceMinor !== null ? num(l.unitPriceMinor) : null,
      amount: l.lineTotalMinor !== null ? num(l.lineTotalMinor) : null,
    })),
  }));

  // Totaux (P-04) : sous-total si quelque chose s'y ajoute, ajustements dans leur ordre, taxe.
  const before: Array<{ label: string; value: string }> = [];
  const hasAdjustments = doc.adjustments.some((a) => a.amountMinor !== null);
  const hasTax = BigInt(doc.taxMinor) > 0n;
  if (!isReceipt && (hasAdjustments || hasTax)) before.push({ label: w.itemsTotal, value: num(doc.subtotalMinor) });
  for (const a of doc.adjustments) {
    if (a.amountMinor === null) continue;
    const pct = a.mode === "percent" && a.rateBp ? percentText(a.rateBp, sep) : null;
    before.push({ label: w.adjustment(a.label, pct), value: num(a.amountMinor) });
  }
  if (hasTax) before.push({ label: w.tax(doc.taxLabel ?? "", percentText(doc.taxRateBp, sep)), value: num(doc.taxMinor) });

  const after: Array<{ label: string; value: string; strong: boolean }> = [];
  const hasPayments = doc.payable && doc.payments.length > 0;
  if (doc.depositMinor !== null && doc.depositBp) {
    after.push({ label: w.deposit(percentText(doc.depositBp, sep)), value: num(doc.depositMinor), strong: false });
    // Un seul solde sur le document : après les paiements s'il y en a, sinon après l'acompte.
    if (!hasPayments) after.push({ label: w.balanceAfterDeposit, value: num(BigInt(doc.totalMinor) - BigInt(doc.depositMinor)), strong: true });
  }
  if (hasPayments) {
    for (const p of doc.payments) after.push({ label: w.paid(p.method), value: num(p.amountMinor), strong: false });
    after.push({ label: w.paidTotal, value: num(doc.paidMinor), strong: false });
    after.push({ label: w.balance, value: num(BigInt(doc.totalMinor) - BigInt(doc.paidMinor)), strong: true });
  }

  // Colonne de gauche : conditions (clauses figées + notes), hypothèses, règlement.
  const notes: Array<{ title: string; items: string[] }> = [];
  const conditions = [...doc.clauses.map((c) => (c.title ? `${c.title} : ${c.body}` : c.body)), ...(doc.notes && !isReceipt ? [doc.notes] : [])];
  if (conditions.length) notes.push({ title: w.conditions, items: conditions });
  if (doc.assumptions) notes.push({ title: w.assumptions, items: [doc.assumptions] });
  const paymentMethods = isReceipt ? doc.notes : (issuer.payment_methods as string | null | undefined);
  if (paymentMethods && doc.type !== "delivery_note") notes.push({ title: w.payment, items: [paymentMethods] });

  const lastPayment = doc.payments.at(-1)?.paidOn ?? null;
  const signature = w.signature(doc.type, { paid, date: lastPayment ? formatDate(lastPayment, doc.locale) : null });
  const color = String(issuer.brand_color ?? "#656A6C");
  const name = String(issuer.name ?? "");
  const clientDetails = [doc.client.address, doc.client.phone, doc.client.email, doc.client.legalId ? w.clientLegalId(doc.client.legalId) : null].filter((v): v is string => Boolean(v));

  return {
    lang: doc.locale.startsWith("en") ? "en" : "fr",
    draft,
    labels: {
      designation: w.designation, qty: w.qty, unit_price: w.unitPrice, amount: w.amount, section: w.section,
      recipient: w.recipient, frame: w.frame, object: w.object, issued_on: w.issuedOn,
      signature: signature.label, signature_hint: signature.hint, issuer: w.issuer, draft_mark: w.draftMark, qr: w.qr,
    },
    currency: { symbol: cur.symbol, before: cur.symbolBefore },
    issuer: {
      name,
      mark: monogram(name),
      trade: issuer.trade ? String(issuer.trade) : null,
      phone: issuer.phone ? String(issuer.phone) : null,
      email: issuer.email ? String(issuer.email) : null,
      address: issuer.address ? String(issuer.address) : null,
      // Couleur de l'artisan, assombrie en silence si elle est trop claire pour rester lisible (P-21).
      accent: readableOnWhite(color),
      accent_ink: "#FFFFFF",
      logo: options.hasLogo,
      legal: ((issuer.legal_ids as Array<{ label: string; value: string }> | undefined) ?? []).map((l) => ({ label: l.label, value: l.value })),
      footer_note: issuer.footer_note ? String(issuer.footer_note) : null,
    },
    type: doc.typeLabel,
    number: doc.number ?? w.draftMark,
    date,
    client: doc.client.name ? { name: doc.client.name, details: clientDetails } : null,
    frame,
    object: isReceipt ? null : doc.title,
    summary: isReceipt ? null : doc.summary,
    sections: isReceipt
      ? sections.map((s) => ({ ...s, subtotal: null, lines: s.lines.map((l) => ({ ...l, label: w.receiptLine(l.label) })) }))
      : sections,
    notes,
    totals: {
      before,
      label: w.totalLabel(doc.type, { tax: hasTax, paid }),
      value: num(doc.totalMinor),
      after,
    },
    words: doc.type === "delivery_note" ? null : w.words(doc.typeLabel, amountInWords(BigInt(doc.totalMinor), cur.minorUnits, doc.locale), cur.symbol),
    qr: options.hasQr,
  };
}

export type RenderModel = ReturnType<typeof renderModel>;
