import pg from "pg";
import { type HttpError, httpErrors } from "./errors.js";

// Les règles métier vivent en SQL (constitution III) : l'API appelle des fonctions `app.*`
// transactionnelles et traduit leurs refus en erreurs HTTP.

// bigint (int8) → string par défaut ; les montants restent des chaînes jusqu'à l'affichage
// pour ne jamais perdre de précision. numeric aussi (quantités).
export function createPool(databaseUrl: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max });
}

export type Db = Pick<pg.Pool, "query">;

/** Exécute `work` dans une transaction, annulée en cas d'erreur. */
export async function withTransaction<T>(
  pool: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Erreur Postgres → erreur HTTP : les refus décidés en SQL gardent leur sens
 * (permission 42501, absence P0002, entrée invalide 22023/23514/P0001, conflit 23505).
 */
export function fromPgError(error: unknown): HttpError | unknown {
  const code = (error as { code?: string } | null)?.code;
  const message = (error as { message?: string } | null)?.message ?? "erreur";
  switch (code) {
    case "42501":
      return httpErrors.forbidden(message);
    case "P0002":
      return httpErrors.notFound(message);
    case "23505":
      return httpErrors.conflict(message);
    case "22023":
    case "23514":
    case "P0001":
      return httpErrors.validation({ _: message }, message);
    default:
      return error;
  }
}

/** Requête dont les erreurs SQL deviennent des erreurs HTTP. */
export async function sql<T extends pg.QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await db.query<T>(text, values);
    return result.rows;
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function sqlOne<T extends pg.QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<T> {
  const rows = await sql<T>(db, text, values);
  const row = rows[0];
  if (!row) throw httpErrors.notFound();
  return row;
}
