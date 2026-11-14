import type { Hono } from "hono";
import { z } from "zod";
import type { Db } from "../lib/db.js";
import { sql } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { parseJson } from "../lib/validate.js";
import { type SessionSigner, tokenHash } from "../lib/session.js";

// Échange d'un lien à usage unique (envoyé dans le chat) contre une session artisan (ART-1).

export interface PortalSessionStore {
  consume(hash: Buffer): Promise<{ orgId: string; purpose: string; target: string | null }>;
  sessionDays(): Promise<number>;
}

export function pgPortalSessionStore(db: Db): PortalSessionStore {
  return {
    async consume(hash) {
      const rows = await sql<{ org_id: string; purpose: string; target: string | null }>(
        db,
        "select org_id, purpose, target from app.consume_access_link($1)",
        [hash],
      );
      const row = rows[0];
      if (!row) throw httpErrors.notFound("lien invalide");
      return { orgId: row.org_id, purpose: row.purpose, target: row.target };
    },
    async sessionDays() {
      const rows = await sql<{ days: number }>(db, "select (app.setting('org_session_days') #>> '{}')::int as days");
      return rows[0]?.days ?? 7;
    },
  };
}

const body = z.object({ token: z.string().min(16).max(128) });

export function registerPortalSession(app: Hono<any>, signer: SessionSigner, store: PortalSessionStore) {
  app.post("/v1/portal/session", async (c) => {
    const { token } = await parseJson(c, body);
    const link = await store.consume(tokenHash(token));
    const ttl = (await store.sessionDays()) * 86_400;
    const session = await signer.sign({ scope: "org", orgId: link.orgId }, ttl);
    return c.json({
      token: session,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      purpose: link.purpose,
      target: link.target,
    });
  });
}
