import pg from "pg";

// Tests sur une vraie base (locale ou CI) : actifs seulement si TEST_DATABASE_URL est défini.
// Chaque test travaille dans des données qu'il crée ; rien n'est supposé sur le contenu.
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";
export const hasDatabase = TEST_DATABASE_URL !== "";

export function testPool(): pg.Pool {
  return new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
}

/** Identifiant unique pour isoler les données d'un test. */
export function uid(prefix = "t"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
