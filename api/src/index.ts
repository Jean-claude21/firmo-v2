// Point d'entrée : API HTTP (Hono sur Node) et worker dans le même processus (décision 0005).
import { serve } from "@hono/node-server";
import { createApp, type RouteModule } from "./app.js";
import { loadConfig, splitList } from "./config.js";
import { createPool } from "./lib/db.js";
import { sentryReporter } from "./lib/report.js";
import { sessionSigner } from "./lib/session.js";
import { pgPortalSessionStore } from "./routes/portal-session.js";
import { buildServices } from "./services.js";
import { listenForJobs, pgJobStore, Worker } from "./worker/worker.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const signer = sessionSigner(config.FIRMO_SESSION_SECRET);
const report = config.ERROR_REPORTING_DSN
  ? sentryReporter(config.ERROR_REPORTING_DSN, { environment: config.FIRMO_ENV })
  : undefined;
const reportError = (error: unknown, context: Record<string, unknown>) => void report?.(error, context);

const jobs = pgJobStore(pool);
const worker = new Worker(jobs, {
  name: `api-${process.pid}`,
  concurrency: config.WORKER_CONCURRENCY,
  log: (message, error) => console.error(message, error ?? ""),
  report: reportError,
});

// Services des specs (canaux, documents, rendu, portail, administration…) : routes et tâches.
const services = await buildServices({ config, pool, signer, jobs, worker, reportError });
const modules: RouteModule[] = services.modules;

const app = createApp({
  env: config.FIRMO_ENV,
  signer,
  allowedOrigins: splitList(config.ALLOWED_ORIGINS),
  health: {
    database: async () => (await pool.query("select 1")).rowCount === 1,
    worker: () => config.WORKER_ENABLED === "false" || worker.isRunning,
  },
  portalSessions: pgPortalSessionStore(pool),
  modules,
  reportError,
});

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) =>
  console.log(`firmo-api (${config.FIRMO_ENV}) sur :${info.port}`),
);

let stopListening: (() => void) | undefined;
if (config.WORKER_ENABLED === "true") {
  worker.start();
  stopListening = listenForJobs(pool, () => worker.wake(), (m, e) => console.error(m, e ?? ""));
  services.startSchedules?.();
}

async function shutdown(signal: string) {
  console.log(`arrêt (${signal})`);
  server.close();
  stopListening?.();
  services.stopSchedules?.();
  await worker.stop();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
