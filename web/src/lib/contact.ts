// Coordonnées publiques de Firmo (pages Contact et légales). Éditeur et e-mail : Kete. Numéros de
// messagerie et horaires : variables de construction, rien d'affiché sans valeur.

const env = import.meta.env as Record<string, string | undefined>;

export const contact = {
  // Éditeur : Kete (kete.digital), comme pour les autres produits de Kete.
  publisher: env.VITE_PUBLISHER_NAME?.trim() || "Kete",
  publisherDetails: env.VITE_PUBLISHER_DETAILS?.trim() || "kete.digital, activité exercée en indépendant",
  email: env.VITE_SUPPORT_EMAIL?.trim() || "contact@kete.digital",
  supportWhatsapp: env.VITE_SUPPORT_WHATSAPP?.replace(/[^\d]/g, "") || null,
  hours: env.VITE_SUPPORT_HOURS?.trim() || null,
  whatsapp: env.VITE_WHATSAPP_NUMBER?.replace(/[^\d]/g, "") || null,
  telegram: env.VITE_TELEGRAM_BOT?.replace(/^@/, "") || null,
};

/** Numéro au format international, sans deviner l'indicatif (sa longueur varie selon le pays). */
export function phoneText(digits: string): string {
  return `+${digits}`;
}
