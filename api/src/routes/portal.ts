import type { Hono } from "hono";
import type pg from "pg";
import { z } from "zod";
import { amountFromUser } from "../ai/guard.js";
import { parsePercentBp, parseQuantity } from "../documents/money.js";
import type { AdjustmentInput, DocumentStore, DocumentView, DraftContent, LineInput } from "../documents/store.js";
import { fromPgError, sql, sqlOne } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { orgIdOf, requireOrg, type SessionSigner, type SessionVariables } from "../lib/session.js";
import type { ObjectStore } from "../lib/storage.js";
import { parseJson, parseQuery, parseWith } from "../lib/validate.js";
import { decodeImage, detectImageType, dominantColor, toPng } from "../portal/logo.js";
import type { RenderService } from "../render/service.js";
import { pgDocumentStore } from "../documents/store.js";
import { presentationSample } from "../voix/document.js";
import { buildFormatDocument, FORMAT_OPTIONS, type FormatOption } from "../portal/formats.js";

// Espace artisan (ART-1 à ART-5) et page publique du document (ART-7). Le web envoie ce que
// l'artisan tape ; montants et transitions sont décidés en SQL.

export interface PortalDeps {
  pool: pg.Pool;
  signer: SessionSigner;
  documents: DocumentStore;
  render: RenderService;
  files: ObjectStore;
  webUrl: string;
}

type Row = Record<string, any>;

/** Vue d'un document pour le client de l'artisan : rien d'interne. */
function publicView(doc: DocumentView) {
  const { orgId: _o, revisesId: _r, sourceDocumentId: _s, blockers: _b, renderVersion: _v, payments, ...rest } = doc;
  return { ...rest, payments: payments.map((p) => ({ amountMinor: p.amountMinor, paidOn: p.paidOn })) };
}

const lineSchema = z.object({
  label: z.string().trim().min(1).max(300),
  description: z.string().max(300).nullable().optional(),
  /** priced : quantité × prix ; flat : montant forfaitaire ; text : ligne descriptive. */
  kind: z.enum(["priced", "flat", "text"]).optional(),
  quantity: z.string().max(20).nullable().optional(),
  unit: z.string().max(24).nullable().optional(),
  /** Prix tel que tapé par l'artisan, en unités majeures (« 15 000 », « 12,50 »). */
  unitPrice: z.string().max(30).nullable().optional(),
  flatAmount: z.string().max(30).nullable().optional(),
});

const sectionSchema = z.object({
  title: z.string().trim().max(160).nullable(),
  showSubtotal: z.boolean().optional(),
  lines: z.array(lineSchema).max(200),
});

const adjustmentSchema = z.object({
  label: z.string().trim().min(1).max(160),
  mode: z.enum(["percent", "amount"]),
  sign: z.union([z.literal(1), z.literal(-1)]).optional(),
  base: z.enum(["items_total", "section", "taxable_base"]).optional(),
  section: z.number().int().min(1).max(200).nullable().optional(),
  /** Pourcentage tel que tapé (« 25 », « 12,5 »), ou montant en unités majeures. */
  value: z.string().max(30).nullable(),
});

const clauseRefSchema = z.union([
  z.object({ clauseId: z.string().uuid() }),
  z.object({ title: z.string().max(120).nullable().optional(), body: z.string().trim().min(1).max(600) }),
]);

const draftSchema = z.object({
  type: z.enum(["quote", "proforma", "invoice", "delivery_note"]).optional(),
  title: z.string().max(200).nullable().optional(),
  summary: z.string().max(300).nullable().optional(),
  site: z.string().max(200).nullable().optional(),
  deliveryText: z.string().max(200).nullable().optional(),
  warrantyText: z.string().max(200).nullable().optional(),
  assumptions: z.string().max(1000).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  validityDays: z.number().int().min(1).max(365).nullable().optional(),
  /** Acompte en pourcentage tel que tapé (« 30 »). */
  depositPercent: z.string().max(10).nullable().optional(),
  template: z.string().max(30).optional(),
  applyTax: z.boolean().optional(),
  client: z
    .object({ name: z.string().trim().min(1).max(160), phone: z.string().max(32).nullable().optional(), email: z.string().max(200).nullable().optional(), address: z.string().max(300).nullable().optional() })
    .nullable()
    .optional(),
  sections: z.array(sectionSchema).max(50).optional(),
  /** Compatibilité : lignes à plat (une section sans titre). */
  lines: z.array(lineSchema).max(200).optional(),
  adjustments: z.array(adjustmentSchema).max(30).optional(),
  clauses: z.array(clauseRefSchema).max(30).optional(),
});

