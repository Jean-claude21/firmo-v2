// Erreurs HTTP normalisées. Corps : { error: { code, message, fields? } } ; `message` est
// technique, sans donnée personnelle.

export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation"
  | "link_expired"
  | "link_invalid"
  | "org_suspended"
  | "rate_limited"
  | "unavailable"
  | "internal";

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429 | 500 | 503;

export class HttpError extends Error {
  constructor(
    readonly status: ErrorStatus,
    readonly code: ErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }

  toBody() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    };
  }
}

export const httpErrors = {
  badRequest: (message = "requête invalide") =>
    new HttpError(400, "bad_request", message),
  unauthenticated: (message = "session requise") =>
    new HttpError(401, "unauthenticated", message),
  forbidden: (message = "action non autorisée") =>
    new HttpError(403, "forbidden", message),
  notFound: (message = "introuvable") => new HttpError(404, "not_found", message),
  conflict: (message = "conflit") => new HttpError(409, "conflict", message),
  validation: (fields: Record<string, string>, message = "entrée invalide") =>
    new HttpError(422, "validation", message, fields),
  rateLimited: (message = "trop de requêtes") =>
    new HttpError(429, "rate_limited", message),
  /** Service externe non configuré ou en échec : l'app passe au repli prévu. */
  unavailable: (message = "service indisponible") =>
    new HttpError(503, "unavailable", message),
  internal: (message = "erreur interne") =>
    new HttpError(500, "internal", message),
};

/** Convertit toute erreur en HttpError ; une erreur inconnue devient 500. */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return httpErrors.internal();
}
