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
  portalSessions: PortalSessionStore;
  modules?: RouteModule[];
  reportError?: ErrorReporter;
}

/** App HTTP de Firmo. Les dépendances sont injectées (tests sans réseau). */
export function createApp(deps: AppDeps) {
  const app = new Hono();

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

  app.get("/health", async (c) => {
    const database = await deps.health.database().catch(() => false);
    const worker = deps.health.worker();
    return c.json(
      { status: database ? "ok" : "degraded", env: deps.env, database, worker },
      database ? 200 : 503,
    );
  });

  registerPortalSession(app, deps.signer, deps.portalSessions);
  for (const register of deps.modules ?? []) register(app);

  return app;
}
