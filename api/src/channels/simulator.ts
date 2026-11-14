import type { ObjectStore } from "../lib/storage.js";
import type { Button, Channel } from "./types.js";

// Simulateur (ADM-6) : même moteur que WhatsApp et Telegram, sans opérateur. Les réponses sont
// enregistrées comme messages sortants (table `messages`) et lues par l'interface du simulateur.
// Les médias envoyés par l'interface sont déposés dans le stockage sous inbox/simulator/.

export interface SimulatorOutbox {
  record(to: string, kind: "text" | "image" | "document", text: string | null, mediaKey: string | null, mediaType: string | null, buttons?: Button[]): Promise<string>;
}

export function simulatorChannel(files: ObjectStore, outbox: SimulatorOutbox): Channel {
  let n = 0;
  const key = (ext: string) => `outbox/simulator/${Date.now().toString(36)}-${(n++).toString(36)}.${ext}`;
  return {
    code: "simulator",
    async sendText(to, text, buttons) {
      return { externalId: await outbox.record(to, "text", text, null, null, buttons) };
    },
    async sendImage(to, image, caption) {
      const k = key("png");
      await files.put(k, image, "image/png");
      return { externalId: await outbox.record(to, "image", caption ?? null, k, "image/png") };
    },
    async sendDocument(to, file, filename, caption) {
      const k = key("pdf");
      await files.put(k, file, "application/pdf");
      return { externalId: await outbox.record(to, "document", caption ?? filename, k, "application/pdf") };
    },
    async downloadMedia(ref) {
      const bytes = await files.get(ref);
      const mediaType = ref.endsWith(".png") ? "image/png" : ref.endsWith(".jpg") || ref.endsWith(".jpeg") ? "image/jpeg" : ref.endsWith(".webm") ? "audio/webm" : ref.endsWith(".mp3") ? "audio/mpeg" : "audio/ogg";
      return { bytes, mediaType };
    },
  };
}
