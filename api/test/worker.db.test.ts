import { afterAll, describe, expect, it } from "vitest";
import { pgJobStore, Worker } from "../src/worker/worker.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

describe.skipIf(!hasDatabase)("worker sur Postgres", () => {
  const pool = testPool();
  afterAll(() => pool.end());

  it("traite une tâche réelle une seule fois, même avec deux workers", async () => {
    // Type en lettres seulement (contrainte `jobs_kind_check`).
    const kind = `test_${uid("k").replace(/[^a-z]/g, "")}`;
    const store = pgJobStore(pool);
    const key = uid("dedupe");
    const id = await store.enqueue(kind, { n: 1 }, key);
    expect(id).not.toBeNull();
    expect(await store.enqueue(kind, { n: 2 }, key)).toBeNull();

    const seen: string[] = [];
    const handler = async (job: { id: string }) => {
      seen.push(job.id);
    };
    const a = new Worker(store, { name: "a", concurrency: 2 }).on(kind, handler);
    const b = new Worker(store, { name: "b", concurrency: 2 }).on(kind, handler);
    // Les autres types éventuellement présents dans la file sont ignorés par ces workers :
    // on ne réclame que des tâches neuves de ce test.
    await Promise.all([a.drain(), b.drain()]);
    expect(seen.filter((s) => s === id)).toHaveLength(1);
    const row = await pool.query("select status from public.jobs where id = $1", [id]);
    expect(row.rows[0]?.status).toBe("done");
  });
});
