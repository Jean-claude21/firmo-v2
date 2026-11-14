import { timingSafeEqual } from "node:crypto";
import { type Button, type Channel, channelFetch, type InboundMessage } from "./types.js";

// Telegram Bot API. Webhook vérifié par l'en-tête X-Telegram-Bot-Api-Secret-Token.

export function telegramSecretValid(header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface TgUser { id: number; first_name?: string; last_name?: string; language_code?: string }
interface TgMessage {
  message_id: number;
  chat: { id: number };
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: { file_id: string; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  photo?: Array<{ file_id: string; width: number }>;
  document?: { file_id: string; mime_type?: string };
  contact?: { phone_number: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

function name(u: TgUser | undefined): string | null {
  return u ? [u.first_name, u.last_name].filter(Boolean).join(" ") || null : null;
}

/** Mise à jour Telegram → message normalisé, ou null si elle ne concerne pas Firmo. */
export function parseTelegram(update: TgUpdate): InboundMessage | null {
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message?.chat.id ?? q.from.id;
    return {
      channel: "telegram",
      externalId: `cb:${q.id}`,
      from: { id: String(chatId), name: name(q.from), phone: null, locale: q.from.language_code ?? null },
      kind: "interactive",
      text: q.data ?? null,
      media: null,
    };
  }
  const m = update.message;
  if (!m) return null;
  const from = { id: String(m.chat.id), name: name(m.from), phone: m.contact?.phone_number ?? null, locale: m.from?.language_code ?? null };
  const base = { channel: "telegram", externalId: `${m.chat.id}:${m.message_id}`, from };
  if (m.voice || m.audio) {
    const a = (m.voice ?? m.audio)!;
    return { ...base, kind: "audio", text: m.caption ?? null, media: { ref: a.file_id, mediaType: a.mime_type ?? "audio/ogg" } };
  }
  if (m.photo?.length) {
    const largest = [...m.photo].sort((x, y) => y.width - x.width)[0]!;
    return { ...base, kind: "image", text: m.caption ?? null, media: { ref: largest.file_id, mediaType: "image/jpeg" } };
  }
  if (m.document?.mime_type?.startsWith("image/")) {
    return { ...base, kind: "image", text: m.caption ?? null, media: { ref: m.document.file_id, mediaType: m.document.mime_type } };
  }
  if (m.text) return { ...base, kind: "text", text: m.text, media: null };
  return null;
}

export function telegramChannel(token: string): Channel {
  const api = (method: string) => `https://api.telegram.org/bot${token}/${method}`;

  async function call(method: string, body: Record<string, unknown>) {
    const res = await channelFetch(api(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, `telegram ${method}`);
    const json = (await res.json()) as { result?: { message_id?: number } };
    return { externalId: json.result?.message_id ? String(json.result.message_id) : null };
  }

  async function upload(method: string, field: string, chatId: string, file: Buffer, filename: string, type: string, caption?: string) {
    const form = new FormData();
    form.set("chat_id", chatId);
    if (caption) form.set("caption", caption.slice(0, 1024));
    form.set(field, new Blob([new Uint8Array(file)], { type }), filename);
    const res = await channelFetch(api(method), { method: "POST", body: form }, `telegram ${method}`);
    const json = (await res.json()) as { result?: { message_id?: number } };
    return { externalId: json.result?.message_id ? String(json.result.message_id) : null };
  }

  return {
    code: "telegram",
    sendText(to, text, buttons?: Button[]) {
      return call("sendMessage", {
        chat_id: to,
        text: text.slice(0, 4096),
        disable_web_page_preview: true,
        ...(buttons?.length
          ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.title, callback_data: b.id }))] } }
          : {}),
      });
    },
    sendImage(to, image, caption) {
      return upload("sendPhoto", "photo", to, image, "apercu.png", "image/png", caption);
    },
    sendDocument(to, file, filename, caption) {
      return upload("sendDocument", "document", to, file, filename, "application/pdf", caption);
    },
    async downloadMedia(ref) {
      const res = await channelFetch(api("getFile"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: ref }),
      }, "telegram getFile");
      const json = (await res.json()) as { result?: { file_path?: string } };
      const path = json.result?.file_path;
      if (!path) throw new Error("telegram : fichier introuvable");
      const file = await channelFetch(`https://api.telegram.org/file/bot${token}/${path}`, {}, "telegram fichier");
      const type = path.endsWith(".oga") || path.endsWith(".ogg") ? "audio/ogg" : (file.headers.get("content-type") ?? "application/octet-stream");
      return { bytes: Buffer.from(await file.arrayBuffer()), mediaType: type };
    },
  };
}

/** Accusé de réception d'un bouton (sinon Telegram affiche un sablier). */
export async function answerCallback(token: string, callbackId: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId }),
  }).catch(() => undefined);
}
