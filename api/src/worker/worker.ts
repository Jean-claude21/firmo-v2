import type pg from "pg";

// Worker de traitement (décision 0005) : réclame des tâches dans la file `jobs`, appelle le
// gestionnaire de leur type, enregistre le succès ou l'échec. Réveillé par NOTIFY firmo_jobs,
// sinon interroge la file à intervalle régulier (tâches différées, reprises).

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Erreur définitive : la tâche est marquée échouée sans nouvelle tentative. */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

export type JobHandler = (job: Job) => Promise<void>;

export interface JobStore {
  claim(worker: string, limit: number): Promise<Job[]>;
  complete(id: string): Promise<void>;
  fail(id: string, error: string, retry: boolean): Promise<void>;
  enqueue(kind: string, payload: Record<string, unknown>, dedupeKey?: string, runAt?: Date): Promise<string | null>;
}

export function pgJobStore(pool: pg.Pool): JobStore {
  return {
    async claim(worker, limit) {
      const r = await pool.query<{ id: string; kind: string; payload: Record<string, unknown>; attempts: number }>(
        "select id::text, kind, payload, attempts from app.claim_jobs($1, $2)",
        [worker, limit],
      );
      return r.rows;
    },
    async complete(id) {
      await pool.query("select app.complete_job($1)", [id]);
    },
    async fail(id, error, retry) {
      await pool.query("select app.fail_job($1, $2, $3)", [id, error, retry]);
    },
    async enqueue(kind, payload, dedupeKey, runAt) {
      const r = await pool.query<{ id: string | null }>(
        "select app.enqueue_job($1, $2, $3, coalesce($4, now()))::text as id",
        [kind, payload, dedupeKey ?? null, runAt ?? null],
      );
      return r.rows[0]?.id ?? null;
    },
  };
}

export interface WorkerOptions {
  name: string;
  concurrency: number;
  pollMs?: number;
  log?: (message: string, error?: unknown) => void;
  report?: (error: unknown, context: Record<string, unknown>) => void;
}

export class Worker {
  private readonly handlers = new Map<string, JobHandler>();
  private running = 0;
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;
  private draining: Promise<void> | undefined;
  private wakeRequested = false;

  constructor(
    private readonly store: JobStore,
    private readonly options: WorkerOptions,
  ) {}

  on(kind: string, handler: JobHandler): this {
    this.handlers.set(kind, handler);
    return this;
  }

  get isRunning(): boolean {
    return !this.stopped;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.draining;
    while (this.running > 0) await new Promise((r) => setTimeout(r, 50));
  }

  /** Réveil immédiat (NOTIFY reçu, tâche créée par ce processus). */
  wake(): void {
    if (this.stopped) return;
    if (this.draining) {
      this.wakeRequested = true;
      return;
    }
    this.schedule(0);
  }

  /** Traite les tâches prêtes jusqu'à épuisement (tests, appel manuel). */
  async drain(): Promise<number> {
    let processed = 0;
    for (;;) {
      const free = this.options.concurrency - this.running;
      if (free <= 0) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      const jobs = await this.store.claim(this.options.name, free);
      if (jobs.length === 0) break;
      await Promise.all(jobs.map((job) => this.run(job)));
      processed += jobs.length;
    }
    return processed;
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.draining = this.drain()
        .then(() => undefined)
        .catch((error) => this.options.log?.("[worker] file indisponible", error))
        .finally(() => {
          this.draining = undefined;
          if (this.stopped) return;
          const again = this.wakeRequested;
          this.wakeRequested = false;
          this.schedule(again ? 0 : (this.options.pollMs ?? 2000));
        });
    }, delay);
  }

  private async run(job: Job): Promise<void> {
    this.running += 1;
    try {
      const handler = this.handlers.get(job.kind);
      if (!handler) throw new PermanentJobError(`type de tâche inconnu : ${job.kind}`);
      await handler(job);
      await this.store.complete(job.id);
    } catch (error) {
      const permanent = error instanceof PermanentJobError;
      const message = error instanceof Error ? error.message : String(error);
      this.options.log?.(`[worker] ${job.kind}#${job.id} en échec (essai ${job.attempts})`, error);
      if (!permanent) this.options.report?.(error, { job: job.kind, attempt: job.attempts });
      await this.store.fail(job.id, message, !permanent).catch(() => undefined);
    } finally {
      this.running -= 1;
    }
  }
}

/** Écoute NOTIFY firmo_jobs sur une connexion dédiée ; se reconnecte en cas de coupure. */
export function listenForJobs(pool: pg.Pool, onNotify: () => void, log?: (m: string, e?: unknown) => void) {
  let client: pg.PoolClient | undefined;
  let closed = false;
  const connect = async () => {
    try {
      client = await pool.connect();
      client.on("notification", () => onNotify());
      client.on("error", (error) => {
        log?.("[worker] écoute interrompue", error);
        client?.release(true);
        client = undefined;
        if (!closed) setTimeout(connect, 2000);
      });
      await client.query("listen firmo_jobs");
    } catch (error) {
      log?.("[worker] écoute impossible", error);
      if (!closed) setTimeout(connect, 5000);
    }
  };
  void connect();
  return () => {
    closed = true;
    client?.release(true);
  };
}
