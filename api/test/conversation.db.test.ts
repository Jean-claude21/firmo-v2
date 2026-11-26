import { afterAll, describe, expect, it } from "vitest";
import { rulesReader } from "../src/ai/rules.js";
import { type AiReader, EMPTY_READING, type SaleReading, type TurnContext, type TurnDecision } from "../src/ai/types.js";
import { simulatorChannel } from "../src/channels/simulator.js";
import type { Channel } from "../src/channels/types.js";
import { ConversationEngine } from "../src/conversation/engine.js";
import { pgConversationStore } from "../src/conversation/store.js";
import { pgDocumentStore } from "../src/documents/store.js";
import { memoryStore } from "../src/lib/storage.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { hasDatabase, testPool, uid } from "./helpers/db.js";

// Conversation au niveau de la v1 (PARITE_V1 §3), sur la vraie base avec le simulateur.
// IA factice scriptée : lectures et décisions fixées par message ; elle « invente » parfois un
// prix pour vérifier que la garde le refuse.

const other = (patch: Partial<TurnDecision> = {}): TurnDecision => ({
  intent: "other", corrections: [], reply: null, searchQuery: null, targetType: null, startNewDocument: false, ...patch,
});

function scriptedReader(readings: Record<string, SaleReading>, decisions: Record<string, TurnDecision>, calls: TurnContext[], transcript: string): AiReader {
  const usage = { model: "fake", durationMs: 1 };
  return {
    simulated: false,
    transcribe: async () => ({ value: transcript, usage }),
    readText: async (text) => ({ value: readings[text] ?? EMPTY_READING, usage }),
    readImage: async () => ({ value: { ...(readings["photo"] ?? EMPTY_READING), sourceText: "PHOTO 3 tôles 7500" }, usage }),
    decide: async (message, ctx) => {
      calls.push(ctx);
      return { value: decisions[message] ?? (readings[message] ? other({ intent: "source" }) : other()), usage };
    },
  };
}

const SALE = "2 portes isoplanes à 45000 et la pose 10000 pour l'École Les Palmiers";
const BTP = "Devis portail et garde-corps pour la Société Bati Plus, chantier Adidogomé. Portail : 12 barres de tube à 18000, 4 feuilles de tôle à 32000. Garde-corps : 8 barres à 15000. Main d'oeuvre 25 %, transport 30000.";

