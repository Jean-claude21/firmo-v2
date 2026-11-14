// Contrats entre le moteur de conversation et l'IA (PARITE_V1 §3, contrats de la v1).
// L'IA RECOPIE : tout nombre reste du texte tel qu'il a été dit ou écrit ; la conversion et la
// garde anti-invention sont faites ensuite par le code (ai/guard.ts). « Le calcul est à lui. »

export interface ReadLine {
  label: string;
  /** Précision du métier sous le libellé (« bois de coffrage compris »). */
  description?: string | null;
  /** Quantité telle qu'écrite ou dite (« 2 », « 1,5 »), null si absente. */
  quantityText: string | null;
  /** Unité telle que dite (« barre », « m² », « forfait »), null si absente. */
  unit: string | null;
  /** Prix unitaire tel qu'écrit ou dit, null si absent. */
  unitPriceText: string | null;
  /** Montant de ligne tel qu'écrit (forfait, ou total quand le prix unitaire manque). */
  lineTotalText: string | null;
  /** Ligne descriptive, sans montant (« teinte au choix du client »). */
  descriptive?: boolean;
}

export interface ReadSection {
  title: string | null;
  showSubtotal: boolean;
  lines: ReadLine[];
}

export interface ReadAdjustment {
  label: string;
  /** « % », « pour cent » dits explicitement → percent ; un montant → amount. Jamais converti. */
  mode: "percent" | "amount";
  sign: 1 | -1;
  base: "items_total" | "taxable_base";
  /** Valeur telle que dite (« 25 », « 160 000 »), null si absente ou incertaine. */
  valueText: string | null;
}

export type DocumentType = "quote" | "proforma" | "invoice" | "delivery_note";

/** Lecture d'une source (texte, transcription, photo). */
export interface SaleReading {
  documentType: DocumentType | null;
  clientName: string | null;
  clientPhone?: string | null;
  clientAddress?: string | null;
  /** Objet du document (« supports 60 modules, mairie Agoè »). */
  title: string | null;
  sections: ReadSection[];
  adjustments: ReadAdjustment[];
  site?: string | null;
  deliveryText?: string | null;
  warrantyText?: string | null;
  assumptions?: string | null;
  validityDaysText?: string | null;
  depositPercentText?: string | null;
  /** Texte réellement lu (transcription d'une photo) : la garde vérifie les nombres contre lui. */
  sourceText?: string | null;
}

export interface ReadContext {
  locale: string;
  currencyCode: string;
  currencySymbol: string;
  /** Unités courantes (proposées, jamais imposées). */
  units: Array<{ code: string; label: string; short?: string }>;
  trade: string | null;
}

export interface AiCall<T> {
  value: T;
  usage: { model: string; inputTokens?: number; outputTokens?: number; audioSeconds?: number; durationMs: number };
}

/** Intentions d'un tour de conversation (les mêmes que la v1, plus la demande de suppression). */
export const INTENTS = [
  "greeting", "admin", "confirm", "finalize", "preview", "settings", "show_latest", "download_latest",
  "list_documents", "quota", "subscription", "stats", "search", "convert", "duplicate", "share",
  "new_document", "help", "source", "delete_data", "other",
] as const;
export type Intent = (typeof INTENTS)[number];

export type DocumentField =
  | "client_name" | "client_phone" | "client_address" | "subject" | "summary" | "site" | "delivery_text"
  | "warranty_text" | "assumptions" | "validity_days" | "deposit_percent" | "tax" | "type";

/**
 * Correction demandée en langage naturel. Positions telles qu'affichées dans le chat : ligne n (1…),
 * section n (1…), ajustement n (1…). `valueText` est recopié du message ; tout nombre est vérifié
 * contre le message de l'artisan avant d'être appliqué.
 */
export type Correction =
  | { target: "line"; op: "set"; line: number; field: "label" | "description" | "unit" | "quantity" | "unit_price" | "flat_amount"; valueText: string | null }
  | { target: "line"; op: "remove"; line: number }
  | { target: "line"; op: "add"; section: number | null; line: ReadLine }
  | { target: "line"; op: "move"; line: number; section: number }
  | { target: "section"; op: "set"; section: number; field: "title" | "show_subtotal"; valueText: string | null }
  | { target: "section"; op: "add"; title: string; lines: ReadLine[] }
  | { target: "section"; op: "remove"; section: number }
  | { target: "adjustment"; op: "set"; adjustment: number; field: "label" | "value" | "mode" | "sign" | "base"; valueText: string | null }
  | { target: "adjustment"; op: "add"; adjustment: ReadAdjustment }
  | { target: "adjustment"; op: "remove"; adjustment: number }
  | { target: "document"; op: "set"; field: DocumentField; valueText: string | null }
  | { target: "document"; op: "append"; field: "assumptions"; valueText: string }
  | { target: "payment"; op: "add"; amountText: string; method: string | null };

/** Décision prise sur un tour : une intention, des corrections éventuelles, une réponse courte. */
export interface TurnDecision {
  intent: Intent;
  corrections: Correction[];
  /** Réponse naturelle (salutation, aide, question précise) : deux phrases au plus, sans emoji. */
  reply: string | null;
  searchQuery: string | null;
  targetType: DocumentType | null;
  /** Nouveau document explicitement demandé avec ses données dans le même message. */
  startNewDocument: boolean;
}

/** Échange précédent, pour le contexte (12 échanges complets au plus). */
export interface HistoryTurn {
  role: "user" | "firmo";
  text: string;
}

export interface TurnContext extends ReadContext {
  /** Brouillon actif tel que le voit l'artisan (ou null). */
  draft: string | null;
  /** Dernier document émis (résumé), pour « télécharge le dernier », « fais la facture ». */
  latest: string | null;
  history: HistoryTurn[];
  /** Question posée par Firmo au tour précédent (client, quantité…), si elle attend une réponse. */
  awaiting: string | null;
}

export interface AiReader {
  /** Lecture réelle (IA) ou simplifiée (règles, sans clé). */
  readonly simulated: boolean;
  transcribe(audio: Buffer, mediaType: string, locale: string): Promise<AiCall<string | null>>;
  readText(text: string, ctx: ReadContext): Promise<AiCall<SaleReading>>;
  readImage(image: Buffer, mediaType: string, ctx: ReadContext): Promise<AiCall<SaleReading>>;
  decide(message: string, ctx: TurnContext): Promise<AiCall<TurnDecision>>;
}

export const EMPTY_READING: SaleReading = { documentType: null, clientName: null, title: null, sections: [], adjustments: [] };
