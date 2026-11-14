import type pg from "pg";
import type { RouteModule } from "./app.js";
import type { Config } from "./config.js";
import type { SessionSigner } from "./lib/session.js";
import type { JobStore, Worker } from "./worker/worker.js";

// Assemblage des services de chaque spec : adapters réels selon la configuration, routes et
// gestionnaires de tâches. Un service externe non configuré est remplacé par son simulateur.

export interface ServiceContext {
  config: Config;
  pool: pg.Pool;
  signer: SessionSigner;
  jobs: JobStore;
  worker: Worker;
  reportError: (error: unknown, context: Record<string, unknown>) => void;
}

export interface Services {
  modules: RouteModule[];
  startSchedules?: () => void;
  stopSchedules?: () => void;
}

export async function buildServices(_ctx: ServiceContext): Promise<Services> {
  return { modules: [] };
}
