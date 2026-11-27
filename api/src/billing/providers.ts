import { createHmac, timingSafeEqual } from "node:crypto";

// Fournisseurs de paiement de l'abonnement (OFF-3) derrière une interface ; la base décide des
// états. Moneroo est repris de DYM (spec 088) ; le simulateur sert hors production.

export type PaymentOutcome = "succeeded" | "failed" | "cancelled";

export interface InitiateInput {
  paymentId: string;
  reference: string;
  amountMinor: bigint;
  currencyCode: string;
  minorUnits: number;
  /** Adresse publique de l'API (retour du fournisseur). */
  apiUrl: string;
  webUrl: string;
  /** Téléphone (E.164) et pays : pré-remplis chez le fournisseur qui les accepte (v1). */
  customer: { email: string | null; firstName: string; phone?: string | null; countryCode?: string | null };
  /** Produits de l'offre chez les fournisseurs qui en exigent un ({"chariow": "prd_…"}). */
  products?: Record<string, string>;
}

export interface InitiateResult {
  providerReference: string;
  checkoutUrl: string;
}

export interface SettledEvent {
  eventId: string;
  paymentId: string;
  outcome: PaymentOutcome;
  amountMinor: bigint;
  currencyCode: string;
  /** Produit vendu chez le fournisseur, s'il en a un : comparé à celui de l'offre (v1). */
  productId?: string | null;
  /** Référence de la vente chez le fournisseur : comparée à celle du paiement. */
  providerReference?: string | null;
}

export interface PaymentProvider {
  readonly code: string;
  readonly needsEmail: boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Avis du fournisseur → événement vérifié (relu chez le fournisseur) ; null : rien à appliquer. */
  resolve(rawBody: string, minorUnitsOf: (currency: string) => Promise<number>, headers?: Record<string, string | undefined>): Promise<SettledEvent | null>;
  /**
   * Relit une vente chez le fournisseur par sa référence (rapprochement par l'équipe, v1) :
   * issue, montant et devise tels que le fournisseur les connaît.
   */
  lookup?(providerReference: string, minorUnitsOf: (currency: string) => Promise<number>): Promise<{ outcome: PaymentOutcome | null; amountMinor: bigint; currencyCode: string } | null>;
}

export const MONEROO_SIGNATURE_HEADER = "x-moneroo-signature";

const outcomeOf = (status: unknown): PaymentOutcome | null =>
  status === "success" ? "succeeded" : status === "failed" ? "failed" : status === "cancelled" ? "cancelled" : null;

/** Montant entier en unités majeures (exigé par Moneroo) depuis des unités mineures. */
export function majorAmount(minor: bigint, minorUnits: number): number {
  const factor = 10n ** BigInt(minorUnits);
  if (minor % factor !== 0n) throw new Error("montant non entier pour Moneroo");
  return Number(minor / factor);
}

