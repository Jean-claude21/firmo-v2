// Outils du parcours de bout en bout (spec 012) : application réelle (API + worker + web servis),
// simulateur de messagerie, navigateur Chromium. Aucun double : ce qui passe ici passe en vrai.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

export const BASE = process.env.FIRMO_E2E_BASE ?? "http://localhost:3000";
export const STAFF_EMAIL = process.env.FIRMO_E2E_STAFF ?? "equipe@firmo.test";
export const OUT = process.env.FIRMO_E2E_OUT ?? new URL("../../.local/e2e/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const failures = [];
let passed = 0;
export function check(ok, label, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
  return ok;
}
export function summary() {
  console.log(`\n${passed} vérifications réussies, ${failures.length} en échec`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  return failures.length;
}

export async function api(path, { token, method, body, raw } = {}) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new Error(`${method ?? (body ? "POST" : "GET")} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}

export async function staffLogin() {
  return api("/v1/admin/session", { body: { email: STAFF_EMAIL } });
}

/** Une conversation du simulateur : envoyer, attendre les réponses de Firmo. */
export function conversation(staffToken, id = `e2e-${Date.now().toString(36)}`, phone = "+22890112233") {
  let seen = 0;
  const c = {
    id,
    orgId: null,
    async all() {
      return (await api(`/v1/simulator/conversations/${id}/messages`, { token: staffToken })).items;
    },
    /** Envoie un message et attend que Firmo ait fini de répondre ; renvoie ses réponses. */
    async send(text, { media, timeout = 90_000, settle = 2500 } = {}) {
      seen = (await c.all()).length;
      const r = await api("/v1/simulator/messages", { token: staffToken, body: { conversation: id, name: "Afi", phone, ...(text ? { text } : {}), ...(media ? { media } : {}) } });
      c.orgId = r.orgId;
      const start = Date.now();
      let last = -1;
      let stableSince = Date.now();
      while (Date.now() - start < timeout) {
        await sleep(700);
        const items = await c.all();
        const pending = items.some((m) => m.direction === "in" && ["received", "processing", "pending"].includes(m.status));
        if (items.length !== last) {
          last = items.length;
          stableSince = Date.now();
        }
        if (!pending && items.length > seen + 1 && Date.now() - stableSince > settle) {
          return items.slice(seen).filter((m) => m.direction === "out");
        }
      }
      return (await c.all()).slice(seen).filter((m) => m.direction === "out");
    },
  };
  return c;
}

export async function browser() {
  return chromium.launch();
}

/** Contexte navigateur avec une session d'espace artisan obtenue par un vrai lien d'accès. */
export async function portalPage(b, accessUrl, viewport = { width: 390, height: 844 }) {
  const context = await b.newContext({ viewport, locale: "fr-FR", acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(accessUrl.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" });
  await page.waitForURL(/\/app/, { timeout: 15_000 }).catch(() => {});
  return { context, page, errors };
}

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
}

export function linkIn(texts) {
  for (const t of texts) {
    const m = /(https?:\/\/[^\s]+\/acces\/[A-Za-z0-9_-]+)/.exec(t ?? "");
    if (m) return m[1];
  }
  return null;
}
