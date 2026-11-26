import type pg from "pg";
import type { RouteModule } from "./app.js";
import type { Config } from "./config.js";
import { openAiReader } from "./ai/openai.js";
import { rulesReader } from "./ai/rules.js";
import type { AiReader } from "./ai/types.js";
import { simulatorChannel } from "./channels/simulator.js";
import { telegramChannel } from "./channels/telegram.js";
import type { Channel } from "./channels/types.js";
import { whatsappChannel } from "./channels/whatsapp.js";
import { ConversationEngine } from "./conversation/engine.js";
import { pgConversationStore } from "./conversation/store.js";
import { pgDocumentStore, type DocumentStore } from "./documents/store.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerPortalRoutes } from "./routes/portal.js";
import { registerBillingRoutes } from "./routes/billing.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAdminV1Routes } from "./routes/admin-v1.js";
import { newToken } from "./lib/session.js";
import { chariowProvider, monerooProvider, type PaymentProvider, simulatorProvider } from "./billing/providers.js";
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
  engine: ConversationEngine;
  conversations: ReturnType<typeof pgConversationStore>;
  reader: AiReader;
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

  // Conversation (spec 004). Sans clé OpenAI : lecture simplifiée, signalée à l'artisan.
  const conversations = pgConversationStore(pool);
  const reader: AiReader = config.OPENAI_API_KEY
    ? openAiReader(config.OPENAI_API_KEY, (task) => conversations.aiModel(task))
    : rulesReader();
  const channels = new Map<string, Channel>();
  channels.set("simulator", simulatorChannel(files, {
    async record(to, kind, text, mediaKey, mediaType, buttons) {
      const identity = await conversations.identityByExternal("simulator", to);
      if (!identity) throw new Error("conversation du simulateur introuvable");
      return conversations.recordOutbound(identity, kind, text, mediaKey, mediaType, null, null, buttons ?? null);
    },
  }));
  if (config.TELEGRAM_BOT_TOKEN) channels.set("telegram", telegramChannel(config.TELEGRAM_BOT_TOKEN));
  if (config.WHATSAPP_ACCESS_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID) {
    channels.set("whatsapp", whatsappChannel({
      accessToken: config.WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.WHATSAPP_PHONE_NUMBER_ID,
      apiVersion: config.WHATSAPP_API_VERSION,
      flows: config.WHATSAPP_FLOW_PROFILE_ID ? { profile: config.WHATSAPP_FLOW_PROFILE_ID } : {},
    }));
  }
  const engine = new ConversationEngine({
    store: conversations, documents, reader, channels, files, render, webUrl: config.WEB_URL,
    // P-76 : « ADMIN » depuis une identité autorisée → lien d'administration à usage unique.
    adminLink: async (identityId) => {
      const { token, hash } = newToken();
      const r = await pool.query<{ minutes: number | null }>("select app.create_admin_link($1, $2) as minutes", [identityId, hash]);
      const minutes = r.rows[0]?.minutes ?? null;
      return minutes ? { url: `${config.WEB_URL.replace(/\/$/, "")}/admin/acces/${token}`, minutes } : null;
    },
  });
  worker.on("staff_message", (job) => engine.staffMessage(job));
  worker.on("process_message", (job) => engine.handleJob(job));
  worker.on("notify_subscription", (job) => engine.notifySubscription(job));
  worker.on("subscription_notice", (job) => engine.periodNotice(job));

  // Paiement de l'abonnement (specs 006, 011) : simulateur hors production, Moneroo et Chariow dès que
  // leur clé existe (et qu'ils sont activés en base).
  const providers: PaymentProvider[] = [];
  if (config.MONEROO_SECRET_KEY) providers.push(monerooProvider({ secretKey: config.MONEROO_SECRET_KEY, webhookSecret: config.MONEROO_WEBHOOK_SECRET }));
  if (config.CHARIOW_API_KEY) providers.push(chariowProvider({ apiKey: config.CHARIOW_API_KEY, webhookSecret: config.CHARIOW_PULSE_SECRET }));
  if (config.FIRMO_ENV !== "production") providers.push(simulatorProvider());

  const modules: RouteModule[] = [
    (app) => registerAdminRoutes(app, { pool, signer: ctx.signer, env: config.FIRMO_ENV, neonAuthUrl: config.NEON_AUTH_URL, webUrl: config.WEB_URL }),
    (app) => registerAdminV1Routes(app, { pool, signer: ctx.signer, webUrl: config.WEB_URL, portalLink: (orgId) => conversations.accessLink(orgId, "portal", "/app") }),
    (app) => registerBillingRoutes(app, { pool, signer: ctx.signer, providers, apiUrl: config.API_URL, webUrl: config.WEB_URL, conversations }),
    (app) => registerPortalRoutes(app, { pool, signer: ctx.signer, documents, render, files, webUrl: config.WEB_URL }),
    (app) => registerChannelRoutes(app, {
      store: conversations,
      db: pool,
      files,
      signer: ctx.signer,
      wake: () => worker.wake(),
      telegram: config.TELEGRAM_BOT_TOKEN ? { token: config.TELEGRAM_BOT_TOKEN, secret: config.TELEGRAM_WEBHOOK_SECRET } : null,
      whatsapp: config.WHATSAPP_APP_SECRET ? { appSecret: config.WHATSAPP_APP_SECRET, verifyToken: config.WHATSAPP_VERIFY_TOKEN } : null,
    }),
  ];

  return { modules, documents, files, render, engine, conversations, reader };
}
