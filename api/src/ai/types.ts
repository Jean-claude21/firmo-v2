// Lecture d'une vente (DOC-1) : l'IA RECOPIE ce que l'artisan a dit ou écrit. Les nombres
// restent du texte tel quel ; la conversion et la garde anti-invention sont faites ensuite.

export interface ReadLine {
  label: string;
  /** Quantité telle qu'écrite ou dite (« 2 », « 1,5 »), null si absente. */
  quantityText: string | null;
  /** Code d'unité parmi la liste fournie, ou null. */
  unit: string | null;
  /** Prix unitaire tel qu'écrit ou dit, null si absent. */
  unitPriceText: string | null;
  /** Montant de ligne tel qu'écrit (quand seul le total est donné), null sinon. */
  lineTotalText: string | null;
}

export interface SaleReading {
  documentType: "quote" | "proforma" | "invoice" | "delivery_note" | null;
  clientName: string | null;
  title: string | null;
  lines: ReadLine[];
}

export interface ReadContext {
  locale: string;
  currencyCode: string;
  currencySymbol: string;
  /** Unités disponibles : code → libellé. */
  units: Array<{ code: string; label: string }>;
  trade: string | null;
}

export interface AiCall<T> {
  value: T;
  usage: { model: string; inputTokens?: number; outputTokens?: number; audioSeconds?: number; durationMs: number };
}

/** Modification d'un brouillon demandée en langage libre (DOC-2), valeurs en texte brut. */
export type EditOp =
  | { op: "set_price"; line: number; valueText: string }
  | { op: "set_quantity"; line: number; valueText: string }
  | { op: "set_label"; line: number; text: string }
  | { op: "set_unit"; line: number; unit: string | null }
  | { op: "remove"; line: number }
  | { op: "add"; lines: ReadLine[] }
  | { op: "client"; name: string | null }
  | { op: "title"; text: string | null }
  | { op: "discount"; valueText: string | null }
  | { op: "tax"; enabled: boolean };

export interface Interpretation {
  /** new_sale : le message décrit une nouvelle vente ; edit : il corrige le brouillon. */
  action: "new_sale" | "edit" | "issue" | "cancel" | "help" | "list" | "settings" | "other";
  ops: EditOp[];
}

export interface AiReader {
  /** Lecture réelle (IA) ou simplifiée (règles, sans clé). */
  readonly simulated: boolean;
  transcribe(audio: Buffer, mediaType: string, locale: string): Promise<AiCall<string | null>>;
  readText(text: string, ctx: ReadContext): Promise<AiCall<SaleReading>>;
  readImage(image: Buffer, mediaType: string, ctx: ReadContext): Promise<AiCall<SaleReading>>;
  interpret(text: string, draftSummary: string, ctx: ReadContext): Promise<AiCall<Interpretation>>;
}