describe.skipIf(!hasDatabase)("conversation de bout en bout (simulateur)", () => {
  const pool = testPool();
  const secret = "secret-de-partage-pour-les-tests-1234";
  const files = memoryStore();
  const documents = pgDocumentStore(pool, { shareSecret: secret });
  const store = pgConversationStore(pool);
  const render = new RenderService({ pool, documents, files, renderer: new DocumentRenderer(), shareSecret: secret, webUrl: "https://firmo.test" });
  const channels = new Map<string, Channel>();
  channels.set("simulator", simulatorChannel(files, {
    async record(to, kind, text, mediaKey, mediaType, buttons) {
      const identity = await store.identityByExternal("simulator", to);
      return store.recordOutbound(identity!, kind, text, mediaKey, mediaType, null, null, buttons ?? null);
    },
  }));
  const calls: TurnContext[] = [];
  const readings: Record<string, SaleReading> = {
    [SALE]: {
      documentType: null, clientName: "École Les Palmiers", title: null, adjustments: [],
      sections: [{ title: null, showSubtotal: false, lines: [
        { label: "Porte isoplane", quantityText: "2", unit: "porte", unitPriceText: "50000", lineTotalText: null },
        { label: "Pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "10000" },
      ] }],
    },
    [BTP]: {
      documentType: "quote", clientName: "Société Bati Plus", title: "Portail et garde-corps", site: "Adidogomé",
      sections: [
        { title: "Portail", showSubtotal: true, lines: [
          { label: "Tube rectangulaire", quantityText: "12", unit: "barre", unitPriceText: "18000", lineTotalText: null },
          { label: "Tôle noire", quantityText: "4", unit: "feuille", unitPriceText: "32000", lineTotalText: null },
        ] },
        { title: "Garde-corps", showSubtotal: true, lines: [
          { label: "Tube carré", quantityText: "8", unit: "barre", unitPriceText: "15000", lineTotalText: null },
        ] },
      ],
      adjustments: [
        { label: "Main-d'œuvre", mode: "percent", sign: 1, base: "items_total", valueText: "25" },
        { label: "Transport", mode: "amount", sign: 1, base: "items_total", valueText: "30000" },
      ],
    },
  };
  const decisions: Record<string, TurnDecision> = {
    "le prix des portes c'est 45 000": other({ corrections: [{ target: "line", op: "set", line: 1, field: "unit_price", valueText: "45 000" }] }),
    "mets 99 000 sur les portes": other({ corrections: [{ target: "line", op: "set", line: 1, field: "unit_price", valueText: "45 000" }] }),
    "objet : porte d'entrée de l'école": other({ corrections: [{ target: "document", op: "set", field: "subject", valueText: "Porte d'entrée de l'école" }] }),
    "main d'oeuvre 30 % finalement, acompte 40 %, valable 30 jours": other({ corrections: [
      { target: "adjustment", op: "set", adjustment: 1, field: "value", valueText: "30 %" },
      { target: "document", op: "set", field: "deposit_percent", valueText: "40 %" },
      { target: "document", op: "set", field: "validity_days", valueText: "30 jours" },
    ] }),
    "ajoute 2 pots de peinture à 18000 dans le garde-corps": other({ corrections: [
      { target: "line", op: "add", section: 2, line: { label: "Peinture antirouille", quantityText: "2", unit: "pot", unitPriceText: "18000", lineTotalText: null } },
    ] }),
    "ajoute une condition : livraison sous 21 jours après acompte": other({ corrections: [
      { target: "document", op: "append", field: "assumptions", valueText: "Livraison sous 21 jours après acompte" },
    ] }),
    "enlève le transport": other({ corrections: [{ target: "adjustment", op: "remove", adjustment: 2 }] }),
    "salut Firmo": other({ intent: "greeting", reply: "Bonjour. Envoie-moi une vente quand tu veux, en vocal, en photo ou en texte." }),
    "tu sais faire quoi ?": other({ intent: "help", reply: "Je transforme ta vente en devis ou en facture. Dicte-la, je te montre ce que j'ai lu." }),
    "montre-moi ce que tu as compris": other({ intent: "show_latest" }),
    "renvoie-moi le dernier pdf": other({ intent: "download_latest" }),
    "combien de devis j'ai fait ?": other({ intent: "stats" }),
    "cherche Bati": other({ intent: "search", searchQuery: "Bati" }),
    "copie le dernier": other({ intent: "duplicate" }),
    "envoie le lien à mon client": other({ intent: "share" }),
    "transforme-le en proforma": other({ intent: "convert", targetType: "proforma" }),
    "je demande la suppression de mes données": other({ intent: "delete_data" }),
    "on recommence": other({ intent: "new_document" }),
    "réglages": other({ intent: "settings" }),
  };
  const reader = scriptedReader(readings, decisions, calls, SALE);
  const engine = new ConversationEngine({ store, documents, reader, channels, files, render, webUrl: "https://firmo.test" });
  afterAll(() => pool.end());

  function chat(conversation = uid("sim").toLowerCase(), e: ConversationEngine = engine) {
    let orgId = "";
    const api = {
      conversation,
      get orgId() {
        return orgId;
      },
      async send(text: string | null, kind: "text" | "audio" | "image" = "text") {
        const media = kind === "text" ? null : { ref: `inbox/simulator/${uid("m")}.${kind === "audio" ? "ogg" : "jpg"}`, mediaType: kind === "audio" ? "audio/ogg" : "image/jpeg" };
        if (media) await files.put(media.ref, Buffer.from("x"), media.mediaType);
        const r = await store.receive({
          channel: "simulator", externalId: uid("m"), from: { id: conversation, name: "Afi", phone: "+22890112233", locale: null },
          kind: kind === "text" ? (text?.startsWith("cmd:") ? "interactive" : "text") : kind, text, media,
        });
        orgId = r.orgId;
        await e.handleJob({ id: "j", kind: "process_message", payload: { message_id: r.messageId }, attempts: 1 });
        return r;
      },
      async replies(): Promise<string[]> {
        const rows = await pool.query<{ text: string | null; kind: string }>(
          `select m.text, m.kind from public.messages m join public.channel_identities ci on ci.id = m.identity_id
           where ci.external_id = $1 and m.direction = 'out' order by m.created_at, m.id`,
          [conversation],
        );
        return rows.rows.map((r) => `${r.kind}:${r.text ?? ""}`);
      },
      async last(): Promise<string> {
        return (await api.replies()).at(-1)!;
      },
      async state() {
        const id = await store.identityByExternal("simulator", conversation);
        return store.state(id!);
      },
    };
    return api;
  }

  async function renderPending(orgId: string) {
    const jobs = await pool.query<{ payload: Record<string, unknown> }>(
      `select j.payload from public.jobs j join public.documents d on d.id = (j.payload ->> 'document_id')::uuid
       where j.kind = 'render_document' and j.status = 'pending' and d.org_id = $1`,
      [orgId],
    );
    for (const j of jobs.rows) await render.handleJob({ id: "r", kind: "render_document", payload: j.payload, attempts: 1 });
    await pool.query(
      `update public.jobs set status = 'done' where kind = 'render_document' and status = 'pending'
         and (payload ->> 'document_id')::uuid in (select id from public.documents where org_id = $1)`,
      [orgId],
    );
  }

  it("parcours v1 : vocal → lecture → question → correction prouvée → aperçu gratuit → OK → PDF final", async () => {
    const c = chat();
    await c.send(null, "audio");
    let out = await c.replies();
    // Premier contact (voix #1), ce qu'un lien expose, accusé de réception (#2).
    expect(out[0]).toBe("text:Envoie-moi une vente, je t'en fais un devis. Tu peux parler : dis ce que tu as chiffré, comme tu le dirais à quelqu'un.");
    expect(out[1]).toMatch(/Tes prix restent à toi.*https:\/\/firmo\.test\/confidentialite/);
    expect(out[2]).toBe("text:J'écoute…");
    // La lecture est montrée (#3) ; le prix inventé (50 000) est refusé : une seule question.
    expect(out[3]).toMatch(/^text:J'ai lu :\nClient : École Les Palmiers\nPrestations :\n• 2 Porte isoplane \(à préciser\)\n• Pose 10 000 F CFA/);
    expect(out[3]).toMatch(/Quel est le prix unitaire de « Porte isoplane » \?$/);
    expect((await c.state()).awaiting).toBe("missing");

    // Une valeur absente du message n'entre jamais, même si l'IA la propose.
    await c.send("mets 99 000 sur les portes");
    expect(await c.last()).toMatch(/Je n'ai pas retrouvé « 45 000 » dans ton message/);

    await c.send("le prix des portes c'est 45 000");
    out = await c.replies();
    expect(out.at(-1)).toMatch(/^text:C'est corrigé\.\n1\. Porte isoplane · 2 porte × 45 000 F CFA = 90 000 F CFA\nQuel objet veux-tu mettre sur ce devis \?$/);

    await c.send("objet : porte d'entrée de l'école");
    expect(await c.last()).toMatch(/C'est corrigé\.\nTon devis est prêt\. Souhaites-tu que je prépare le PDF maintenant \?$/);
    expect((await c.state()).awaiting).toBe("pdf_offer");

    // « OK » : la seule question obligatoire au premier document (#4), puis l'aperçu gratuit.
    await c.send("OK");
    expect(await c.last()).toBe("text:Sous quel nom doit partir ce devis ?");
    await c.send("Menuiserie Afi");
    out = await c.replies();
    expect(out.at(-4)).toBe("text:C'est noté : tes documents partiront au nom de Menuiserie Afi.");
    // Aperçu en image (drapeau png_preview) puis le PDF filigrané (P-37).
    expect(out.at(-3)).toBe("image:Aperçu du devis, pas encore numéroté.");
    expect(out.at(-2)).toBe("document:Aperçu du devis, pas encore numéroté.");
    expect(out.at(-1)).toBe("text:Si tout est bon, réponds OK pour le PDF final numéroté. Il utilise 1 document : il t'en restera 2. Sinon, dis-moi ce qu'il faut changer.");
    expect((await c.state()).awaiting).toBe("issue_confirm");
    expect((await documents.entitlement(c.orgId))?.used).toBe(0);

    await c.send("OK");
    expect(await c.last()).toBe("text:Je prépare le PDF final du devis.");
    expect((await documents.entitlement(c.orgId))?.used).toBe(1);
    await renderPending(c.orgId);
    out = await c.replies();
    expect(out.at(-2)).toBe("document:Ton devis est prêt.");
    expect(out.at(-1)).toMatch(/^text:Lien à transférer à ton client : https:\/\/firmo\.test\/d\//);

    // Facture à partir du devis, aperçu, émission ; aucun suivi de paiement.
    await c.send("facture");
    out = await c.replies();
    expect(out.at(-1)).toMatch(/^text:J'ai préparé une facture à partir de DEV-\d{4}-001\.\n\nJ'ai lu :/);
    await c.send("OK");
    expect(await c.last()).toMatch(/réponds OK pour le PDF final/);
    await c.send("OK");
    expect(await c.last()).toBe("text:Je prépare le PDF final de la facture.");
    // Firmo ne suit pas l'argent du client : il le dit, ne note rien et n'émet aucun reçu.
    await c.send("payé 40 000 par Mobile Money");
    expect(await c.last()).toMatch(/^text:Firmo ne suit pas les paiements/);
    await c.send("reçu");
    expect(await c.last()).toMatch(/^text:Firmo ne suit pas les paiements/);
    const paid = await pool.query("select count(*)::int as n from public.document_payments p join public.documents d on d.id = p.document_id where d.org_id = $1", [c.orgId]);
    expect(paid.rows[0].n).toBe(0);

    const events = (await pool.query<{ name: string }>("select name from public.analytics_events where org_id = $1", [c.orgId])).rows.map((r) => r.name);
    for (const e of ["org_created", "submission_received", "reading_done", "preview_sent", "document_issued", "quote_converted"]) {
      expect(events).toContain(e);
    }
  }, 120_000);

  it("devis structuré : sections, ajustements, corrections multiples, ajout, condition, retrait", async () => {
    const c = chat();
    await c.send("salut Firmo");
    await c.send(BTP);
    let out = await c.replies();
    const reading = out.at(-1)!;
    expect(reading).toMatch(/Objet : Portail et garde-corps\nClient : Société Bati Plus\nPrestations :\nPortail :\n• 12 barre Tube rectangulaire à 18 000 F CFA\n• 4 feuille Tôle noire à 32 000 F CFA\nSous-total : 344 000 F CFA\nGarde-corps :/);
    expect(reading).toMatch(/Ajustements :\n• Main-d'œuvre : 25 %\n• Transport : 30 000 F CFA\nTotal provisoire : 610 000 F CFA\nChantier : Adidogomé/);

    await c.send("main d'oeuvre 30 % finalement, acompte 40 %, valable 30 jours");
    await c.send("ajoute 2 pots de peinture à 18000 dans le garde-corps");
    expect(await c.last()).toMatch(/C'est corrigé\.\n4\. Peinture antirouille · 2 pot × 18 000 F CFA = 36 000 F CFA/);
    await c.send("ajoute une condition : livraison sous 21 jours après acompte");
    await c.send("enlève le transport");
    await c.send("montre-moi ce que tu as compris");
    out = await c.replies();
    const latest = out.at(-1)!;
    // 500 000 de postes, main-d'œuvre 30 % = 150 000, sans transport : 650 000 ; acompte 40 % = 260 000.
    expect(latest).toMatch(/• Main-d'œuvre : 30 %\nTotal provisoire : 650 000 F CFA\nAcompte \(40 %\) : 260 000 F CFA/);
    expect(latest).toMatch(/Validité : 30 jours/);
    expect(latest).toMatch(/Conditions : Livraison sous 21 jours après acompte/);
    expect(latest).toMatch(/État : brouillon$/);

    const doc = await documents.get(c.orgId, (await c.state()).documentId!);
    expect(doc.sections.map((s) => [s.title, s.subtotalMinor])).toEqual([["Portail", "344000"], ["Garde-corps", "156000"]]);
    expect(doc.adjustments.map((a) => [a.label, a.mode, a.rateBp])).toEqual([["Main-d'œuvre", "percent", 3000]]);
  }, 90_000);

  it("intentions de la v1 depuis le chat", async () => {
    const c = chat();
    // Premier message : l'accueil seul ; ensuite la salutation reçoit une réponse naturelle.
    await c.send("salut Firmo");
    expect((await c.replies()).map((r) => r.split(":")[1]?.slice(0, 18))).toEqual(["Envoie-moi une ven", "Tes prix restent à"]);
    await c.send("salut Firmo");
    expect(await c.last()).toBe("text:Bonjour. Envoie-moi une vente quand tu veux, en vocal, en photo ou en texte.");
    await c.send("tu sais faire quoi ?");
    expect(await c.last()).toMatch(/^text:Je transforme ta vente en devis/);
    await c.send("combien de devis j'ai fait ?");
    expect(await c.last()).toBe("text:Tu n'as pas encore de devis. Le premier prend une minute.");
    await c.send("quota");
    expect(await c.last()).toBe("text:Essai : 0 document utilisé sur 3. Il t'en reste 3.");

    // Un premier devis émis, pour les intentions sur le dernier document.
    await pool.query("update public.organizations set name = 'Atelier Test' where id = (select org_id from public.channel_identities where external_id = $1)", [c.conversation]);
    await c.send(BTP);
    await c.send("OK");
    await c.send("OK");
    await renderPending(c.orgId);

    await c.send("combien de devis j'ai fait ?");
    expect(await c.last()).toBe("text:Tu as 0 brouillon et 1 document finalisé, dont 1 devis et 0 facture. 0 devis accepté.");
    await c.send("cherche Bati");
    expect(await c.last()).toMatch(/^text:J'ai trouvé :\n• DEV-\d{4}-001 · Portail et garde-corps · 610 000 F CFA$/);
    await c.send("renvoie-moi le dernier pdf");
    expect(await c.last()).toMatch(/^document:Devis DEV-\d{4}-001$/);
    await c.send("envoie le lien à mon client");
    expect(await c.last()).toMatch(/^text:Voici le lien de DEV-\d{4}-001 à transférer : https:\/\/firmo\.test\/d\//);
    await c.send("transforme-le en proforma");
    expect(await c.last()).toMatch(/^text:J'ai préparé une proforma à partir de DEV-\d{4}-001\./);
    await c.send("on recommence");
    expect(await c.last()).toBe("text:D'accord, on repart de zéro. Envoie-moi la nouvelle vente.");
    expect((await c.state()).documentId).toBeNull();
    await c.send("copie le dernier");
    expect(await c.last()).toMatch(/^text:J'ai copié DEV-\d{4}-001 dans un nouveau brouillon\./);
    await c.send("réglages");
    expect(await c.last()).toMatch(/^text:Configure ton identité, ton logo, ta couleur et ta numérotation ici \(lien valable \d+ minutes\) : https:\/\/firmo\.test\/acces\//);
    await c.send("ABONNEMENT");
    expect(await c.last()).toMatch(/^text:Pour t'abonner ou recharger, ouvre ce lien/);
    await c.send("ADMIN");
    expect(await c.last()).toBe("text:Cette identité n'ouvre pas l'administration.");
    await c.send("je demande la suppression de mes données");
    expect(await c.last()).toBe("text:C'est noté : ta demande de suppression est enregistrée. Je te confirme ici quand elle est traitée.");
    const req = await pool.query("select kind, status, origin from public.data_requests where org_id = $1", [c.orgId]);
    expect(req.rows).toEqual([{ kind: "deletion", status: "pending", origin: "chat" }]);
  }, 120_000);

  it("contexte : l'IA reçoit au plus les 12 derniers échanges et le brouillon structuré", async () => {
    const c = chat();
    await c.send(BTP);
    for (let i = 0; i < 14; i++) await c.send(`message ${i}`);
    const ctx = calls.at(-1)!;
    expect(ctx.history.length).toBeLessThanOrEqual(24);
    expect(ctx.history.at(-1)?.role).toBe("firmo");
    expect(ctx.history.some((h) => h.text === "message 12")).toBe(true);
    expect(ctx.history.some((h) => h.text === BTP)).toBe(false);
    expect(ctx.draft).toMatch(/Section 1 « Portail » :\n  ligne 1 : Tube rectangulaire \| qté 12 barre \| prix 18 000 F CFA/);
    expect(ctx.draft).toMatch(/ajustement 1 : Main-d'œuvre = 25 %/);
  }, 120_000);

  it("mode dégradé (sans IA) : format de secours, vocal et photo signalés", async () => {
    const degraded = new ConversationEngine({ store, documents, reader: rulesReader(), channels, files, render, webUrl: "https://firmo.test" });
    const c = chat(uid("deg").toLowerCase(), degraded);
    await c.send("45 | Barre tube 80 x 40 | 17 000\nforfait | Pose | 60 000\nmain d'oeuvre 160 000");
    expect(await c.last()).toMatch(/• 45 Barre tube 80 x 40 à 17 000 F CFA\n• Pose 60 000 F CFA\nAjustements :\n• Main d'oeuvre : 160 000 F CFA\nTotal provisoire : 985 000 F CFA/);
    await c.send(null, "audio");
    expect(await c.last()).toMatch(/J'ai bien reçu ton vocal, mais je n'arrive pas à l'écouter en ce moment\. Ton brouillon est conservé\./);
    await c.send(null, "image");
    expect(await c.last()).toMatch(/J'ai bien reçu ta photo, mais je n'arrive pas à lire la feuille en ce moment/);
    await c.send("hmm");
    expect(await c.last()).toMatch(/Écris chaque ligne comme ceci : quantité \| libellé \| prix/);
  }, 90_000);

  it("un message rejoué n'est traité qu'une fois", async () => {
    const m = {
      channel: "simulator",
      externalId: uid("dup"),
      from: { id: uid("sim"), name: null, phone: null, locale: null },
      kind: "text" as const,
      text: "aide",
      media: null,
    };
    const a = await store.receive(m);
    const b = await store.receive(m);
    expect(b.duplicate).toBe(true);
    expect(b.messageId).toBe(a.messageId);
  });

  // Spec 011 : confirmation de paiement (P-57) et conditions de fin reprises de Struo.
  it("paiement confirmé, rappels de fin, puis abonnement terminé", async () => {
    const c = chat();
    await c.send("aide");
    const pay = (await pool.query("select * from app.start_subscription_payment($1, 'standard', 'simulator', $2)", [c.orgId, uid("k")])).rows[0];
    await pool.query("select app.settle_subscription_payment('simulator', $1, $2, 'succeeded', 2000, 'XOF')", [uid("ev"), pay.id]);
    const job = async (kind: string, where: string) => {
      const r = await pool.query<{ payload: Record<string, unknown> }>(
        `select payload from public.jobs where kind = $1 and ${where}`, [kind]);
      return r.rows[0]!.payload;
    };
    // Le message part de la file, pas de la route.
    await engine.notifySubscription({ id: "n", kind: "notify_subscription", payload: await job("notify_subscription", `payload ->> 'payment_id' = '${pay.id}'`), attempts: 1 });
    expect(await c.last()).toMatch(/^text:Ton abonnement est actif : 15 documents jusqu'au \d\d\.\d\d\.\d{4}\.$/);

    const sub = (await pool.query("select id from public.subscriptions where org_id = $1 and kind = 'paid'", [c.orgId])).rows[0].id;
    const notice = (stage: string) => job("subscription_notice", `dedupe_key = 'period_notice:${sub}:${stage}'`);
    await engine.periodNotice({ id: "p", kind: "subscription_notice", payload: await notice("ending:3"), attempts: 1 });
    expect(await c.last()).toMatch(/se termine dans 3 jours, le .* Il ne se renouvelle pas tout seul : pour continuer, réponds ABONNEMENT\.$/);
    await engine.periodNotice({ id: "p", kind: "subscription_notice", payload: await notice("ended"), attempts: 1 });
    expect(await c.last()).toMatch(/Tu peux encore émettre tes documents jusqu'au /);

    // Grâce passée : l'émission est refusée avec le bon message, le brouillon reste.
    await pool.query("update public.subscriptions set period_start = now() - interval '40 days', period_end = now() - interval '5 days' where id = $1", [sub]);
    await engine.periodNotice({ id: "p", kind: "subscription_notice", payload: await notice("closed"), attempts: 1 });
    expect(await c.last()).toContain("Tes documents restent consultables et téléchargeables");
    for (const m of [SALE, "le prix des portes c'est 45 000", "objet : porte d'entrée de l'école", "OK", "Menuiserie Afi", "OK"]) await c.send(m);
    expect(await c.last()).toMatch(/^text:Ton abonnement est terminé\. Ton brouillon reste disponible\./);

    // Renouvelé entre-temps : la période suivante coupe les rappels de la précédente.
    const before = (await c.replies()).length;
    await pool.query("select app.start_paid_period($1, (select id from public.plans where code = 'standard' and currency_code = 'XOF' and active))", [c.orgId]);
    await engine.periodNotice({ id: "p", kind: "subscription_notice", payload: await notice("ending:1"), attempts: 1 });
    expect((await c.replies()).length).toBe(before);
  });
  it("hors de la fenêtre du canal, l'avis part par le modèle approuvé", async () => {
    const c = chat();
    await c.send("aide");
    const sim = channels.get("simulator") as Channel & { replyWindowHours?: number; sendNotice?: Channel["sendNotice"] };
    const notices: Array<{ text: string; locale: string }> = [];
    sim.replyWindowHours = 24;
    sim.sendNotice = async (_to, text, locale) => { notices.push({ text, locale }); return { externalId: null }; };
    try {
      const staff = (text: string) => engine.staffMessage({ id: "s", kind: "staff_message", payload: { org_id: c.orgId, text }, attempts: 1 });
      // Dans la fenêtre : texte libre.
      await staff("Bonjour, ici l'équipe Firmo.");
      expect(await c.last()).toBe("text:Bonjour, ici l'équipe Firmo.");
      expect(notices).toHaveLength(0);
      // Dernier message de l'artisan il y a deux jours : modèle approuvé, dans sa langue.
      await pool.query("update public.channel_identities set last_seen_at = now() - interval '2 days' where org_id = $1", [c.orgId]);
      await staff("Votre accès est rétabli.");
      expect(notices).toEqual([{ text: "Votre accès est rétabli.", locale: "fr" }]);
    } finally {
      delete sim.replyWindowHours;
      delete sim.sendNotice;
    }
  });
});
