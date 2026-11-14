import { randomUUID } from "node:crypto";

/** Erreur à remonter (5xx) : route et type seulement, jamais le corps. */
export type ErrorReporter = (error: unknown, context: Record<string, unknown>) => Promise<void>;

/**
 * Suivi des erreurs de l'API (constitution IX) vers Sentry ou GlitchTip,
 * par l'API d'enveloppe (aucune dépendance). DSN :
 * `https://<clé>@<hôte>/<projet>`. Aucune donnée personnelle : ni
 * utilisateur, ni en-têtes, ni corps de requête. Un envoi raté n'est jamais
 * propagé.
 */
export function sentryReporter(
  dsn: string,
  options: { environment?: string; fetchImpl?: typeof fetch } = {},
): ErrorReporter {
  const url = new URL(dsn);
  const key = decodeURIComponent(url.username);
  const project = url.pathname.replace(/^\/+|\/+$/g, "");
  if (url.protocol !== "https:" || !key || !project) {
    throw new Error("ERROR_REPORTING_DSN invalide");
  }
  const endpoint = `${url.protocol}//${url.host}/api/${project}/envelope/`;
  const send = options.fetchImpl ?? fetch;
  return async (error, context) => {
    const id = randomUUID().replaceAll("-", "");
    const value = error instanceof Error ? error : new Error(String(error));
    const event = {
      event_id: id,
      timestamp: new Date().toISOString(),
      platform: "node",
      level: "error",
      environment: options.environment ?? "production",
      release: "firmo-api",
      tags: Object.fromEntries(Object.entries(context).map(([k, v]) => [k, String(v)])),
      exception: {
        values: [
          {
            type: value.name,
            value: value.message.slice(0, 500),
            stacktrace: { frames: frames(value.stack) },
          },
        ],
      },
    };
    const envelope = [
      JSON.stringify({ event_id: id, sent_at: event.timestamp }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    try {
      await send(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-sentry-envelope",
          "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${key}, sentry_client=firmo-api/1.0`,
        },
        body: envelope,
      });
    } catch (sendError) {
      console.error("[report] envoi en échec", sendError);
    }
  };
}

/** Pile Node → cadres Sentry (du plus ancien au plus récent). */
function frames(stack: string | undefined) {
  return (stack ?? "")
    .split("\n")
    .slice(1, 30)
    .map((line) => line.trim().replace(/^at /, ""))
    .filter(Boolean)
    .map((line) => ({ function: line.slice(0, 200) }))
    .reverse();
}
