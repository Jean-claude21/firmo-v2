// Évaluation des dialogues avec la vraie IA (PARITE_V1 P-41), reprise des scénarios de la v1 :
// artisan, BTP complexe, facture informelle + « renvoie le dernier PDF », frontière des 12 échanges.
// Chaque scénario est vérifié sur l'état final en base (totaux, client, document émis) et sur la
// voix (aucun mot banni, aucun point d'exclamation, aucun emoji). Pas de juge IA : des faits.
//
//   DATABASE_URL=… OPENAI_API_KEY=… npx tsx scripts/eval-dialogues.ts
// Rapport : ../.local/eval/dialogues.md (hors dépôt).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { openAiReader } from "../src/ai/openai.js";
import { simulatorChannel } from "../src/channels/simulator.js";
import type { Channel } from "../src/channels/types.js";
import { ConversationEngine } from "../src/conversation/engine.js";
import { pgConversationStore } from "../src/conversation/store.js";
import { pgDocumentStore } from "../src/documents/store.js";
import { memoryStore } from "../src/lib/storage.js";
import { DocumentRenderer } from "../src/render/renderer.js";
import { RenderService } from "../src/render/service.js";
import { BANNED_WORDS } from "../src/voix/chat.js";

const url = process.env.DATABASE_URL;
const key = process.env.OPENAI_API_KEY;
if (!url || !key) {
  console.error("DATABASE_URL et OPENAI_API_KEY sont nécessaires.");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: url, max: 4 });
const files = memoryStore();
const secret = "secret-de-partage-pour-l-evaluation-1234";
const documents = pgDocumentStore(pool, { shareSecret: secret });
const store = pgConversationStore(pool);
const render = new RenderService({ pool, documents, files, renderer: new DocumentRenderer(), shareSecret: secret, webUrl: "https://firmo.eval" });
const channels = new Map<string, Channel>();
channels.set("simulator", simulatorChannel(files, {
  async record(to, kind, text, mediaKey, mediaType, buttons) {
    const identity = await store.identityByExternal("simulator", to);
    return store.recordOutbound(identity!, kind, text, mediaKey, mediaType, null, null, buttons ?? null);
  },
}));
const reader = openAiReader(key, (task) => store.aiModel(task));
const engine = new ConversationEngine({ store, documents, reader, channels, files, render, webUrl: "https://firmo.eval" });

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

async function conversation(name: string, businessName: string) {
  const id = `eval-${name}-${Date.now().toString(36)}`;
  let orgId = "";
  const transcript: string[] = [];
  return {
    async send(text: string) {
      const r = await store.receive({
        channel: "simulator", externalId: `${id}-${transcript.length}`, from: { id, name: "Essai", phone: "+22890000000", locale: null },
        kind: "text", text, media: null,
      });
      if (!orgId) {
        orgId = r.orgId;
        await pool.query("update public.organizations set name = $2 where id = $1", [orgId, businessName]);
      }
      const before = (await outbound(id)).length;
      transcript.push(`**Artisan** : ${text}`);
      await engine.handleJob({ id: "j", kind: "process_message", payload: { message_id: r.messageId }, attempts: 1 });
      const after = await outbound(id);
      for (const m of after.slice(before)) transcript.push(`**Firmo** (${m.kind}) : ${m.text ?? ""}`);
      return after.slice(before).map((m) => m.text ?? "");
    },
    get orgId() {
      return orgId;
    },
    transcript,
    async state() {
      return store.state((await store.identityByExternal("simulator", id))!);
    },
    async replies() {
      return outbound(id);
    },
  };
}

async function outbound(external: string) {
  const r = await pool.query<{ kind: string; text: string | null }>(
    `select m.kind, m.text from public.messages m join public.channel_identities ci on ci.id = m.identity_id
     where ci.external_id = $1 and m.direction = 'out' order by m.created_at, m.id`,
    [external],
  );
  return r.rows;
}

async function lastDocument(orgId: string) {
  const id = (await documents.lastIssued(orgId)) ?? (await documents.latest(orgId));
  return id ? documents.get(orgId, id) : null;
}

