import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { httpErrors, toHttpError } from "./lib/errors.js";
import type { SessionSigner } from "./lib/session.js";
import { type PortalSessionStore, registerPortalSession } from "./routes/portal-session.js";

export type ErrorReporter = (error: unknown, context: Record<string, unknown>) => void;

export interface HealthProbe {
  database(): Promise<boolean>;
  worker(): boolean;
}

/** Module de routes branché par `index.ts` (chaque spec ajoute les siens). */
export type RouteModule = (app: Hono<any>) => void;

export interface AppDeps {
  env: string;
  signer: SessionSigner;
  allowedOrigins: string[];
  health: HealthProbe;
  /** Appelé après chaque requête qui écrit (réveil du worker). */
  afterWrite?: () => void;
  portalSessions: PortalSessionStore;
  modules?: RouteModule[];
  reportError?: ErrorReporter;
}

/** App HTTP de Firmo. Les dépendances sont injectées (tests sans réseau). */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  // Une requête qui écrit peut avoir créé des tâches côté base : le worker passe tout de suite,
  // pendant que la base est éveillée, au lieu d'attendre son prochain passage.
  if (deps.afterWrite) {
    const afterWrite = deps.afterWrite;
    app.use("*", async (c, next) => {
      await next();
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.method !== "OPTIONS") afterWrite();
    });
  }

  app.use(
    "/v1/*",
    cors({
      origin: deps.allowedOrigins,
      allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );
  // Logos et photos : 8 Mo au plus ; le reste est du JSON.
  app.use("*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: (c) => c.json(httpErrors.badRequest("corps trop volumineux").toBody(), 400) }));

  app.onError((error, c) => {
    const http = toHttpError(error);
    if (http.status >= 500) {
      console.error("[api]", c.req.method, c.req.path, error);
      deps.reportError?.(error, { method: c.req.method, path: c.req.path });
    }
    return c.json(http.toBody(), http.status);
  });
  app.notFound((c) => c.json(httpErrors.notFound("route inconnue").toBody(), 404));

  // Docker sonde /health toutes les 30 s : il ne touche jamais la base, sinon Neon ne dort plus
  // jamais (LEARNINGS-BASES-SERVERLESS.md). La base se vérifie à la main sur /health/db.
  app.get("/health", (c) => {
    const worker = deps.health.worker();
    return c.json({ status: "ok", env: deps.env, worker });
  });
  app.get("/health/db", async (c) => {
    const database = await deps.health.database().catch(() => false);
    return c.json({ status: database ? "ok" : "degraded", database }, database ? 200 : 503);
  });

  registerPortalSession(app, deps.signer, deps.portalSessions);
  for (const register of deps.modules ?? []) register(app);

  return app;
}
