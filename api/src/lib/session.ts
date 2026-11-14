import { createHash, randomBytes } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { jwtVerify, SignJWT } from "jose";
import { httpErrors } from "./errors.js";

// Sessions Firmo (ARCHITECTURE.md) : JWT HS256 signés par l'API.
// - scope « org »   : artisan, après échange d'un lien à usage unique envoyé dans le chat ;
// - scope « staff » : membre de l'équipe, après connexion Neon Auth et vérification du rôle.

export type Session =
  | { scope: "org"; orgId: string }
  | { scope: "staff"; userId: string; role: "admin" | "support"; email: string };

const ISSUER = "firmo";

export interface SessionSigner {
  sign(session: Session, ttlSeconds: number): Promise<string>;
  verify(token: string): Promise<Session>;
}

export function sessionSigner(secret: string): SessionSigner {
  const key = new TextEncoder().encode(secret);
  return {
    async sign(session, ttlSeconds) {
      const claims =
        session.scope === "org"
          ? { scope: "org", sub: session.orgId }
          : { scope: "staff", sub: session.userId, role: session.role, email: session.email };
      return new SignJWT(claims)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
        .sign(key);
    },
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ["HS256"] });
        if (payload.scope === "org" && typeof payload.sub === "string") {
          return { scope: "org", orgId: payload.sub };
        }
        if (
          payload.scope === "staff" &&
          typeof payload.sub === "string" &&
          (payload.role === "admin" || payload.role === "support") &&
          typeof payload.email === "string"
        ) {
          return { scope: "staff", userId: payload.sub, role: payload.role, email: payload.email };
        }
      } catch {
        // signature, émetteur ou expiration invalides : refus ci-dessous
      }
      throw httpErrors.unauthenticated("session invalide ou expirée");
    },
  };
}

export type SessionVariables = { session: Session };

function bearer(header: string | undefined): string {
  const [scheme, token] = (header ?? "").split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) throw httpErrors.unauthenticated();
  return token;
}

/** Exige une session artisan. */
export function requireOrg(signer: SessionSigner): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = await signer.verify(bearer(c.req.header("authorization")));
    if (session.scope !== "org") throw httpErrors.forbidden("session artisan requise");
    c.set("session", session);
    await next();
  };
}

/** Exige une session d'équipe ; `roles` restreint les rôles admis. */
export function requireStaff(
  signer: SessionSigner,
  roles: Array<"admin" | "support"> = ["admin", "support"],
): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const session = await signer.verify(bearer(c.req.header("authorization")));
    if (session.scope !== "staff" || !roles.includes(session.role)) {
      throw httpErrors.forbidden("rôle insuffisant");
    }
    c.set("session", session);
    await next();
  };
}

/** Jeton aléatoire (lien à usage unique, partage) et son empreinte stockée en base. */
export function newToken(bytes = 32): { token: string; hash: Buffer } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function orgIdOf(session: Session): string {
  if (session.scope !== "org") throw httpErrors.forbidden();
  return session.orgId;
}

export function staffOf(session: Session) {
  if (session.scope !== "staff") throw httpErrors.forbidden();
  return session;
}