function voiceChecks(replies: Array<{ text: string | null }>): Check[] {
  const texts = replies.map((r) => r.text ?? "");
  const banned = texts.filter((t) => BANNED_WORDS.some((w) => t.toLowerCase().includes(w)));
  const exclam = texts.filter((t) => t.includes("!"));
  const emoji = texts.filter((t) => /\p{Extended_Pictographic}/u.test(t));
  return [
    { label: "aucun mot banni", ok: banned.length === 0, detail: banned.join(" | ") },
    { label: "aucun point d'exclamation", ok: exclam.length === 0, detail: exclam.join(" | ") },
    { label: "aucun emoji", ok: emoji.length === 0, detail: emoji.join(" | ") },
  ];
}

const scenarios: Array<{ name: string; title: string; run: () => Promise<{ checks: Check[]; transcript: string[] }> }> = [
  {
    name: "artisan",
    title: "Artisan : le devis réel de la v1 (supports 60 modules, mairie d'Agoè)",
    async run() {
      const c = await conversation("artisan", "KYA");
      await c.send("Bonsoir");
      await c.send("Devis pour supports 60 modules, mairie Agoè : 45 barres de tube rectangulaire 80 x 40 à 17 000, 8 barres de cornière 50x5 à 14 000, 2 boîtes de peinture allu à 12 000, 10 litres de diluant à 1 200, 60 chevilles métalliques à 500. Main d'œuvre 160 000.");
      await c.send("oui c'est bon");
      await c.send("OK");
      const doc = await lastDocument(c.orgId);
      return {
        transcript: c.transcript,
        checks: [
          { label: "document émis", ok: doc?.status === "issued", detail: doc?.status ?? "aucun" },
          { label: "total 1 103 000", ok: doc?.totalMinor === "1103000", detail: doc?.totalMinor ?? "" },
          { label: "main-d'œuvre en montant (jamais convertie)", ok: doc?.adjustments.length === 1 && doc.adjustments[0]?.mode === "amount", detail: JSON.stringify(doc?.adjustments.map((a) => [a.label, a.mode])) },
          { label: "libellés gardés (80 x 40)", ok: Boolean(doc?.lines.some((l) => /80\s*x\s*40/i.test(l.label))), detail: doc?.lines.map((l) => l.label).join(" ; ") ?? "" },
          { label: "client renseigné", ok: Boolean(doc?.client.name && /agoè|agoe/i.test(doc.client.name)), detail: doc?.client.name ?? "" },
          ...voiceChecks(await c.replies()),
        ],
      };
    },
  },
  {
    name: "btp",
    title: "BTP complexe : sections, pourcentage, acompte, correction en langage libre",
    async run() {
      const c = await conversation("btp", "Atelier Kodjo");
      await c.send("Portail coulissant : 12 barres de tube 80 x 40 à 18 000 et 4 feuilles de tôle 20/10 à 32 000. Garde-corps : 8 barres de tube carré 40 x 40 à 15 000 et 2 boîtes de peinture antirouille à 18 000. Main-d'œuvre 25 %, transport et pose 30 000. Acompte 30 %. C'est pour la Société Bati Plus, chantier Adidogomé, portail et garde-corps d'une villa.");
      await c.send("en fait la tôle c'est 30 000 la feuille");
      await c.send("ajoute une garantie de 24 mois sur les soudures");
      const draft = await lastDocument(c.orgId);
      await c.send("prépare le PDF");
      await c.send("OK");
      const doc = await lastDocument(c.orgId);
      // 12×18 000 + 4×30 000 = 336 000 ; 8×15 000 + 2×18 000 = 156 000 ; postes 492 000 ;
      // main-d'œuvre 25 % = 123 000 ; transport 30 000 ; total 645 000 ; acompte 30 % = 193 500.
      return {
        transcript: c.transcript,
        checks: [
          { label: "deux sections titrées", ok: draft?.sections.length === 2 && draft.sections.every((s) => s.title), detail: JSON.stringify(draft?.sections.map((s) => s.title)) },
          { label: "main-d'œuvre en pourcentage 25 %", ok: Boolean(draft?.adjustments.some((a) => a.mode === "percent" && a.rateBp === 2500)), detail: JSON.stringify(draft?.adjustments.map((a) => [a.label, a.mode, a.rateBp, a.valueMinor])) },
          { label: "correction appliquée : total 645 000", ok: doc?.totalMinor === "645000", detail: doc?.totalMinor ?? "" },
          { label: "acompte 30 % = 193 500", ok: doc?.depositMinor === "193500", detail: doc?.depositMinor ?? "" },
          { label: "garantie notée", ok: Boolean(doc?.warrantyText || doc?.assumptions?.match(/24 mois/)), detail: `${doc?.warrantyText ?? ""} / ${doc?.assumptions ?? ""}` },
          { label: "chantier Adidogomé", ok: /adidogom/i.test(doc?.site ?? ""), detail: doc?.site ?? "" },
          { label: "document émis", ok: doc?.status === "issued", detail: doc?.status ?? "" },
          ...voiceChecks(await c.replies()),
        ],
      };
    },
  },
  {
    name: "facture",
    title: "Facture informelle puis « renvoie-moi le dernier PDF »",
    async run() {
      const c = await conversation("facture", "Nana Froid");
      await c.send("fais une facture pour Mme Ablavi : réparation du climatiseur 35 000 et recharge de gaz 15 000");
      await c.send("objet : dépannage climatisation");
      await c.send("ok");
      await c.send("ok");
      const doc = await lastDocument(c.orgId);
      if (doc) await render.handleJob({ id: "r", kind: "render_document", payload: { document_id: doc.id, version: 1 }, attempts: 1 });
      const sent = await c.send("renvoie-moi le dernier pdf stp");
      const replies = await c.replies();
      return {
        transcript: c.transcript,
        checks: [
          { label: "facture émise", ok: doc?.type === "invoice" && doc.status === "issued", detail: `${doc?.type} ${doc?.status}` },
          { label: "total 50 000", ok: doc?.totalMinor === "50000", detail: doc?.totalMinor ?? "" },
          { label: "client Mme Ablavi", ok: /ablavi/i.test(doc?.client.name ?? ""), detail: doc?.client.name ?? "" },
          { label: "dernier PDF renvoyé", ok: replies.at(-1)?.kind === "document", detail: `${replies.at(-1)?.kind} ${sent.join(" | ")}` },
          ...voiceChecks(replies),
        ],
      };
    },
  },
  {
    name: "contexte",
    title: "Au-delà de 12 échanges : le brouillon structuré reste la vérité",
    async run() {
      const c = await conversation("contexte", "Menuiserie Exemple");
      await c.send("devis : 3 portes isoplanes à 45 000, pose 30 000");
      const chatter = [
        "c'est combien de temps pour le pdf ?", "tu fais aussi les factures ?", "et les proformas ?", "comment je change mon logo ?",
        "c'est quoi mon quota ?", "je peux te parler en vocal ?", "tu gardes mes prix pour toi ?", "le client peut accepter en ligne ?",
        "j'attends le client", "il est en retard", "bon", "on continue", "attends",
      ];
      for (const m of chatter) await c.send(m);
      await c.send("le client c'est M. Mensah");
      const doc = await lastDocument(c.orgId);
      return {
        transcript: c.transcript,
        checks: [
          { label: "plus de 12 échanges", ok: chatter.length + 2 > 12, detail: String(chatter.length + 2) },
          { label: "client ajouté après 14 messages", ok: /mensah/i.test(doc?.client.name ?? ""), detail: doc?.client.name ?? "" },
          { label: "brouillon intact (165 000, rien de perdu)", ok: doc?.totalMinor === "165000" && doc.lines.length + doc.adjustments.length === 2, detail: `${doc?.totalMinor} / ${doc?.lines.length} + ${doc?.adjustments.length}` },
          ...voiceChecks(await c.replies()),
        ],
      };
    },
  },
];

const report: string[] = ["# Évaluation des dialogues (IA réelle)", "", `Date : ${new Date().toISOString()}`, ""];
let failures = 0;
for (const s of scenarios) {
  try {
    const { checks, transcript } = await s.run();
    const ok = checks.every((c) => c.ok);
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} ${s.title}`);
    for (const c of checks) if (!c.ok) console.log(`    ✗ ${c.label} : ${c.detail}`);
    report.push(`## ${ok ? "✓" : "✗"} ${s.title}`, "", ...checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.label}${c.ok ? "" : ` — ${c.detail}`}`), "", "<details><summary>Conversation</summary>", "", ...transcript.map((l) => `${l.replace(/\n/g, "  \n")}  `), "", "</details>", "");
  } catch (error) {
    failures++;
    console.log(`✗ ${s.title} : ${(error as Error).message}`);
    report.push(`## ✗ ${s.title}`, "", `Erreur : ${(error as Error).message}`, "");
  }
}
const out = path.resolve("../.local/eval");
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "dialogues.md"), report.join("\n"));
console.log(`${scenarios.length - failures}/${scenarios.length} scénarios réussis — rapport : .local/eval/dialogues.md`);
await pool.end();
process.exit(failures ? 1 : 0);
