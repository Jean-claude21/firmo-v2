import type pg from "pg";

// Worker de traitement (décision 0005) : réclame des tâches dans la file `jobs`, appelle le
// gestionnaire de leur type, enregistre le succès ou l'échec. Réveillé par ce processus quand une
// tâche est créée ou qu'une requête a écrit en base ; sinon il dort jusqu'à l'échéance de la
// prochaine tâche, une heure au plus. Plus de LISTEN : Neon coupe la connexion en s'endormant, et la
// reconnexion le réveillait (LEARNINGS-BASES-SERVERLESS.md).

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
  /** Milliseconds until the next pending job is due (0 if one is due), or null if none. */
  nextDueIn?(): Promise<number | null>;
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
    async nextDueIn() {
      const r = await pool.query<{ ms: string | null }>(
        "select greatest(0, extract(epoch from min(run_at) - now()) * 1000)::bigint::text as ms from public.jobs where status = 'pending'",
      );
      const ms = r.rows[0]?.ms;
      return ms == null ? null : Number(ms);
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
          if (again) return this.schedule(0);
          void this.nextDelay().then((next) => {
            if (!this.stopped) this.schedule(next);
          });
        });
    }, delay);
  }

  /**
   * Le prochain passage : à l'échéance de la prochaine tâche, au plus tard dans `pollMs` (une heure
   * par défaut). Entre deux, rien ne lit la base : Neon peut dormir. Une tâche créée par ce
   * processus réveille le worker tout de suite (`wake`).
   */
  private async nextDelay(): Promise<number> {
    const ceiling = this.options.pollMs ?? 60 * 60_000;
    const due = await this.store.nextDueIn?.().catch(() => null);
    return due == null ? ceiling : Math.min(Math.max(due, 1000), ceiling);
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
