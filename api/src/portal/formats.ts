import type pg from "pg";
import { type DraftContent, type LineInput, pgDocumentStore } from "../documents/store.js";
import type { DocumentView } from "../documents/store.js";
import { type FormatScenario, formatWords } from "../voix/formats.js";

// Page Formats (P-67) : un document d'exemple construit par les vraies règles SQL (totaux, taxes,
// acompte, numérotation, paiement) dans une transaction annulée, puis rendu par le vrai gabarit.
// Rien ne reste en base ; le résultat est mis en cache (le contenu ne dépend que des options).

export const FORMAT_OPTIONS = [
  "client", "site", "delivery", "groups", "subtotals", "labor", "transport", "discount", "tax", "deposit",
  "conditions", "validity", "warranty",
] as const;
export type FormatOption = (typeof FORMAT_OPTIONS)[number];

export async function buildFormatDocument(pool: pg.Pool, scenario: FormatScenario, options: Record<FormatOption, boolean>, locale: string): Promise<DocumentView> {
  const w = formatWords(locale);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const store = pgDocumentStore(client as unknown as pg.Pool, { shareSecret: "formats" });
    const org = (await client.query<{ org_id: string }>("select org_id from app.ensure_identity('simulator', $1, null, null, $2)", [`formats-${Date.now()}-${Math.random()}`, locale])).rows[0]!.org_id;
    await client.query("select app.update_profile($1, $2::jsonb)", [org, JSON.stringify({ name: w.issuer.name, trade_label: w.issuer.trade, phone: w.issuer.phone, brand_color: "#A8391F", tax_registered: options.tax })]);
    const minor = (await client.query<{ m: number }>("select cu.minor_units as m from public.organizations o join public.currencies cu on cu.code = o.currency_code where o.id = $1", [org])).rows[0]!.m;
    const money = (major: number) => (BigInt(major) * 10n ** BigInt(minor)).toString();
    const priced = (l: { label: string; description?: string; quantity: string; unit: string; price: number }): LineInput => ({
      label: l.label, description: l.description ?? null, kind: "priced", quantity: l.quantity, unit: l.unit, unitPriceMinor: money(l.price), flatAmountMinor: null, source: "typed",
    });
    const on = (k: FormatOption) => options[k];
    const rich = scenario === "professionnel" || scenario === "facture";

    let content: DraftContent;
    if (scenario === "express") {
      content = { title: w.title.express, sections: [{ title: null, lines: [{ label: w.express.label, kind: "flat", quantity: null, unit: null, unitPriceMinor: null, flatAmountMinor: money(w.express.amount), source: "typed" }] }] };
    } else if (scenario === "detaille") {
      content = { title: w.title.detaille, sections: [{ title: null, lines: w.supplies.lines.map(priced) }] };
    } else {
      const install = [...w.install.lines.map(priced), ...(on("labor") ? [{ label: w.labor.label, kind: "flat" as const, quantity: null, unit: null, unitPriceMinor: null, flatAmountMinor: money(w.labor.amount), source: "typed" as const }] : [])];
      content = {
        title: w.title[scenario],
        sections: on("groups")
          ? [
              { title: w.supplies.title, showSubtotal: on("subtotals"), lines: w.supplies.lines.map(priced) },
              { title: w.install.title, showSubtotal: on("subtotals"), lines: install },
            ]
          : [{ title: null, lines: [...w.supplies.lines.map(priced), ...install] }],
        adjustments: [
          ...(on("transport") ? [{ label: w.transport.label, mode: "amount" as const, sign: 1 as const, base: "items_total" as const, valueMinor: money(w.transport.amount), source: "typed" as const }] : []),
          ...(on("discount") ? [{ label: w.discount.label, mode: "percent" as const, sign: -1 as const, base: "items_total" as const, rateBp: w.discount.percent * 100, source: "typed" as const }] : []),
        ],
        apply_tax: on("tax"),
        deposit_bp: on("deposit") ? w.depositPercent * 100 : null,
        validity_days: on("validity") ? 30 : null,
        warranty_text: on("warranty") ? w.warranty : null,
        clauses: on("conditions") ? [{ body: w.condition }] : [],
      };
    }
    if (scenario !== "express") {
      content.site = on("site") ? w.site : null;
      content.delivery_text = on("delivery") ? w.delivery : null;
    }
    if (!rich) content.apply_tax = false;
    const docId = await store.createDraftContent(org, scenario === "facture" ? "invoice" : "quote", content, "web");
    if (on("client")) await store.setClient(org, docId, w.client.name, { phone: w.client.phone });
    await store.issue(org, docId, null);
    const view = await store.get(org, docId);
    const issuer = (await client.query<{ issuer: Record<string, unknown> }>("select app.issuer_snapshot($1) as issuer", [org])).rows[0]!.issuer;
    return { ...view, issuer };
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
}
