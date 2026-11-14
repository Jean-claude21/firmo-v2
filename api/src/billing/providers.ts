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
  customer: { email: string | null; firstName: string };
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
}

export interface PaymentProvider {
  readonly code: string;
  readonly needsEmail: boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>): boolean;
  /** Avis du fournisseur → événement vérifié (relu chez le fournisseur) ; null : rien à appliquer. */
  resolve(rawBody: string, minorUnitsOf: (currency: string) => Promise<number>): Promise<SettledEvent | null>;
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
