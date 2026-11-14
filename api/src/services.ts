import type pg from "pg";
import type { RouteModule } from "./app.js";
import type { Config } from "./config.js";
import { pgDocumentStore, type DocumentStore } from "./documents/store.js";
import type { SessionSigner } from "./lib/session.js";
import { diskStore, type ObjectStore, s3Store } from "./lib/storage.js";
import { DocumentRenderer } from "./render/renderer.js";
import { RenderService } from "./render/service.js";
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
  documents: DocumentStore;
  files: ObjectStore;
  render: RenderService;
  startSchedules?: () => void;
  stopSchedules?: () => void;
}

export function objectStore(config: Config): ObjectStore {
  if (config.S3_ENDPOINT && config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY && config.S3_BUCKET) {
    return s3Store({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      bucket: config.S3_BUCKET,
    });
  }
  if (config.FIRMO_ENV === "production") {
    throw new Error("stockage S3 obligatoire en production");
  }
  return diskStore(config.STORAGE_DIR);
}

export async function buildServices(ctx: ServiceContext): Promise<Services> {
  const { config, pool, worker } = ctx;
  const files = objectStore(config);
  const documents = pgDocumentStore(pool, { shareSecret: config.FIRMO_SHARE_SECRET });
  const render = new RenderService({
    pool,
    documents,
    files,
    renderer: new DocumentRenderer(),
    shareSecret: config.FIRMO_SHARE_SECRET,
    webUrl: config.WEB_URL,
  });
  worker.on("render_document", (job) => render.handleJob(job));

  return { modules: [], documents, files, render };
}
