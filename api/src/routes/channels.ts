import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { z } from "zod";
import { answerCallback, parseTelegram, telegramSecretValid } from "../channels/telegram.js";
import type { InboundMessage } from "../channels/types.js";
import { parseWhatsapp, whatsappSignatureValid } from "../channels/whatsapp.js";
import type { ConversationStore } from "../conversation/store.js";
import type { Db } from "../lib/db.js";
import { sql } from "../lib/db.js";
import { httpErrors } from "../lib/errors.js";
import { type SessionSigner, type SessionVariables, requireStaff } from "../lib/session.js";
import type { ObjectStore } from "../lib/storage.js";
import { parseJson } from "../lib/validate.js";

// Webhooks des canaux (CH-5) et API du simulateur (ADM-6). Chaque webhook est vérifié, journalisé
// brut, puis transformé en message idempotent + tâche ; la réponse part tout de suite.

export interface ChannelRoutesDeps {
  store: ConversationStore;
  db: Db;
  files: ObjectStore;
  signer: SessionSigner;
  wake: () => void;
  telegram: { token: string; secret: string } | null;
  whatsapp: { appSecret: string; verifyToken: string } | null;
}

export function registerChannelRoutes(app: Hono<any>, d: ChannelRoutesDeps) {
  async function accept(messages: InboundMessage[]) {
    let created = 0;
    for (const m of messages) {
      const r = await d.store.receive(m);
      if (!r.duplicate) created++;
    }
    if (created) d.wake();
  }

  // ------------------------------------------------------------- Telegram
  app.post("/v1/webhooks/telegram", async (c) => {
    if (!d.telegram) throw httpErrors.unavailable("Telegram non configuré");
    const body = await c.req.text();
    const valid = telegramSecretValid(c.req.header("x-telegram-bot-api-secret-token"), d.telegram.secret);
    await d.store.journal("telegram", valid, body);
    if (!valid) throw httpErrors.unauthenticated("secret invalide");
    let update: Parameters<typeof parseTelegram>[0];
    try {
      update = JSON.parse(body);
    } catch {
      return c.json({ ok: true });
    }
    if (update.callback_query) await answerCallback(d.telegram.token, update.callback_query.id);
    const message = parseTelegram(update);
    if (message) await accept([message]);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- WhatsApp
  app.get("/v1/webhooks/whatsapp", (c) => {
    if (!d.whatsapp) throw httpErrors.unavailable("WhatsApp non configuré");
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    if (mode === "subscribe" && token && token === d.whatsapp.verifyToken) {
      return c.text(c.req.query("hub.challenge") ?? "");
    }
    throw httpErrors.forbidden("jeton de vérification invalide");
  });

  app.post("/v1/webhooks/whatsapp", async (c) => {
    if (!d.whatsapp) throw httpErrors.unavailable("WhatsApp non configuré");
    const body = await c.req.text();
    const valid = whatsappSignatureValid(body, c.req.header("x-hub-signature-256"), d.whatsapp.appSecret);
    await d.store.journal("whatsapp", valid, body);
    if (!valid) throw httpErrors.unauthenticated("signature invalide");
    try {
      await accept(parseWhatsapp(JSON.parse(body)));
    } catch (error) {
      await d.store.journal("whatsapp", true, body, (error as Error).message);
      throw error;
    }
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------- simulateur (équipe)
  const staff = requireStaff(d.signer);
  const sim = z.object({
    conversation: z.string().regex(/^[a-z0-9-]{3,40}$/),
    name: z.string().max(80).optional(),
    phone: z.string().max(20).optional(),
    text: z.string().max(4000).optional(),
    media: z.object({ base64: z.string().max(11_000_000), mediaType: z.string().regex(/^(image|audio)\/[a-z0-9.+-]+$/) }).optional(),
  });

  app.post("/v1/simulator/messages", staff, async (c) => {
    const input = await parseJson(c, sim);
    if (!input.text && !input.media) throw httpErrors.validation({ text: "texte ou média requis" });
    let media: InboundMessage["media"] = null;
    let kind: InboundMessage["kind"] = "text";
    if (input.media) {
      const ext = input.media.mediaType.split("/")[1]!.replace("jpeg", "jpg").replace(/[^a-z0-9]/g, "");
      const key = `inbox/simulator/${randomUUID()}.${ext}`;
      await d.files.put(key, Buffer.from(input.media.base64, "base64"), input.media.mediaType);
      media = { ref: key, mediaType: input.media.mediaType };
      kind = input.media.mediaType.startsWith("image/") ? "image" : "audio";
    }
    const message: InboundMessage = {
      channel: "simulator",
      externalId: randomUUID(),
      from: { id: input.conversation, name: input.name ?? null, phone: input.phone ?? null, locale: null },
      kind: input.text?.startsWith("cmd:") ? "interactive" : kind,
      text: input.text ?? null,
      media,
    };
    const r = await d.store.receive(message);
    d.wake();
    return c.json({ messageId: r.messageId, orgId: r.orgId }, 202);
  });

  app.get("/v1/simulator/conversations/:id/messages", staff, async (c) => {
    const id = c.req.param("id");
    const rows = await sql<Record<string, any>>(
      d.db,
      `select m.id, m.direction, m.kind, m.text, m.transcript, m.media_key, m.media_type, m.status, m.buttons,
              m.document_id, m.created_at
       from public.messages m join public.channel_identities ci on ci.id = m.identity_id
       where ci.channel = 'simulator' and ci.external_id = $1 order by m.created_at, m.id limit 300`,
      [id],
    );
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        direction: r.direction,
        kind: r.kind,
        text: r.text,
        transcript: r.transcript,
        mediaKey: r.media_key,
        mediaType: r.media_type,
        status: r.status,
        buttons: r.buttons ?? [],
        documentId: r.document_id,
        createdAt: r.created_at.toISOString(),
      })),
    });
  });

  app.get("/v1/simulator/media", staff, async (c) => {
    const key = c.req.query("key") ?? "";
    if (!/^(inbox|outbox)\/simulator\//.test(key) && !/^documents\//.test(key)) throw httpErrors.forbidden();
    const bytes = await d.files.get(key).catch(() => {
      throw httpErrors.notFound("fichier introuvable");
    });
    const type = key.endsWith(".pdf") ? "application/pdf" : key.endsWith(".png") ? "image/png" : key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
    return c.body(new Uint8Array(bytes), 200, { "Content-Type": type, "Cache-Control": "private, max-age=300" });
  });
}

export type { SessionVariables };
