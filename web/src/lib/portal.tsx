import { createContext, type ReactNode, useContext, useEffect } from "react";
import { type Loadable, useApi } from "./api";
import type { Currency } from "./format";
import { localeOf, useI18n } from "@/l10n";

// Données de l'artisan connecté, partagées par toutes les pages de /app.

export interface Me {
  org: {
    id: string;
    name: string | null;
    tradeCode: string | null;
    countryCode: string;
    currencyCode: string;
    locale: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    legalIds: Record<string, string>;
    taxRegistered: boolean;
    taxCode: string | null;
    brandColor: string;
    hasLogo: boolean;
    templateCode: string;
    paymentMethods: string | null;
    footerNote: string | null;
    status: string;
  };
  currency: Currency;
  reference: {
    countries: Array<{ code: string; label: string; currencyCode: string; legalIds: Array<{ code: string; label: string }> }>;
    trades: Array<{ code: string; label: string }>;
    templates: Array<{ code: string; label: string; description: string }>;
    units: Array<{ code: string; label: string; short: string }>;
    documentTypes: Array<{ code: string; label: string; acceptable: boolean; payable: boolean }>;
    taxes: Array<{ code: string; label: string; rateBp: number; isDefault: boolean }>;
  };
  entitlement: { kind: string; quota: number; used: number; remaining: number; periodEnd: string | null; planCode: string | null } | null;
  channels: string[];
}

const Ctx = createContext<Loadable<Me> | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const me = useApi<Me>("org", "/v1/portal/me");
  const { setLocale } = useI18n();
  useEffect(() => {
    if (me.data) setLocale(localeOf(me.data.org.locale));
  }, [me.data, setLocale]);
  return <Ctx.Provider value={me}>{children}</Ctx.Provider>;
}

export function useMe(): Loadable<Me> {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMe hors de MeProvider");
  return v;
}

export interface DocumentSummary {
  id: string;
  type: string;
  typeLabel: string;
  status: string;
  number: string | null;
  clientName: string | null;
  totalMinor: string;
  paidMinor: string;
  currencyCode: string;
  issueDate: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface DocumentLine {
  position: number;
  label: string;
  quantity: string | null;
  sectionPosition: number;
  kind: "priced" | "flat" | "text";
  description: string | null;
  unit: string | null;
  unitPriceMinor: string | null;
  flatAmountMinor: string | null;
  lineTotalMinor: string | null;
  toConfirm: string[];
}

export interface DocumentDetail extends DocumentSummary {
  title: string | null;
  notes: string | null;
  locale: string;
  template: string;
  currency: Currency;
  client: { id: string | null; name: string | null; phone: string | null; email: string | null; address: string | null };
  issuer: Record<string, unknown> | null;
  expired: boolean;
  applyTax: boolean;
  taxLabel: string | null;
  taxRateBp: number;
  subtotalMinor: string;
  adjustmentsTotalMinor: string;
  depositMinor: string | null;
  sections: Array<{ position: number; title: string | null; showSubtotal: boolean; subtotalMinor: string }>;
  adjustments: Array<{ position: number; label: string; mode: "percent" | "amount"; sign: 1 | -1; base: string; sectionPosition: number | null; rateBp: number | null; valueMinor: string | null; amountMinor: string | null }>;
  taxMinor: string;
  sourceNumber: string | null;
  acceptable: boolean;
  payable: boolean;
  viewedAt: string | null;
  decidedAt: string | null;
  decisionBy: string | null;
  decisionNote: string | null;
  issuedAt: string | null;
  lines: DocumentLine[];
  payments: Array<{ id: string; amountMinor: string; paidOn: string; method: string | null; receiptId: string | null }>;
  blockers: string[];
  rendered?: boolean;
  shareUrl?: string | null;
}