export function monerooProvider(config: { secretKey: string; webhookSecret: string; apiUrl?: string; fetchImpl?: typeof fetch }): PaymentProvider {
  const api = (config.apiUrl ?? "https://api.moneroo.io").replace(/\/$/, "");
  const send = config.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${config.secretKey}`, "Content-Type": "application/json", Accept: "application/json" };
  return {
    code: "moneroo",
    needsEmail: true,
    async initiate(input) {
      if (!input.customer.email) throw new Error("e-mail requis pour Moneroo");
      const res = await send(`${api}/v1/payments/initialize`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          amount: majorAmount(input.amountMinor, input.minorUnits),
          currency: input.currencyCode,
          description: `Firmo ${input.reference}`,
          return_url: `${input.apiUrl.replace(/\/$/, "")}/v1/billing/return/${input.paymentId}`,
          metadata: { payment_id: input.paymentId, reference: input.reference },
          customer: { email: input.customer.email, first_name: input.customer.firstName, last_name: input.customer.firstName },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { id?: string; checkout_url?: string }; message?: string };
      if (!res.ok || !body.data?.id || !body.data.checkout_url) {
        throw new Error(`Moneroo ${res.status} : ${String(body.message ?? "réponse invalide").slice(0, 200)}`);
      }
      return { providerReference: body.data.id, checkoutUrl: body.data.checkout_url };
    },
    verifyWebhook(rawBody, hdrs) {
      if (!config.webhookSecret) return false;
      const given = hdrs[MONEROO_SIGNATURE_HEADER] ?? "";
      const expected = createHmac("sha256", config.webhookSecret).update(rawBody).digest("hex");
      return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    },
    // L'avis Moneroo est incomplet : statut, montant et référence sont relus chez Moneroo.
    async resolve(rawBody, minorUnitsOf) {
      let e: { event?: string; data?: { id?: string } };
      try {
        e = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const id = e.data?.id;
      if (!id || !e.event) return null;
      const res = await send(`${api}/v1/payments/${encodeURIComponent(id)}/verify`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Moneroo verify ${res.status}`);
      const body = (await res.json()) as { data?: { status?: string; amount?: number; currency?: { code?: string } | string; metadata?: Record<string, string> } };
      const d = body.data ?? {};
      const outcome = outcomeOf(d.status);
      const paymentId = d.metadata?.payment_id;
      const currencyCode = typeof d.currency === "string" ? d.currency : (d.currency?.code ?? "");
      if (!outcome || !paymentId || !currencyCode) return null;
      const units = await minorUnitsOf(currencyCode);
      return {
        eventId: `${e.event}:${id}`,
        paymentId,
        outcome,
        amountMinor: BigInt(Math.round(Number(d.amount ?? 0))) * 10n ** BigInt(units),
        currencyCode,
      };
    },
  };
}

/** Simulateur : page Firmo « payer / échouer » (jamais en production). */
export function simulatorProvider(): PaymentProvider {
  return {
    code: "simulator",
    needsEmail: false,
    async initiate(input) {
      return { providerReference: `sim-${input.reference}`, checkoutUrl: `${input.webUrl.replace(/\/$/, "")}/paiement/simulateur/${input.paymentId}` };
    },
    verifyWebhook: () => false,
    resolve: async () => null,
  };
}

export const CHARIOW_SIGNATURE_HEADER = "x-chariow-signature";
export const CHARIOW_EVENT_HEADER = "x-pulse-event";
export const CHARIOW_DELIVERY_HEADER = "x-pulse-delivery-id";

/** Montant Chariow (unités majeures, nombre ou texte) → unités mineures exactes. */
function chariowMinor(value: unknown, minorUnits: number): bigint | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(minorUnits, "0");
  if (frac.length > minorUnits && /[1-9]/.test(frac.slice(minorUnits))) return null;
  return BigInt(m[1]!) * 10n ** BigInt(minorUnits) + (minorUnits ? BigInt(frac.slice(0, minorUnits) || "0") : 0n);
}

/**
 * Chariow (fournisseur de la v1, paiement réel rapproché le 2026-08) : passage en caisse créé côté
 * serveur avec téléphone et pays pré-remplis ; avis « pulse » signés HMAC-SHA256 (« sha256=… ») ;
 * chaque vente est relue chez Chariow (statut, produit, montant, devise) avant d'être appliquée.
 */
