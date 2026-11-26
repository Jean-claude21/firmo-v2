// Coordonnées publiques de Firmo (pages Contact et légales). Ce sont des variables de construction :
// sans valeur, la ligne n'est pas affichée (on n'invente aucune coordonnée).

const env = import.meta.env as Record<string, string | undefined>;

export const contact = {
  publisher: env.VITE_PUBLISHER_NAME?.trim() || null,
  publisherDetails: env.VITE_PUBLISHER_DETAILS?.trim() || null,
  email: env.VITE_SUPPORT_EMAIL?.trim() || null,
  supportWhatsapp: env.VITE_SUPPORT_WHATSAPP?.replace(/[^\d]/g, "") || null,
  hours: env.VITE_SUPPORT_HOURS?.trim() || null,
  whatsapp: env.VITE_WHATSAPP_NUMBER?.replace(/[^\d]/g, "") || null,
  telegram: env.VITE_TELEGRAM_BOT?.replace(/^@/, "") || null,
};

/** Numéro au format international, sans deviner l'indicatif (sa longueur varie selon le pays). */
export function phoneText(digits: string): string {
  return `+${digits}`;
}
