// Liens vers la conversation avec Firmo (le chat est l'entrée principale, constitution VIII).
// Numéro WhatsApp et bot Telegram sont des variables de construction ; sans elles, pas de lien.

const WHATSAPP = (import.meta.env.VITE_WHATSAPP_NUMBER as string | undefined)?.replace(/[^\d]/g, "") || null;
const TELEGRAM = (import.meta.env.VITE_TELEGRAM_BOT as string | undefined)?.replace(/^@/, "") || null;

export type ChatChannel = "whatsapp" | "telegram";

/** Canal à proposer : celui que l'artisan utilise déjà, sinon WhatsApp, sinon Telegram. */
export function chatChannel(used: string[] = []): ChatChannel | null {
  if (used.includes("whatsapp") && WHATSAPP) return "whatsapp";
  if (used.includes("telegram") && TELEGRAM) return "telegram";
  if (WHATSAPP) return "whatsapp";
  if (TELEGRAM) return "telegram";
  return null;
}

/** Lien qui ouvre la conversation, avec un message prérempli quand le canal le permet. */
export function chatLink(channel: ChatChannel | null, text?: string): string | null {
  if (channel === "whatsapp" && WHATSAPP) return `https://wa.me/${WHATSAPP}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
  // Telegram n'accepte pas de texte prérempli vers un bot : la conversation s'ouvre.
  if (channel === "telegram" && TELEGRAM) return `https://t.me/${TELEGRAM}`;
  return null;
}

export const chatConfigured = Boolean(WHATSAPP || TELEGRAM);
