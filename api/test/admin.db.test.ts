import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { sessionSigner } from "../src/lib/session.js";
import { pgPortalSessionStore } from "../src/routes/portal-session.js";
import { registerAdminRoutes } from "../src/routes/admin.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

describe.skipIf(!hasDatabase)("administration", () => {
  const pool = testPool();
  const signer = sessionSigner("s".repeat(40));
  const app = createApp({
    env: "local",
    signer,
    allowedOrigins: [],
    health: { database: async () => true, worker: () => true },
    portalSessions: pgPortalSessionStore(pool),
    modules: [(a) => registerAdminRoutes(a, { pool, signer, env: "local", neonAuthUrl: "", webUrl: "http://localhost:3100" })],
  });
  afterAll(() => pool.end());

  async function member(role: "admin" | "support") {
    const email = `${uid(role)}@example.test`;
    const u = await pool.query<{ id: string }>(`insert into neon_auth."user" (name, email, "emailVerified") values ('x', $1, true) returning id`, [email]);
    await pool.query("select app.grant_staff($1, $2, null)", [u.rows[0]!.id, role]);
    return email;
  }
  const req = (token: string | null, method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

  it("connexion, droits, tableau de bord, configuration, organisations", async () => {
    const adminEmail = await member("admin");
    const supportEmail = await member("support");
    expect((await req(null, "POST", "/v1/admin/session", { email: "inconnu@example.test" })).status).toBe(401);
    const a = await (await req(null, "POST", "/v1/admin/session", { email: adminEmail })).json();
    const s = await (await req(null, "POST", "/v1/admin/session", { email: supportEmail })).json();
    expect(a.role).toBe("admin");

    expect((await req(null, "GET", "/v1/admin/dashboard")).status).toBe(401);
    const dash = await (await req(s.token, "GET", "/v1/admin/dashboard?days=7")).json();
    expect(dash.series).toHaveLength(7);
    expect(dash.currencies.XOF.minorUnits).toBe(0);

    expect((await req(s.token, "PATCH", "/v1/admin/config/feature_flags/png_preview", { enabled: false })).status).toBe(403);
    expect((await req(a.token, "PATCH", "/v1/admin/config/feature_flags/png_preview", { enabled: true })).status).toBe(200);
    expect((await req(a.token, "PATCH", "/v1/admin/config/document_types/quote", { counts_quota: false })).status).toBe(422);
    const plan = await req(a.token, "POST", "/v1/admin/plans", { code: "pro", currency: "XOF", labels: { fr: "Pro" }, priceMinor: "5000", quota: 100, periodDays: 30 });
    expect(plan.status).toBe(201);
    const config = await (await req(s.token, "GET", "/v1/admin/config")).json();
    expect(config.plans.some((p: any) => p.code === "pro" && p.active)).toBe(true);
    await req(a.token, "POST", `/v1/admin/plans/${(await plan.json()).id}/retire`);

    const org = await pool.query<{ org_id: string }>("select org_id from app.ensure_identity('simulator', $1, 'Test', '+22890000000', null)", [uid("adm")]);
    const orgId = org.rows[0]!.org_id;
    const list = await (await req(s.token, "GET", "/v1/admin/organizations?search=")).json();
    expect(list.total).toBeGreaterThan(0);
    const detail = await (await req(s.token, "GET", `/v1/admin/organizations/${orgId}`)).json();
    expect(detail.identities[0].channel).toBe("simulator");
    expect((await req(s.token, "POST", `/v1/admin/organizations/${orgId}/status`, { status: "suspended" })).status).toBe(403);
    // P-74 : motif obligatoire.
    expect((await req(a.token, "POST", `/v1/admin/organizations/${orgId}/status`, { status: "suspended" })).status).toBe(422);
    expect((await req(a.token, "POST", `/v1/admin/organizations/${orgId}/status`, { status: "suspended", reason: "contrôle de sécurité" })).status).toBe(200);
    expect((await req(a.token, "POST", `/v1/admin/organizations/${orgId}/status`, { status: "active", reason: "contrôle terminé" })).status).toBe(200);

    const audit = await (await req(s.token, "GET", "/v1/admin/audit")).json();
    expect(audit.items.some((i: any) => i.action === "set_org_status")).toBe(true);
    const jobs = await (await req(s.token, "GET", "/v1/admin/jobs?status=failed")).json();
    expect(jobs.counts).toBeTypeOf("object");
  });
});
