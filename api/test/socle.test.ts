import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { httpErrors } from "../src/lib/errors.js";
import { newToken, sessionSigner, tokenHash } from "../src/lib/session.js";
import type { PortalSessionStore } from "../src/routes/portal-session.js";
import { type Job, type JobStore, PermanentJobError, Worker } from "../src/worker/worker.js";

const SECRET = "s".repeat(40);

function app(overrides: { portal?: PortalSessionStore; database?: boolean } = {}) {
  const signer = sessionSigner(SECRET);
  return {
    signer,
    app: createApp({
      env: "local",
      signer,
      allowedOrigins: ["http://localhost:3000"],
      health: { database: async () => overrides.database ?? true, worker: () => true },
      portalSessions: overrides.portal ?? {
        consume: async () => {
          throw httpErrors.notFound("lien invalide");
        },
        sessionDays: async () => 7,
      },
    }),
  };
}

describe("sessions", () => {
  it("signe et vérifie une session artisan", async () => {
    const signer = sessionSigner(SECRET);
    const token = await signer.sign({ scope: "org", orgId: "o-1" }, 60);
    await expect(signer.verify(token)).resolves.toEqual({ scope: "org", orgId: "o-1" });
  });

  it("refuse un jeton signé par un autre secret", async () => {
    const other = await sessionSigner("x".repeat(40)).sign({ scope: "org", orgId: "o-1" }, 60);
    await expect(sessionSigner(SECRET).verify(other)).rejects.toMatchObject({ status: 401 });
  });

  it("refuse un jeton expiré", async () => {
    const signer = sessionSigner(SECRET);
    const token = await signer.sign({ scope: "org", orgId: "o-1" }, -10);
    await expect(signer.verify(token)).rejects.toMatchObject({ status: 401 });
  });

  it("garde le rôle d'une session d'équipe", async () => {
    const signer = sessionSigner(SECRET);
    const token = await signer.sign({ scope: "staff", userId: "u", role: "support", email: "s@x.io" }, 60);
    await expect(signer.verify(token)).resolves.toMatchObject({ scope: "staff", role: "support" });
  });

  it("produit un jeton aléatoire et son empreinte", () => {
    const a = newToken();
    const b = newToken();
    expect(a.token).not.toEqual(b.token);
    expect(a.hash.equals(tokenHash(a.token))).toBe(true);
    expect(a.hash.length).toBe(32);
  });
});

describe("routes du socle", () => {
  it("GET /health répond sans toucher la base (Neon peut dormir)", async () => {
    const res = await app({ database: false }).app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", worker: true });
    expect(body).not.toHaveProperty("database");
  });

  it("GET /health/db vérifie la base, en 503 si elle ne répond pas", async () => {
    expect((await app().app.request("/health/db")).status).toBe(200);
    const res = await app({ database: false }).app.request("/health/db");
    expect(res.status).toBe(503);
  });

  it("échange un lien contre une session artisan", async () => {
    const { token, hash } = newToken();
    const { app: http, signer } = app({
      portal: {
        consume: async (h) => {
          if (!h.equals(hash)) throw httpErrors.notFound();
          return { orgId: "org-9", purpose: "portal", target: "/app" };
        },
        sessionDays: async () => 7,
      },
    });
    const res = await http.request("/v1/portal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; target: string };
    expect(body.target).toBe("/app");
    await expect(signer.verify(body.token)).resolves.toEqual({ scope: "org", orgId: "org-9" });
  });

  it("refuse un lien inconnu", async () => {
    const res = await app().app.request("/v1/portal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(43) }),
    });
    expect(res.status).toBe(404);
  });

  it("valide le corps", async () => {
    const res = await app().app.request("/v1/portal/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: 3 }),
    });
    expect(res.status).toBe(422);
  });
});

function memoryStore(jobs: Job[]) {
  const state = { done: [] as string[], failed: [] as Array<{ id: string; retry: boolean }> };
  const store: JobStore = {
    claim: async (_w, limit) => jobs.splice(0, limit),
    complete: async (id) => void state.done.push(id),
    fail: async (id, _e, retry) => void state.failed.push({ id, retry }),
    enqueue: async () => null,
  };
  return { store, state };
}

describe("worker", () => {
  it("appelle le gestionnaire et termine la tâche", async () => {
    const { store, state } = memoryStore([{ id: "1", kind: "a", payload: {}, attempts: 1 }]);
    const seen: string[] = [];
    const worker = new Worker(store, { name: "t", concurrency: 2 }).on("a", async (job) => {
      seen.push(job.id);
    });
    expect(await worker.drain()).toBe(1);
    expect(seen).toEqual(["1"]);
    expect(state.done).toEqual(["1"]);
  });

  it("retente une erreur passagère, pas une erreur définitive", async () => {
    const { store, state } = memoryStore([
      { id: "1", kind: "flaky", payload: {}, attempts: 1 },
      { id: "2", kind: "bad", payload: {}, attempts: 1 },
      { id: "3", kind: "inconnu", payload: {}, attempts: 1 },
    ]);
    const worker = new Worker(store, { name: "t", concurrency: 4 })
      .on("flaky", async () => {
        throw new Error("réseau");
      })
      .on("bad", async () => {
        throw new PermanentJobError("entrée invalide");
      });
    await worker.drain();
    expect(state.failed.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "1", retry: true },
      { id: "2", retry: false },
      { id: "3", retry: false },
    ]);
  });
});
