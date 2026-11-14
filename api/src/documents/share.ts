import { createHmac } from "node:crypto";

// Jeton de partage d'un document (ART-7), dérivé de son identifiant : le rendu (QR code), le chat
// et le web le recalculent sans le stocker en clair. Seule son empreinte SHA-256 est en base,
// avec une date d'expiration ; changer de secret révoque tous les liens.
export function shareToken(secret: string, documentId: string): string {
  return createHmac("sha256", secret).update(`share:${documentId}`).digest("base64url").slice(0, 32);
}

export function shareUrl(webUrl: string, token: string): string {
  return `${webUrl.replace(/\/$/, "")}/d/${token}`;
}