export function chariowProvider(config: { apiKey: string; webhookSecret: string; apiUrl?: string; fetchImpl?: typeof fetch }): PaymentProvider {
  const api = (config.apiUrl ?? "https://api.chariow.com/v1").replace(/\/$/, "");
  const send = config.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "application/json" };

  async function sale(id: string) {
    const res = await send(`${api}/sales/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Chariow sale ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, any> };
    return body.data ?? {};
  }

  function outcomeOfSale(status: unknown): PaymentOutcome | null {
    const s = typeof status === "object" && status ? (status as { value?: string }).value : status;
    return s === "completed" ? "succeeded" : s === "failed" ? "failed" : s === "cancelled" || s === "abandoned" ? "cancelled" : null;
  }

  return {
    code: "chariow",
    needsEmail: true,
    async initiate(input) {
      const product = input.products?.chariow;
      if (!product) throw new Error("produit Chariow non configuré pour cette offre");
      if (!input.customer.email) throw new Error("e-mail requis pour Chariow");
      const phone = input.customer.phone && input.customer.countryCode
        ? { phone: { number: input.customer.phone, country_code: input.customer.countryCode } }
        : {};
      const res = await send(`${api}/checkout`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          product_id: product,
          email: input.customer.email,
          first_name: input.customer.firstName,
          last_name: input.customer.firstName,
          ...phone,
          payment_currency: input.currencyCode,
          redirect_url: `${input.apiUrl.replace(/\/$/, "")}/v1/billing/return/${input.paymentId}`,
          custom_metadata: { firmo_payment_id: input.paymentId, firmo_reference: input.reference },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = (await res.json().catch(() => ({}))) as { data?: { step?: string; purchase?: { id?: string }; payment?: { checkout_url?: string } }; message?: string };
      const d = body.data ?? {};
      if (!res.ok || d.step !== "payment" || !d.purchase?.id || !d.payment?.checkout_url) {
        throw new Error(`Chariow ${res.status} : ${String(body.message ?? d.step ?? "réponse invalide").slice(0, 200)}`);
      }
      return { providerReference: d.purchase.id, checkoutUrl: d.payment.checkout_url };
    },
    verifyWebhook(rawBody, hdrs) {
      // Un Pulse peut couvrir toute la boutique (plusieurs produits Kete) : plusieurs secrets acceptés.
      const secrets = config.webhookSecret.split(",").map((s) => s.trim()).filter(Boolean);
      if (!secrets.length) return false;
      const given = (hdrs[CHARIOW_SIGNATURE_HEADER] ?? "").trim().toLowerCase();
      if (!/^sha256=[0-9a-f]{64}$/.test(given)) return false;
      const ok = secrets.some((secret) => timingSafeEqual(Buffer.from(given), Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`)));
      if (!ok) return false;
      // L'événement annoncé en en-tête doit être celui du corps.
      try {
        return (JSON.parse(rawBody) as { event?: string }).event === hdrs[CHARIOW_EVENT_HEADER];
      } catch {
        return false;
      }
    },
    async resolve(rawBody, minorUnitsOf, hdrs = {}) {
      let e: { event?: string; sale?: { id?: string; custom_metadata?: Record<string, string> }; checkout?: { custom_metadata?: Record<string, string> } };
      try {
        e = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const saleId = e.sale?.id;
      const paymentId = e.sale?.custom_metadata?.firmo_payment_id ?? e.checkout?.custom_metadata?.firmo_payment_id;
      if (!saleId || !paymentId || !e.event) return null;
      const d = await sale(saleId);
      const outcome = outcomeOfSale(d.status);
      const currencyCode = String(d.amount?.currency ?? "");
      if (!outcome || !currencyCode) return null;
      const amountMinor = chariowMinor(d.amount?.value, await minorUnitsOf(currencyCode));
      if (amountMinor === null) return null;
      const delivery = hdrs[CHARIOW_DELIVERY_HEADER];
      const productId = typeof d.product === "object" && d.product ? String(d.product.id ?? "") || null : null;
      return { eventId: delivery ? `pulse:${delivery}` : `${e.event}:${saleId}`, paymentId, outcome, amountMinor, currencyCode, productId, providerReference: String(d.id ?? saleId) };
    },
    async lookup(reference, minorUnitsOf) {
      const d = await sale(reference);
      const currencyCode = String(d.amount?.currency ?? "");
      if (!currencyCode) return null;
      const amountMinor = chariowMinor(d.amount?.value, await minorUnitsOf(currencyCode));
      if (amountMinor === null) return null;
      return { outcome: outcomeOfSale(d.status), amountMinor, currencyCode };
    },
  };
}