export function registerPortalRoutes(app: Hono<{ Variables: SessionVariables }>, d: PortalDeps) {
  const auth = requireOrg(d.signer);
  const org = (c: { get(k: "session"): SessionVariables["session"] }) => orgIdOf(c.get("session"));

  async function minorUnits(orgId: string): Promise<number> {
    const r = await sqlOne<{ m: number }>(d.pool, "select cu.minor_units as m from public.organizations o join public.currencies cu on cu.code = o.currency_code where o.id = $1", [orgId]);
    return r.m;
  }

  function toLines(lines: z.infer<typeof lineSchema>[], minor: number, path: string): LineInput[] {
    return lines.map((l, i) => {
      const at = `${path}.${i}`;
      const kind = l.kind ?? (l.flatAmount ? "flat" : "priced");
      const quantity = kind === "priced" && l.quantity ? parseQuantity(l.quantity) : null;
      if (kind === "priced" && l.quantity && !quantity) throw httpErrors.validation({ [`${at}.quantity`]: "quantité invalide" });
      const price = kind === "priced" && l.unitPrice ? amountFromUser(l.unitPrice, minor) : null;
      if (kind === "priced" && l.unitPrice && price === null) throw httpErrors.validation({ [`${at}.unitPrice`]: "prix invalide" });
      const flat = kind === "flat" && l.flatAmount ? amountFromUser(l.flatAmount, minor) : null;
      if (kind === "flat" && l.flatAmount && flat === null) throw httpErrors.validation({ [`${at}.flatAmount`]: "montant invalide" });
      return {
        label: l.label, description: l.description || null, kind, quantity, unit: l.unit || null,
        unitPriceMinor: price?.toString() ?? null, flatAmountMinor: flat?.toString() ?? null, source: "typed",
      };
    });
  }

  function toAdjustments(adjustments: z.infer<typeof adjustmentSchema>[], minor: number): AdjustmentInput[] {
    return adjustments.map((a, i) => {
      let rateBp: number | null = null;
      let valueMinor: string | null = null;
      if (a.value) {
        if (a.mode === "percent") {
          rateBp = parsePercentBp(a.value);
          if (rateBp === null) throw httpErrors.validation({ [`adjustments.${i}.value`]: "pourcentage invalide" });
        } else {
          const v = amountFromUser(a.value, minor);
          if (v === null || v <= 0n) throw httpErrors.validation({ [`adjustments.${i}.value`]: "montant invalide" });
          valueMinor = v.toString();
        }
      }
      return { label: a.label, mode: a.mode, sign: a.sign ?? 1, base: a.base ?? "items_total", section: a.section ?? null, rateBp, valueMinor };
    });
  }

  async function applyDraft(orgId: string, id: string, input: z.infer<typeof draftSchema>) {
    const minor = await minorUnits(orgId);
    const content: DraftContent = {};
    if (input.type) content.type = input.type;
    if (input.title !== undefined) content.title = input.title;
    if (input.summary !== undefined) content.summary = input.summary;
    if (input.site !== undefined) content.site = input.site;
    if (input.deliveryText !== undefined) content.delivery_text = input.deliveryText;
    if (input.warrantyText !== undefined) content.warranty_text = input.warrantyText;
    if (input.assumptions !== undefined) content.assumptions = input.assumptions;
    if (input.notes !== undefined) content.notes = input.notes;
    if (input.validityDays !== undefined) content.validity_days = input.validityDays;
    if (input.depositPercent !== undefined) {
      const bp = input.depositPercent ? parsePercentBp(input.depositPercent) : null;
      if (input.depositPercent && (bp === null || bp > 10000)) throw httpErrors.validation({ depositPercent: "pourcentage invalide" });
      content.deposit_bp = bp;
    }
    if (input.template) content.template = input.template;
    if (input.applyTax !== undefined) content.apply_tax = input.applyTax;
    if (input.sections) {
      content.sections = input.sections.map((s, i) => ({ title: s.title || null, showSubtotal: s.showSubtotal, lines: toLines(s.lines, minor, `sections.${i}.lines`) }));
    } else if (input.lines) {
      content.sections = input.lines.length ? [{ title: null, lines: toLines(input.lines, minor, "lines") }] : [];
    }
    if (input.adjustments) content.adjustments = toAdjustments(input.adjustments, minor);
    if (input.clauses) content.clauses = input.clauses;
    if (Object.keys(content).length) await d.documents.setContent(orgId, id, content);
    if (input.client !== undefined) {
      await d.documents.setClient(orgId, id, input.client?.name ?? null, {
        phone: input.client?.phone ?? null, email: input.client?.email ?? null, address: input.client?.address ?? null,
      });
    }
  }

  // ------------------------------------------------------------- profil et référentiels
  app.get("/v1/portal/me", auth, async (c) => {
    const id = org(c);
    const o = await sqlOne<Row>(d.pool, "select * from public.organizations where id = $1", [id]);
    const locale = o.locale as string;
    const [countries, trades, templates, units, types, taxes, entitlement, identities] = await Promise.all([
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, currency_code, legal_ids from public.countries where active order by 2", [locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label from public.trades where active order by position", [locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, app.label(descriptions, $1) as description from public.templates where active order by position", [locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, app.label(short_labels, $1) as short from public.units order by position", [locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, acceptable, payable from public.document_types where active and code <> 'receipt' order by position", [locale]),
      sql<Row>(d.pool, "select code, app.label(labels, $1) as label, rate_bp, is_default from public.taxes where country_code = $2 and active", [locale, o.country_code]),
      d.documents.entitlement(id),
      sql<Row>(d.pool, "select channel from public.channel_identities where org_id = $1", [id]),
    ]);
    const currency = await sqlOne<Row>(d.pool, "select * from public.currencies where code = $1", [o.currency_code]);
    return c.json({
      org: {
        id, name: o.name, tradeCode: o.trade_code, countryCode: o.country_code, currencyCode: o.currency_code, locale,
        phone: o.phone, email: o.email, address: o.address, legalIds: o.legal_ids, taxRegistered: o.tax_registered,
        taxCode: o.tax_code, brandColor: o.brand_color, hasLogo: Boolean(o.logo_key), templateCode: o.template_code,
        paymentMethods: o.payment_methods, footerNote: o.footer_note, status: o.status,
        tradeLabel: o.trade_label, defaultValidityDays: o.default_validity_days,
        defaultDeliveryText: o.default_delivery_text, defaultWarrantyText: o.default_warranty_text,
        defaultDepositBp: o.default_deposit_bp,
      },
      currency: { code: currency.code, minorUnits: currency.minor_units, symbol: currency.symbol, symbolBefore: currency.symbol_before, thousandsSeparator: currency.thousands_separator, decimalSeparator: currency.decimal_separator },
      reference: {
        countries: countries.map((r) => ({
          code: r.code, label: r.label, currencyCode: r.currency_code,
          legalIds: (r.legal_ids as Array<{ code: string; labels: Record<string, string> }>).map((l) => ({ code: l.code, label: l.labels[locale] ?? l.labels.fr ?? l.code })),
        })),
        trades, templates, units, documentTypes: types,
        taxes: taxes.map((t) => ({ code: t.code, label: t.label, rateBp: t.rate_bp, isDefault: t.is_default })),
      },
      entitlement,
      channels: identities.map((r) => r.channel),
    });
  });

  /** Champs de la présentation (noms du web) → colonnes de l'organisation (règles en SQL). */
  function profilePatch(body: Record<string, unknown>): Record<string, unknown> {
    const map: Record<string, string> = {
      name: "name", tradeCode: "trade_code", countryCode: "country_code", locale: "locale", phone: "phone", email: "email",
      address: "address", legalIds: "legal_ids", taxRegistered: "tax_registered", taxCode: "tax_code", brandColor: "brand_color",
      templateCode: "template_code", paymentMethods: "payment_methods", footerNote: "footer_note",
      tradeLabel: "trade_label", defaultValidityDays: "default_validity_days", defaultDeliveryText: "default_delivery_text",
      defaultWarrantyText: "default_warranty_text",
    };
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      // Acompte par défaut tapé en pourcentage (« 30 »).
      if (k === "defaultDepositPercent") {
        const bp = typeof v === "string" && v.trim() ? parsePercentBp(v) : null;
        if (typeof v === "string" && v.trim() && (bp === null || bp > 10000)) throw httpErrors.validation({ [k]: "pourcentage invalide" });
        patch.default_deposit_bp = bp;
        continue;
      }
      const key = map[k];
      if (!key) throw httpErrors.validation({ [k]: "champ inconnu" });
      patch[key] = v;
    }
    return patch;
  }

  app.patch("/v1/portal/profile", auth, async (c) => {
    const body = await parseJson(c, z.record(z.string(), z.unknown()));
    await sql(d.pool, "select app.update_profile($1, $2::jsonb)", [org(c), JSON.stringify(profilePatch(body))]);
    return c.json({ ok: true });
  });

  // P-64 : aperçu en direct de la présentation, avec les valeurs tapées mais pas encore enregistrées.
  // Tout se passe dans une transaction annulée : la présentation est appliquée par la même règle SQL
  // que l'enregistrement (refus compris), le document est rendu par le vrai gabarit, rien ne reste.
  app.post("/v1/portal/presentation/preview", auth, async (c) => {
    const body = await parseJson(c, z.record(z.string(), z.unknown()));
    const id = org(c);
    const patch = profilePatch(body);
    const client = await d.pool.connect();
    let view: DocumentView;
    try {
      await client.query("begin");
      await client.query("select app.update_profile($1, $2::jsonb)", [id, JSON.stringify(patch)]);
      const store = pgDocumentStore(client as unknown as pg.Pool, { shareSecret: "aperçu" });
      const latest = await client.query<{ id: string }>(
        "select id from public.documents where org_id = $1 and status <> 'cancelled' order by (status <> 'draft') desc, updated_at desc limit 1", [id]);
      // Pas encore de document : un exemple sans prix (aucun montant inventé, la ligne reste « à compléter »).
      const locale = (await client.query<{ locale: string }>("select locale from public.organizations where id = $1", [id])).rows[0]!.locale;
      const sample = presentationSample(locale);
      const docId = latest.rows[0]?.id ?? (await store.createDraftContent(id, "quote", {
        title: sample.title,
        sections: [{ title: null, lines: [{ label: sample.line, description: null, kind: "priced", quantity: "1", unit: null, unitPriceMinor: null, flatAmountMinor: null, source: "typed" }] }],
      }, "web"));
      const issuer = (await client.query<{ issuer: Record<string, unknown> }>("select app.issuer_snapshot($1) as issuer", [id])).rows[0]!.issuer;
      view = { ...(await store.get(id, docId)), issuer, ...(typeof body.templateCode === "string" ? { template: body.templateCode } : {}) };
    } catch (error) {
      throw fromPgError(error);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    const out = await d.render.preview(view);
    return c.body(new Uint8Array(out.png), 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  // ------------------------------------------------------------- clauses (P-07)
  app.get("/v1/portal/clauses", auth, async (c) => c.json({ items: await d.documents.clauses(org(c)) }));

  const clauseSchema = z.object({
    title: z.string().trim().max(120).nullable().optional(),
    body: z.string().trim().min(1).max(600),
    isDefault: z.boolean().optional(),
    position: z.number().int().min(0).max(1000).optional(),
  });
  app.post("/v1/portal/clauses", auth, async (c) => {
    const b = await parseJson(c, clauseSchema);
    return c.json({ id: await d.documents.saveClause(org(c), null, b) }, 201);
  });
  app.put("/v1/portal/clauses/:id", auth, async (c) => {
    const b = await parseJson(c, clauseSchema.partial().extend({ active: z.boolean().optional() }));
    return c.json({ id: await d.documents.saveClause(org(c), c.req.param("id"), b) });
  });

  // ------------------------------------------------------------- numérotation (P-08)
  app.get("/v1/portal/numbering", auth, async (c) => c.json({ items: await d.documents.numbering(org(c)) }));
  app.put("/v1/portal/numbering/:type", auth, async (c) => {
    const b = await parseJson(c, z.object({
      prefix: z.string().regex(/^[A-Za-z0-9]{0,12}$/).optional(),
      separator: z.enum(["-", "_", "/", "."]).optional(),
      includeYear: z.boolean().optional(),
      width: z.number().int().min(1).max(12).optional(),
      cadence: z.enum(["annual", "continuous"]).optional(),
    }));
    return c.json(await d.documents.setNumbering(org(c), c.req.param("type"), b));
  });

  app.post("/v1/portal/logo", auth, async (c) => {
    const { base64 } = await parseJson(c, z.object({ base64: z.string().min(10).max(4_000_000) }));
    const bytes = Buffer.from(base64, "base64");
    if (!detectImageType(bytes)) throw httpErrors.validation({ logo: "PNG ou JPEG attendu" });
    let img;
    try {
      img = decodeImage(bytes);
    } catch {
      throw httpErrors.validation({ logo: "image illisible" });
    }
    if (img.width < 32 || img.height < 32 || img.width > 4000 || img.height > 4000) throw httpErrors.validation({ logo: "dimensions invalides" });
    const id = org(c);
    const key = `brand/${id}/logo-${Date.now().toString(36)}.png`;
    await d.files.put(key, toPng(bytes, img), "image/png");
    await sql(d.pool, "select app.set_logo($1, $2)", [id, key]);
    return c.json({ suggestedColor: dominantColor(img) });
  });

  app.delete("/v1/portal/logo", auth, async (c) => {
    await sql(d.pool, "select app.set_logo($1, null)", [org(c)]);
    return c.json({ ok: true });
  });

  app.get("/v1/portal/logo", auth, async (c) => {
    const r = await sqlOne<{ logo_key: string | null }>(d.pool, "select logo_key from public.organizations where id = $1", [org(c)]);
    if (!r.logo_key) throw httpErrors.notFound("aucun logo");
    const bytes = await d.files.get(r.logo_key);
    return c.body(new Uint8Array(bytes), 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" });
  });

  // ------------------------------------------------------------- tableau de bord
  app.get("/v1/portal/dashboard", auth, async (c) => {
    const id = org(c);
    const r = await sqlOne<{ v: Record<string, unknown> }>(d.pool, "select app.org_dashboard($1) as v", [id]);
    const recent = await d.documents.list(id, { limit: 10 });
    return c.json({ stats: r.v, recent: recent.items, entitlement: await d.documents.entitlement(id) });
  });

  // ------------------------------------------------------------- documents
  app.get("/v1/portal/documents", auth, async (c) => {
    const q = parseQuery(c, z.object({
      type: z.string().max(20).optional(),
      status: z.string().max(20).optional(),
      search: z.string().max(80).optional(),
      page: z.coerce.number().int().min(1).max(500).default(1),
    }));
    const limit = 20;
    const result = await d.documents.list(org(c), { type: q.type, status: q.status, search: q.search, limit, offset: (q.page - 1) * limit });
    return c.json({ ...result, page: q.page, pageSize: limit });
  });

  app.post("/v1/portal/documents", auth, async (c) => {
    const input = await parseJson(c, draftSchema);
    const id = org(c);
    const draftId = await d.documents.createDraft(id, input.type ?? "quote", [], "web", input.title ?? null);
    await applyDraft(id, draftId, { ...input, type: undefined });
    return c.json(await d.documents.get(id, draftId), 201);
  });

  app.get("/v1/portal/documents/:id", auth, async (c) => {
    const doc = await d.documents.get(org(c), c.req.param("id"));
    const rendered = doc.status !== "draft" ? await d.render.current(doc.id) : null;
    return c.json({ ...doc, rendered: Boolean(rendered), shareUrl: doc.status === "draft" ? null : d.render.shareLink(doc.id) });
  });

  app.put("/v1/portal/documents/:id", auth, async (c) => {
    const input = await parseJson(c, draftSchema);
    const id = org(c);
    await applyDraft(id, c.req.param("id"), input);
    return c.json(await d.documents.get(id, c.req.param("id")));
  });

  async function fileFor(orgId: string | null, docId: string, kind: "pdf" | "svg" | "png") {
    const doc = orgId ? await d.documents.get(orgId, docId) : await d.documents.getAny(docId);
    const rendered = doc.status !== "draft" ? await d.render.current(doc.id) : null;
    if (rendered) {
      const key = kind === "pdf" ? rendered.pdfKey : kind === "svg" ? rendered.svgKey : rendered.pngKey;
      return { doc, bytes: await d.render.file(key) };
    }
    const preview = await d.render.preview(doc);
    return { doc, bytes: kind === "pdf" ? preview.pdf : kind === "svg" ? Buffer.from(preview.svg) : preview.png };
  }

  const TYPES = { pdf: "application/pdf", svg: "image/svg+xml", png: "image/png" } as const;

  app.get("/v1/portal/documents/:id/:file{file\.(?:pdf|png|svg)}", auth, async (c) => {
    const kind = c.req.param("file").slice(5) as keyof typeof TYPES;
    if (!(kind in TYPES)) throw httpErrors.notFound();
    const { doc, bytes } = await fileFor(org(c), c.req.param("id"), kind);
    const name = `${doc.number ?? "brouillon"}.${kind}`;
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": TYPES[kind],
      "Content-Disposition": `${kind === "pdf" && c.req.query("download") ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    });
  });

  const action = (path: string, run: (orgId: string, id: string, body: any) => Promise<unknown>, schema: z.ZodType = z.object({}).passthrough()) =>
    app.post(`/v1/portal/documents/:id/${path}`, auth, async (c) => {
      // Corps facultatif : un appel sans corps vaut « {} ».
      const text = await c.req.text();
      let raw: unknown = {};
      if (text.trim()) {
        try {
          raw = JSON.parse(text);
        } catch {
          throw httpErrors.badRequest("corps JSON attendu");
        }
      }
      const body = parseWith(schema, raw);
      const result = await run(org(c), c.req.param("id"), body);
      return c.json(result ?? { ok: true });
    });

  // Émission (P-09) : numéro particulier facultatif, unique et audité.
  action("issue", async (o, id, b) => d.documents.issue(o, id, b.number ?? null),
    z.object({ number: z.string().trim().max(64).nullable().optional() }));
  action("revise", async (o, id) => ({ id: await d.documents.revise(o, id) }));
  // Conversion (P-11) : en proforma ou en facture.
  action("convert", async (o, id, b) => ({ id: await d.documents.convert(o, id, b.type ?? "invoice") }),
    z.object({ type: z.enum(["proforma", "invoice", "delivery_note"]).optional() }));
  action("duplicate", async (o, id) => ({ id: await d.documents.duplicate(o, id) }));
  action("cancel", async (o, id) => {
    await d.documents.cancel(o, id);
    return { ok: true };
  });
  action("decision", async (o, id, b) => {
    await d.documents.decide(o, id, b.decision, b.note ?? null);
    return { ok: true };
  }, z.object({ decision: z.enum(["accepted", "refused", "no_response"]), note: z.string().max(500).nullable().optional() }));
  action("share", async (o, id) => {
    await d.documents.share(o, id);
    await d.documents.markShared(o, id, "web");
    return { url: d.render.shareLink(id) };
  });
  action("payments", async (o, id, b) => {
    const amount = amountFromUser(b.amount, await minorUnits(o));
    if (amount === null || amount <= 0n) throw httpErrors.validation({ amount: "montant invalide" });
    return { id: await d.documents.recordPayment(o, id, amount.toString(), b.paidOn ?? null, b.method ?? null, b.note ?? null) };
  }, z.object({ amount: z.string().min(1).max(30), paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), method: z.string().max(80).nullable().optional(), note: z.string().max(300).nullable().optional() }));

  app.post("/v1/portal/payments/:id/receipt", auth, async (c) => {
    return c.json({ id: await d.documents.issueReceipt(org(c), c.req.param("id")) });
  });

  // ------------------------------------------------------------- clients
  app.get("/v1/portal/clients", auth, async (c) => {
    const search = c.req.query("search")?.toLowerCase().slice(0, 80) ?? "";
    const rows = await sql<Row>(
      d.pool,
      `select c.*, (select count(*) from public.documents d where d.client_id = c.id and d.status <> 'draft') as documents,
              (select coalesce(sum(d.total_minor), 0) from public.documents d join public.document_types t on t.code = d.type_code
               where d.client_id = c.id and t.payable and d.status in ('issued','partially_paid','paid'))::text as invoiced_minor
       from public.clients c where c.org_id = $1 and ($2 = '' or lower(c.name) like '%' || $2 || '%')
       order by c.updated_at desc limit 200`,
      [org(c), search],
    );
    return c.json({
      items: rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, address: r.address, legalId: r.legal_id, documents: Number(r.documents), invoicedMinor: r.invoiced_minor })),
    });
  });

  const clientSchema = z.object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().max(32).nullable().optional(),
    email: z.string().max(200).nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    legalId: z.string().max(80).nullable().optional(),
  });
  const clientPatch = (b: z.infer<typeof clientSchema>) => JSON.stringify({ name: b.name, phone: b.phone ?? "", email: b.email ?? "", address: b.address ?? "", legal_id: b.legalId ?? "" });

  app.post("/v1/portal/clients", auth, async (c) => {
    const b = await parseJson(c, clientSchema);
    const r = await sqlOne<{ id: string }>(d.pool, "select app.save_client($1, null, $2::jsonb) as id", [org(c), clientPatch(b)]);
    return c.json({ id: r.id }, 201);
  });

  app.put("/v1/portal/clients/:id", auth, async (c) => {
    const b = await parseJson(c, clientSchema);
    await sql(d.pool, "select app.save_client($1, $2, $3::jsonb)", [org(c), c.req.param("id"), clientPatch(b)]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- offre publique (site)
  app.get("/v1/public/offer", async (c) => {
    const locale = c.req.query("locale") === "en" ? "en" : "fr";
    // Devise du pays demandé, sinon du pays par défaut (réglage) : le site montre un seul prix.
    const country = (c.req.query("country") ?? "").toUpperCase().slice(0, 2);
    const [trial, plans] = await Promise.all([
      sqlOne<{ n: number }>(d.pool, "select (app.setting('trial_documents') #>> '{}')::int as n"),
      sql<Row>(
        d.pool,
        `select p.code, app.label(p.labels, $1) as label, p.price_minor::text as price_minor, p.quota, p.period_days,
                p.grace_days, p.top_up_documents, p.top_up_price_minor::text as top_up_price_minor,
                cu.code as currency, cu.minor_units, cu.symbol, cu.symbol_before, cu.thousands_separator, cu.decimal_separator
         from public.plans p join public.currencies cu on cu.code = p.currency_code
         where p.active and p.currency_code = (
           select currency_code from public.countries
           where code = coalesce(nullif($2, ''), app.setting('default_country') #>> '{}'))
         order by p.price_minor`,
        [locale, country],
      ),
    ]);
    const warn = await sqlOne<{ n: number }>(d.pool, "select coalesce((app.setting('subscription_warn_days') #>> '{}')::int, 3) as n");
    return c.json({
      trialDocuments: trial.n,
      warnDays: warn.n,
      plans: plans.map((p) => ({
        code: p.code, label: p.label, priceMinor: p.price_minor, quota: p.quota, periodDays: p.period_days,
        graceDays: p.grace_days, topUp: p.top_up_price_minor && p.top_up_documents ? { documents: p.top_up_documents, priceMinor: p.top_up_price_minor } : null,
        currency: { code: p.currency, minorUnits: p.minor_units, symbol: p.symbol, symbolBefore: p.symbol_before, thousandsSeparator: p.thousands_separator, decimalSeparator: p.decimal_separator },
      })),
    }, 200, { "Cache-Control": "public, max-age=300" });
  });

  // ------------------------------------------------------------- formats (P-67)
  // Aperçus publics réels : même moteur que les documents, contenu d'exemple, rien de stocké.
  const formatCache = new Map<string, { pdf: Buffer; png: Buffer }>();
  app.get("/v1/public/formats/:file", async (c) => {
    const kind = c.req.param("file") === "preview.pdf" ? "pdf" : c.req.param("file") === "preview.png" ? "png" : null;
    if (!kind) throw httpErrors.notFound();
    const q = parseQuery(c, z.object({
      scenario: z.enum(["express", "detaille", "professionnel", "facture"]).default("professionnel"),
      options: z.string().max(300).default(FORMAT_OPTIONS.join(",")),
      locale: z.enum(["fr", "en"]).default("fr"),
    }));
    const chosen = new Set(q.options.split(",").filter((o): o is FormatOption => (FORMAT_OPTIONS as readonly string[]).includes(o)));
    const options = Object.fromEntries(FORMAT_OPTIONS.map((o) => [o, chosen.has(o)])) as Record<FormatOption, boolean>;
    const key = `${q.locale}:${q.scenario}:${FORMAT_OPTIONS.filter((o) => options[o]).join(",")}`;
    let out = formatCache.get(key);
    if (!out) {
      const view = await buildFormatDocument(d.pool, q.scenario, options, q.locale);
      const r = await d.render.preview(view);
      out = { pdf: r.pdf, png: r.png };
      if (formatCache.size >= 300) formatCache.delete(formatCache.keys().next().value!);
      formatCache.set(key, out);
    }
    return c.body(new Uint8Array(kind === "pdf" ? out.pdf : out.png), 200, {
      "Content-Type": kind === "pdf" ? "application/pdf" : "image/png",
      "Cache-Control": "public, max-age=3600",
      ...(kind === "pdf" ? { "Content-Disposition": `inline; filename="firmo-${q.scenario}.pdf"` } : {}),
    });
  });

  // ------------------------------------------------------------- page publique (ART-7)
  app.get("/v1/public/documents/:token", async (c) => {
    const doc = await d.documents.publicDocument(c.req.param("token"));
    return c.json(publicView(doc));
  });

  app.get("/v1/public/documents/:token/:file{file\.(?:pdf|png|svg)}", async (c) => {
    const kind = c.req.param("file").slice(5) as keyof typeof TYPES;
    if (!(kind in TYPES)) throw httpErrors.notFound();
    const doc = await d.documents.publicDocument(c.req.param("token"));
    const { bytes } = await fileFor(null, doc.id, kind);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": TYPES[kind],
      "Content-Disposition": `${kind === "pdf" && c.req.query("download") ? "attachment" : "inline"}; filename="${doc.number}.${kind}"`,
      "Cache-Control": "private, max-age=60",
    });
  });

  app.post("/v1/public/documents/:token/decision", async (c) => {
    const b = await parseJson(c, z.object({ decision: z.enum(["accepted", "refused"]), note: z.string().max(500).nullable().optional() }));
    const doc = await d.documents.clientDecision(c.req.param("token"), b.decision, b.note ?? null);
    return c.json(publicView(doc));
  });
}
