// Canaux de messagerie (CH-1, CH-5) derrière une seule interface : en ajouter un ne change pas
// le moteur de conversation (constitution IV).

export type InboundKind = "text" | "audio" | "image" | "document" | "interactive" | "form";

export interface InboundMessage {
  channel: string;
  /** Identifiant du message chez le canal : idempotence. */
  externalId: string;
  from: { id: string; name: string | null; phone: string | null; locale: string | null };
  kind: InboundKind;
  /** Texte, légende, ou identifiant du bouton choisi. */
  text: string | null;
  media: { ref: string; mediaType: string | null } | null;
  /** Réponse d'un formulaire (WhatsApp Flows) : champs → valeurs. */
  form?: { name: string; values: Record<string, string> } | null;
}

export interface Button {
  id: string;
  title: string;
}

export interface OutboundResult {
  externalId: string | null;
}

export interface Channel {
  readonly code: string;
  sendText(to: string, text: string, buttons?: Button[]): Promise<OutboundResult>;
  sendImage(to: string, image: Buffer, caption?: string): Promise<OutboundResult>;
  sendDocument(to: string, file: Buffer, filename: string, caption?: string): Promise<OutboundResult>;
  /** Télécharge un média entrant (ref fournie par le webhook). */
  downloadMedia(ref: string): Promise<{ bytes: Buffer; mediaType: string }>;
  /** Formulaire natif (WhatsApp Flows) ; absent : lien vers le formulaire web. */
  sendForm?(to: string, form: string, cta: string, body: string): Promise<OutboundResult | null>;
}

export class ChannelError extends Error {
  override name = "ChannelError";
  constructor(
    message: string,
    /** Erreur passagère (réseau, 5xx, limite) : la tâche sera retentée. */
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** Appel HTTP d'un canal : erreur réseau ou 5xx → retentable ; 4xx → définitive. */
export async function channelFetch(url: string, init: RequestInit, label: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new ChannelError(`${label} : réseau (${(error as Error).message})`, true);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 500);
    throw new ChannelError(`${label} : HTTP ${res.status} ${body}`, res.status >= 500 || res.status === 429);
  }
  return res;
}
