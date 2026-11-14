import { createHmac, timingSafeEqual } from "node:crypto";
import { type Button, type Channel, channelFetch, type InboundMessage } from "./types.js";

// WhatsApp Cloud API (Meta). Webhook vérifié par X-Hub-Signature-256 (HMAC du corps brut avec le
// secret de l'application). Formulaires natifs (Flows) seulement quand le compte est vérifié et
// qu'un identifiant de Flow est configuré ; sinon le moteur envoie un lien vers le formulaire web.

export function whatsappSignatureValid(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header.slice(7), "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface WaMessage {
  from: string;
  id: string;
  type: string;
  text?: { body: string };
  audio?: { id: string; mime_type?: string };
  voice?: { id: string; mime_type?: string };
  image?: { id: string; mime_type?: string; caption?: string };
  document?: { id: string; mime_type?: string; caption?: string };
  button?: { payload?: string; text?: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
    nfm_reply?: { name?: string; response_json?: string };
  };
}
interface WaPayload {
  entry?: Array<{ changes?: Array<{ value?: { contacts?: Array<{ wa_id: string; profile?: { name?: string } }>; messages?: WaMessage[] } }> }>;
}

/** Corps du webhook → messages normalisés (les accusés de lecture sont ignorés). */
export function parseWhatsapp(payload: WaPayload): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const m of value?.messages ?? []) {
        const contact = value?.contacts?.find((c) => c.wa_id === m.from);
        const from = { id: m.from, name: contact?.profile?.name ?? null, phone: `+${m.from}`, locale: null };
        const base = { channel: "whatsapp", externalId: m.id, from };
        switch (m.type) {
          case "text":
            out.push({ ...base, kind: "text", text: m.text?.body ?? "", media: null });
            break;
          case "audio":
          case "voice": {
            const a = m.audio ?? m.voice;
            if (a) out.push({ ...base, kind: "audio", text: null, media: { ref: a.id, mediaType: a.mime_type ?? "audio/ogg" } });
            break;
          }
          case "image":
            if (m.image) out.push({ ...base, kind: "image", text: m.image.caption ?? null, media: { ref: m.image.id, mediaType: m.image.mime_type ?? "image/jpeg" } });
            break;
          case "document":
            if (m.document?.mime_type?.startsWith("image/")) {
              out.push({ ...base, kind: "image", text: m.document.caption ?? null, media: { ref: m.document.id, mediaType: m.document.mime_type } });
            }
            break;
          case "button":
            out.push({ ...base, kind: "interactive", text: m.button?.payload ?? m.button?.text ?? null, media: null });
            break;
          case "interactive": {
            const i = m.interactive;
            if (i?.type === "nfm_reply" && i.nfm_reply?.response_json) {
              let values: Record<string, string> = {};
              try {
                values = JSON.parse(i.nfm_reply.response_json) as Record<string, string>;
              } catch {
                values = {};
              }
              const name = String(values.form ?? i.nfm_reply.name ?? "profile");
              out.push({ ...base, kind: "form", text: null, media: null, form: { name, values } });
            } else {
              const reply = i?.button_reply ?? i?.list_reply;
              if (reply) out.push({ ...base, kind: "interactive", text: reply.id, media: null });
            }
            break;
          }
        }
      }
    }
  }
  return out;
}

export interface WhatsappOptions {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  /** Identifiants des Flows publiés chez Meta, par formulaire (ex. { profile: "123…" }). */
  flows: Record<string, string>;
}

export function whatsappChannel(options: WhatsappOptions): Channel {
  const graph = `https://graph.facebook.com/${options.apiVersion}`;
  const auth = { Authorization: `Bearer ${options.accessToken}` };

  async function send(body: Record<string, unknown>) {
    const res = await channelFetch(`${graph}/${options.phoneNumberId}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    }, "whatsapp messages");
    const json = (await res.json()) as { messages?: Array<{ id: string }> };
    return { externalId: json.messages?.[0]?.id ?? null };
  }

  async function upload(file: Buffer, type: string, filename: string): Promise<string> {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", type);
    form.set("file", new Blob([new Uint8Array(file)], { type }), filename);
    const res = await channelFetch(`${graph}/${options.phoneNumberId}/media`, { method: "POST", headers: auth, body: form }, "whatsapp media");
    const json = (await res.json()) as { id?: string };
    if (!json.id) throw new Error("whatsapp : envoi du média sans identifiant");
    return json.id;
  }

  return {
    code: "whatsapp",
    sendText(to, text, buttons?: Button[]) {
      // Boutons : 3 au plus, titre de 20 caractères, corps de 1024 caractères.
      if (buttons?.length && text.length <= 1024) {
        return send({
          to,
          type: "interactive",
          interactive: {
            type: "button",
            body: { text },
            action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title.slice(0, 20) } })) },
          },
        });
      }
      return send({ to, type: "text", text: { body: text.slice(0, 4096), preview_url: true } });
    },
    async sendImage(to, image, caption) {
      const id = await upload(image, "image/png", "apercu.png");
      return send({ to, type: "image", image: { id, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } });
    },
    async sendDocument(to, file, filename, caption) {
      const id = await upload(file, "application/pdf", filename);
      return send({ to, type: "document", document: { id, filename, ...(caption ? { caption: caption.slice(0, 1024) } : {}) } });
    },
    async downloadMedia(ref) {
      const meta = await channelFetch(`${graph}/${ref}`, { headers: auth }, "whatsapp média (adresse)");
      const info = (await meta.json()) as { url?: string; mime_type?: string };
      if (!info.url) throw new Error("whatsapp : média introuvable");
      const file = await channelFetch(info.url, { headers: auth }, "whatsapp média");
      return { bytes: Buffer.from(await file.arrayBuffer()), mediaType: info.mime_type ?? "application/octet-stream" };
    },
    async sendForm(to, form, cta, body) {
      const flowId = options.flows[form];
      if (!flowId) return null;
      return send({
        to,
        type: "interactive",
        interactive: {
          type: "flow",
          body: { text: body.slice(0, 1024) },
          action: {
            name: "flow",
            parameters: { flow_message_version: "3", flow_id: flowId, flow_cta: cta.slice(0, 20), flow_action: "navigate", flow_token: form },
          },
        },
      });
    },
  };
}
