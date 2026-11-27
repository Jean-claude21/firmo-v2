import type pg from "pg";
import type { ObjectStore } from "../lib/storage.js";

// Tâches de fond de la spec 014 : relais des événements vers Umami (P-80, décision du porteur) et suppression des
// médias sources après la durée réglée (P-81). Chaque fournisseur est derrière une interface.

export interface AnalyticsEvent {
  event: string;
  distinctId: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

/** Destination des événements (Umami en production, double en test). */
export interface AnalyticsSink {
  send(events: AnalyticsEvent[]): Promise<void>;
}

/**
 * Umami (installé par Kete sur son serveur) : un événement par appel à /api/send. Les propriétés
 * sont déjà filtrées en SQL (aucun nom, téléphone, prix ni contenu). Sans identifiant : aucun envoi.
 */
export function umamiSink(config: { url: string; websiteId: string; hostname?: string; fetchImpl?: typeof fetch }): AnalyticsSink {
  const send = config.fetchImpl ?? fetch;
  const url = `${config.url.replace(/\/$/, "")}/api/send`;
  return {
    async send(events) {
      for (const e of events) {
        const res = await send(url, {
          method: "POST",
          // Umami écarte les robots : l'en-tête identifie l'API sans rien dire de l'artisan.
          headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (compatible; FirmoAPI/1.0)" },
          body: JSON.stringify({ type: "event", payload: { website: config.websiteId, hostname: config.hostname ?? "api.firmo", url: "/serveur", name: e.event, data: e.properties } }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Umami ${res.status}`);
      }
    },
  };
}

/**
 * Envoie les événements non relayés, filtrés en SQL (app.analytics_batch : propriétés techniques
 * seulement). Marqués relayés seulement si l'envoi a réussi. Renvoie le nombre envoyé.
 */
export async function relayAnalytics(pool: pg.Pool, sink: AnalyticsSink, limit = 500): Promise<number> {
  const rows = (await pool.query<{ id: string; name: string; org_id: string | null; props: Record<string, unknown>; created_at: Date }>(
    "select id::text, name, org_id, props, created_at from app.analytics_batch($1)", [limit])).rows;
  if (!rows.length) return 0;
  await sink.send(rows.map((r) => ({
    event: r.name,
    // Identifiant technique de l'organisation : jamais un nom ni un téléphone.
    distinctId: r.org_id ?? "firmo-system",
    properties: r.props,
    timestamp: r.created_at.toISOString(),
  })));
  await pool.query("select app.mark_forwarded($1::bigint[])", [rows.map((r) => r.id)]);
  return rows.length;
}

/** Supprime du stockage les médias sources trop anciens, puis efface leur référence. */
export async function purgeMedia(pool: pg.Pool, files: ObjectStore, limit = 200): Promise<number> {
  const rows = (await pool.query<{ message_id: string; media_key: string }>("select message_id, media_key from app.media_to_purge($1)", [limit])).rows;
  const done: string[] = [];
  for (const r of rows) {
    try {
      await files.delete(r.media_key);
      done.push(r.message_id);
    } catch (error) {
      // Fichier déjà absent : la référence part quand même ; autre erreur : on réessaiera.
      if (/ENOENT|NoSuchKey|not found|404/i.test(String((error as Error).message))) done.push(r.message_id);
    }
  }
  if (done.length) await pool.query("select app.mark_media_purged($1::uuid[])", [done]);
  return done.length;
}

/** Lance les deux tâches à intervalle régulier ; renvoie de quoi les arrêter. */
export function startMaintenance(opts: { pool: pg.Pool; files: ObjectStore; sink: AnalyticsSink | null; log: (m: string, e?: unknown) => void }) {
  const timers: NodeJS.Timeout[] = [];
  const safe = (name: string, run: () => Promise<number>) => async () => {
    try {
      await run();
    } catch (error) {
      opts.log(`maintenance ${name} en échec`, error);
    }
  };
  if (opts.sink) {
    const sink = opts.sink;
    // Par lot, toutes les heures : chaque passage réveille la base (LEARNINGS-BASES-SERVERLESS.md).
    timers.push(setInterval(safe("analytics", () => relayAnalytics(opts.pool, sink)), 60 * 60_000));
  }
  timers.push(setInterval(safe("media", () => purgeMedia(opts.pool, opts.files)), 24 * 60 * 60_000));
  for (const t of timers) t.unref();
  return () => timers.forEach(clearInterval);
}
