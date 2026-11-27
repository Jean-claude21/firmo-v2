import { afterEach, describe, expect, it, vi } from "vitest";
import { templateParam, whatsappChannel } from "../src/channels/whatsapp.js";

// Avis hors fenêtre de 24 h (spec 015) : WhatsApp n'accepte qu'un modèle approuvé chez Meta.
describe("WhatsApp : avis par modèle approuvé", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("le texte devient un paramètre valide (sans saut de ligne ni espaces multiples)", () => {
    expect(templateParam("Ton abonnement est actif.\n\nRéponds   ici.")).toBe("Ton abonnement est actif. — Réponds ici.");
    expect(templateParam("x".repeat(2000))).toHaveLength(1000);
  });

  it("envoie le modèle configuré, dans la langue de l'artisan", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }));
    const ch = whatsappChannel({ accessToken: "t", phoneNumberId: "1", apiVersion: "v23.0", flows: {}, noticeTemplate: "firmo_avis" });
    expect(ch.replyWindowHours).toBe(24);
    const r = await ch.sendNotice!("22890000000", "Votre accès est rétabli.\nÀ bientôt.", "en");
    expect(r.externalId).toBe("wamid.1");
    expect(bodies[0]).toEqual({
      messaging_product: "whatsapp", to: "22890000000", type: "template",
      template: { name: "firmo_avis", language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: "Votre accès est rétabli. — À bientôt." }] }] },
    });
  });

  it("sans modèle configuré : pas d'avis, le texte libre reste la seule voie", () => {
    const ch = whatsappChannel({ accessToken: "t", phoneNumberId: "1", apiVersion: "v23.0", flows: {}, noticeTemplate: "" });
    expect(ch.sendNotice).toBeUndefined();
  });
});
