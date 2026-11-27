import { createOpenAI } from "@ai-sdk/openai";
import { generateText, NoTranscriptGeneratedError, Output, transcribe } from "ai";
import { z } from "zod";
import {
  type AiCall, type AiReader, type Correction, type DocumentField, INTENTS, type ReadAdjustment, type ReadContext,
  type ReadLine, type SaleReading, type TurnContext, type TurnDecision,
} from "./types.js";

// Lecture et décision par IA (AI SDK + OpenAI). Les modèles viennent de la base (`ai_tasks`) :
// aucun nom de modèle dans le code (constitution IV). Consignes reprises de la v1 : l'IA recopie,
// elle ne calcule et n'invente jamais ; chaque nombre est ensuite vérifié contre la source.

export type ModelResolver = (task: "transcribe" | "read" | "intent") => Promise<{ model: string; enabled: boolean }>;

const lineSchema = z.object({
  label: z.string().describe("Libellé tel que l'artisan l'écrit, dimensions et notation comprises, sans prix."),
  description: z.string().nullable().describe("Précision attachée à la ligne, jamais dans le libellé, sinon null."),
  descriptive: z.boolean().describe("true pour une ligne de texte sans montant."),
  quantity_text: z.string().nullable().describe("Quantité exactement comme dite ou écrite, sinon null."),
  unit: z.string().nullable().describe("Unité exactement comme dite (barre, boîte, m², jour, forfait…), sinon null."),
  unit_price_text: z.string().nullable().describe("Prix UNITAIRE exactement comme dit ou écrit, sinon null."),
  line_total_text: z.string().nullable().describe("Montant forfaitaire de la ligne (ou total quand le prix unitaire manque), sinon null."),
});

const adjustmentSchema = z.object({
  label: z.string(),
  mode: z.enum(["percent", "amount"]).describe("percent seulement si « % », « pour cent » ou « percent » est dit."),
  negative: z.boolean().describe("true pour une remise ou une réduction."),
  base: z.enum(["items_total", "taxable_base"]),
  value_text: z.string().nullable().describe("Valeur exactement comme dite, sinon null."),
});

const readingSchema = z.object({
  document_type: z.enum(["quote", "proforma", "invoice", "delivery_note"]).nullable(),
  client_name: z.string().nullable(),
  client_phone: z.string().nullable(),
  client_address: z.string().nullable(),
  subject: z.string().nullable().describe("Objet : l'ouvrage et son destinataire (« supports 60 modules, mairie Agoè »)."),
  site: z.string().nullable(),
  delivery_text: z.string().nullable(),
  warranty_text: z.string().nullable(),
  assumptions: z.string().nullable().describe("Conditions dites explicitement, sinon null."),
  validity_days_text: z.string().nullable(),
  deposit_percent_text: z.string().nullable(),
  sections: z.array(z.object({
    title: z.string().nullable(),
    show_subtotal: z.boolean(),
    lines: z.array(lineSchema),
  })),
  adjustments: z.array(adjustmentSchema),
});

const EXTRACTION = `
Tu lis une source de chiffrage pour Firmo. Restitue seulement ce qui est explicitement présent.
N'invente jamais une quantité, un prix, un montant, un client ou une condition : une valeur absente
ou incertaine reste null. Ne calcule rien. Recopie chaque nombre EXACTEMENT comme il apparaît.
Garde les libellés et les groupes dans l'ordre de la source, avec leur notation et leurs dimensions
(« 80 x 40 », « 50x5 », « 20/10 ») : ne les normalise jamais. Le libellé ne contient jamais la quantité :
« 45 barres de tube 80 x 40 à 17 000 » donne quantity_text « 45 », unit « barre », label « Barre tube 80 x 40 ».

Le destinataire du document (une mairie, une société, « M. Kodjo », « Mme Ablavi ») est le client
(client_name), jamais le chantier. site est le lieu d'exécution des travaux seulement s'il est dit comme un lieu
(« chantier à Adidogomé », « à Légbassito »). L'objet (subject) décrit l'ouvrage (« supports 60 modules »).

Une main-d'œuvre, un transport ou une remise placés après les postes deviennent des adjustments,
jamais des lignes. Un adjustment est en percent uniquement lorsque la source dit « % », « pour cent »
ou « percent » ; exprimé en F ou FCFA, c'est un montant, quel que soit son libellé. Ne transforme
jamais un montant en pourcentage. Un pourcentage peut dépasser 100.

Extrais toute information documentaire explicitement dite : téléphone et adresse du client,
description d'une ligne, lieu du chantier (site), délai (delivery_text), garantie (warranty_text),
conditions (assumptions). « Valable 30 jours » va dans validity_days_text, « acompte 30 % » dans
deposit_percent_text. Chaque groupe nommé (« Portail coulissant : …. Garde-corps : … ») devient une section
avec son titre, dans l'ordre : ne fusionne jamais deux groupes et ne les aplatis jamais en une liste.
Sans groupe, une seule section sans titre.

Dans un tableau, un total de ligne se calcule à partir de la quantité et du prix unitaire : ne le
mets pas dans line_total_text si le prix unitaire est donné. Un total d'achat ou un sous-total ne crée
ni ligne ni section. La source peut être écrite en français courant d'Afrique de l'Ouest, sans accents,
avec F, FCFA, des espaces dans les montants, une virgule décimale : ce n'est jamais une autorisation
d'inférer une valeur. Une faute phonétique évidente d'un mot courant du métier peut être corrigée
(« affournitures » → « fournitures ») ; jamais un nombre, une dimension, une unité ou un nom propre.

Si la source ne contient aucun poste chiffrable explicite, retourne sections=[] et garde seulement
les informations documentaires certaines. Une demande de rappel, de PDF ou de correction n'est jamais
une nouvelle ligne. Le document est un devis sauf si la source dit facture, proforma ou bon de livraison.
`.trim();

const IMAGE_TRANSCRIPTION = `
Transcris cette feuille mot pour mot. Conserve nombres, espaces, groupes, dimensions et ratures.
Écris [illisible] à la place de tout élément incertain. N'interprète et ne complète rien.
`.trim();

const correctionSchema = z.object({
  target: z.enum(["line", "section", "adjustment", "document", "payment"]),
  op: z.enum(["set", "remove", "add", "move", "append"]),
  line: z.number().int().nullable().describe("Numéro de ligne tel qu'affiché (1 = première), sinon null."),
  section: z.number().int().nullable().describe("Numéro de section tel qu'affiché (1 = première), sinon null."),
  adjustment: z.number().int().nullable().describe("Numéro d'ajustement tel qu'affiché (1 = premier), sinon null."),
  field: z.enum([
    "label", "description", "unit", "quantity", "unit_price", "flat_amount", "title", "show_subtotal",
    "value", "mode", "sign", "base", "client_name", "client_phone", "client_address", "subject", "summary",
    "site", "delivery_text", "warranty_text", "assumptions", "validity_days", "deposit_percent", "tax", "type",
  ]).nullable(),
  value_text: z.string().nullable().describe("Nouvelle valeur recopiée EXACTEMENT du dernier message."),
  new_lines: z.array(lineSchema).describe("Lignes à ajouter (op add sur line ou section), sinon []."),
  new_adjustment: adjustmentSchema.nullable(),
  method: z.string().nullable().describe("Moyen de paiement dit (payment add), sinon null."),
});

const decisionSchema = z.object({
  intent: z.enum(INTENTS),
  corrections: z.array(correctionSchema),
  reply: z.string().nullable(),
  search_query: z.string().nullable(),
  target_type: z.enum(["quote", "proforma", "invoice", "delivery_note"]).nullable(),
  start_new_document: z.boolean(),
});

const DECISION = `
Tu es Firmo, l'assistant de devis d'un artisan, dans sa messagerie. Analyse UN seul tour et retourne
un plan structuré exploitable par le code. Le brouillon et l'historique donnent le contexte ; seuls les
mots du DERNIER message prouvent un nouveau chiffre, un nom ou une condition. Comprends le français
courant d'Afrique de l'Ouest, les fautes, les messages courts et les demandes indirectes.

Intentions :
- greeting : salutation, prise de contact. Réponds et oriente vers un premier devis par vocal, photo ou texte.
- admin : demander l'administration, le pilotage ou le tableau de bord du propriétaire.
- confirm : valider explicitement (« oui », « ok », « valide », « c'est bon », « vas-y ») ce que Firmo vient de
  proposer. « bon », « on continue », « attends », « hmm » ne sont PAS des confirmations : other avec une question.
- finalize : demander le PDF final numéroté du brouillon (« émets », « prépare le PDF final »).
  L'émission consomme un document ; le code demande toujours une confirmation.
- preview : voir le brouillon ou son PDF gratuitement avant l'émission (« montre l'aperçu »).
- settings : logo, couleur, identité, numérotation, conditions par défaut.
- show_latest : relire le brouillon ou le dernier document (« rappelle-moi le devis », « qu'as-tu compris »).
- download_latest : renvoyer le PDF d'un document déjà émis.
- list_documents : la liste, l'historique ou l'espace des documents.
- quota : combien de documents il reste, l'utilisation.
- subscription : s'abonner, payer, recharger, acheter des documents, lien de paiement.
- stats : statistiques de documents.
- search : chercher un document, un client, un objet ou un numéro ; search_query = les seuls termes utiles.
- convert : demande EXPLICITE de transformer ce document en devis, proforma ou facture (« fais-en une facture »,
  « transforme-le en proforma ») ; target_type obligatoire. Une question (« tu fais aussi les factures ? »,
  « et les proformas ? ») n'est jamais convert : c'est help.
- duplicate : copier le dernier document pour un nouveau brouillon.
- share : partager ou envoyer le dernier document émis à quelqu'un.
- new_document : abandonner le brouillon pour repartir, SANS donner de prestation dans le même message.
- help : une question sur ce que Firmo sait faire, sur un délai, sur le fonctionnement (« c'est combien de temps
  pour le pdf ? », « tu fais aussi les factures ? », « je peux te parler en vocal ? ») ; reply contextuel et court.
  Une question n'est jamais une demande d'action (ni preview, ni finalize, ni convert).
- source : une nouvelle prestation réellement chiffrée, ou un nouveau document avec ses données.
  start_new_document=true seulement si le message demande explicitement un nouveau document ET en donne les données.
- delete_data : la personne demande la suppression de ses données.
- other : corriger ou compléter le brouillon (retourne alors les corrections), ou question non couverte.

Corrections (intention other uniquement) : retourne chaque correction explicite, dans l'ordre du message,
sans en fusionner ni en omettre. Positions telles qu'affichées dans le brouillon : ligne 1, section 1,
ajustement 1. Une valeur isolée (« mets 5 ») ne permet jamais de choisir une ligne au hasard, sauf si
Firmo vient de poser une seule question précise à laquelle elle répond sans ambiguïté.
- Client : document.client_name, seulement si un NOM est donné (« pour M. Kodjo » → « M. Kodjo » ; « pour »,
  « le client c'est » n'en font pas partie). « J'attends le client », « il est en retard » ne contiennent aucun nom :
  aucune correction. Ne prends jamais un mot du message pour un nom s'il n'en est pas un.
- Objet ou titre du devis : document.subject. Intitulé d'un poste : line.label. Intitulé d'un ajustement : adjustment.label.
- Lieu : document.site ; délai : document.delivery_text ; garantie (« garantie de 24 mois sur les soudures ») :
  document.warranty_text avec value_text « 24 mois sur les soudures ».
Tout texte recopié dans value_text (nom, objet, condition, libellé) doit figurer mot pour mot dans le dernier message.
- « Valable 30 jours » : document.validity_days ; « acompte 30 % » : document.deposit_percent ;
  « sans TVA » / « avec TVA » : document.tax avec value_text "false" / "true".
- Une condition libre s'ajoute avec document.assumptions op append (sans effacer les autres).
- Nouveau poste chiffré : line add (section si dite) avec new_lines. Nouvelle section : section add, value_text = titre.
- Main-d'œuvre, transport, remise : adjustment add avec new_adjustment ; valeur null si elle n'est pas dite.
- Déplacer une ligne : line move avec section de destination. Retirer : op remove.
- Paiement annoncé (« il a payé 50 000 ») : payment add, value_text = montant tel que dit, method si dit.
  Firmo ne note pas les paiements des clients : ce n'est jamais une ligne ni un ajustement.
Toute nouvelle valeur numérique est recopiée mot pour mot du dernier message. Si une correction n'est pas
certaine, ne retourne aucune correction et pose une seule question précise dans reply.

Une formule de salutation ne domine jamais une demande explicite du même message. « Pour M. Kodjo » est une
réponse de client, pas une source. Rappeler des lignes déjà présentes pour poser une question n'est pas source.

reply : pour greeting, help et other (sans correction ou pour une question), une réponse naturelle, directe,
de deux phrases au plus, en tutoyant, sans emoji ni point d'exclamation, sans parler d'intelligence
artificielle. N'affirme jamais qu'une action a été faite (« j'ajoute », « c'est noté ») : une modification passe
uniquement par les corrections. Ne fabrique aucun lien, ne promets aucune capacité
absente (rappel, envoi automatique). Pour les autres intentions, reply reste null. search_query et target_type
restent null sauf pour leurs intentions.
`.trim();

function toLine(l: z.infer<typeof lineSchema>): ReadLine {
  return {
    label: l.label,
    description: l.description,
    descriptive: l.descriptive,
    quantityText: l.quantity_text,
    unit: l.unit,
    unitPriceText: l.unit_price_text,
    lineTotalText: l.line_total_text,
  };
}

function toAdjustment(a: z.infer<typeof adjustmentSchema>): ReadAdjustment {
  return { label: a.label, mode: a.mode, sign: a.negative ? -1 : 1, base: a.base, valueText: a.value_text };
}

export function toReading(o: z.infer<typeof readingSchema>): SaleReading {
  return {
    documentType: o.document_type,
    clientName: o.client_name,
    clientPhone: o.client_phone,
    clientAddress: o.client_address,
    title: o.subject,
    site: o.site,
    deliveryText: o.delivery_text,
    warrantyText: o.warranty_text,
    assumptions: o.assumptions,
    validityDaysText: o.validity_days_text,
    depositPercentText: o.deposit_percent_text,
    sections: o.sections.map((s) => ({ title: s.title, showSubtotal: s.show_subtotal, lines: s.lines.map(toLine) })),
    adjustments: o.adjustments.map(toAdjustment),
  };
}

const LINE_FIELDS = new Set(["label", "description", "unit", "quantity", "unit_price", "flat_amount"]);
const ADJ_FIELDS = new Set(["label", "value", "mode", "sign", "base"]);
const DOC_FIELDS = new Set([
  "client_name", "client_phone", "client_address", "subject", "summary", "site", "delivery_text", "warranty_text",
  "assumptions", "validity_days", "deposit_percent", "tax", "type",
]);

/** Corrections brutes → corrections valides ; une correction incomplète est écartée. */
export function toCorrections(raw: z.infer<typeof correctionSchema>[]): Correction[] {
  const out: Correction[] = [];
  for (const c of raw) {
    const pos = (n: number | null) => (n !== null && n >= 1 ? n : null);
    const line = pos(c.line);
    const section = pos(c.section);
    const adjustment = pos(c.adjustment);
    const field = c.field ?? "";
    switch (c.target) {
      case "line":
        if (c.op === "set" && line && LINE_FIELDS.has(field)) out.push({ target: "line", op: "set", line, field: field as never, valueText: c.value_text });
        else if (c.op === "remove" && line) out.push({ target: "line", op: "remove", line });
        else if (c.op === "move" && line && section) out.push({ target: "line", op: "move", line, section });
        else if (c.op === "add") for (const l of c.new_lines) out.push({ target: "line", op: "add", section, line: toLine(l) });
        break;
      case "section":
        if (c.op === "set" && section && (field === "title" || field === "show_subtotal")) out.push({ target: "section", op: "set", section, field, valueText: c.value_text });
        else if (c.op === "remove" && section) out.push({ target: "section", op: "remove", section });
        else if (c.op === "add" && c.value_text) out.push({ target: "section", op: "add", title: c.value_text, lines: c.new_lines.map(toLine) });
        break;
      case "adjustment":
        if (c.op === "set" && adjustment && ADJ_FIELDS.has(field)) out.push({ target: "adjustment", op: "set", adjustment, field: field as never, valueText: c.value_text });
        else if (c.op === "remove" && adjustment) out.push({ target: "adjustment", op: "remove", adjustment });
        else if (c.op === "add" && c.new_adjustment) out.push({ target: "adjustment", op: "add", adjustment: toAdjustment(c.new_adjustment) });
        break;
      case "document":
        // « Ajouter » une condition s'empile ; « ajouter » une garantie, un délai, un lieu les renseigne.
        if (field === "assumptions" && (c.op === "append" || c.op === "add") && c.value_text) out.push({ target: "document", op: "append", field: "assumptions", valueText: c.value_text });
        else if ((c.op === "set" || c.op === "append" || c.op === "add") && DOC_FIELDS.has(field)) out.push({ target: "document", op: "set", field: field as DocumentField, valueText: c.value_text });
        break;
      case "payment":
        if (c.op === "add" && c.value_text) out.push({ target: "payment", op: "add", amountText: c.value_text, method: c.method });
        break;
    }
  }
  return out;
}

function context(ctx: ReadContext): string {
  return [
    `Langue de l'artisan : ${ctx.locale}. Devise : ${ctx.currencyCode} (${ctx.currencySymbol}).`,
    ctx.trade ? `Métier : ${ctx.trade}.` : "",
  ].filter(Boolean).join("\n");
}

export function openAiReader(apiKey: string, resolve: ModelResolver): AiReader {
  const provider = createOpenAI({ apiKey });

  async function model(task: "transcribe" | "read" | "intent") {
    const m = await resolve(task);
    if (!m.enabled) throw new Error(`tâche d'IA désactivée : ${task}`);
    return m.model;
  }

  async function readFrom(text: string, ctx: ReadContext, started: number, extra?: { inputTokens?: number; outputTokens?: number }): Promise<AiCall<SaleReading>> {
    const name = await model("read");
    const result = await generateText({
      model: provider(name),
      output: Output.object({ schema: readingSchema }),
      instructions: `${EXTRACTION}\n${context(ctx)}`,
      messages: [{ role: "user", content: text }],
      maxRetries: 1,
    });
    return {
      value: toReading(result.output),
      usage: {
        model: name,
        inputTokens: (result.usage.inputTokens ?? 0) + (extra?.inputTokens ?? 0),
        outputTokens: (result.usage.outputTokens ?? 0) + (extra?.outputTokens ?? 0),
        durationMs: Date.now() - started,
      },
    };
  }

  return {
    simulated: false,
    async transcribe(audio, _mediaType, locale): Promise<AiCall<string | null>> {
      const started = Date.now();
      const name = await model("transcribe");
      try {
        const result = await transcribe({
          model: provider.transcription(name),
          audio,
          providerOptions: { openai: { language: locale.slice(0, 2) } },
          maxRetries: 1,
        });
        const text = result.text.trim().replace(/\baffournitures?\b/gi, (m) => m.replace(/^af/i, ""));
        return { value: text || null, usage: { model: name, audioSeconds: result.durationInSeconds ?? undefined, durationMs: Date.now() - started } };
      } catch (error) {
        if (NoTranscriptGeneratedError.isInstance(error)) {
          return { value: null, usage: { model: name, durationMs: Date.now() - started } };
        }
        throw error;
      }
    },
    readText(text, ctx) {
      return readFrom(text, ctx, Date.now());
    },
    async readImage(image, mediaType, ctx): Promise<AiCall<SaleReading>> {
      // Comme en v1 : la feuille est d'abord transcrite mot pour mot, puis lue comme un texte ;
      // chaque nombre retenu est ainsi vérifiable contre la transcription.
      const started = Date.now();
      const name = await model("read");
      const seen = await generateText({
        model: provider(name),
        instructions: IMAGE_TRANSCRIPTION,
        messages: [{ role: "user", content: [{ type: "image", image, mediaType }] }],
        maxRetries: 1,
      });
      const transcript = seen.text.trim();
      if (!transcript) return { value: { documentType: null, clientName: null, title: null, sections: [], adjustments: [] }, usage: { model: name, durationMs: Date.now() - started } };
      const read = await readFrom(transcript, ctx, started, { inputTokens: seen.usage.inputTokens, outputTokens: seen.usage.outputTokens });
      return { ...read, value: { ...read.value, sourceText: transcript } };
    },
    async decide(message, ctx: TurnContext): Promise<AiCall<TurnDecision>> {
      const started = Date.now();
      const name = await model("intent");
      const history = ctx.history.length
        ? ctx.history.map((h) => `${h.role === "user" ? "Artisan" : "Firmo"} : ${h.text}`).join("\n")
        : "Aucun message précédent.";
      const result = await generateText({
        model: provider(name),
        output: Output.object({ schema: decisionSchema }),
        instructions: `${DECISION}\n${context(ctx)}`,
        messages: [{
          role: "user",
          content: [
            `Historique récent :\n${history}`,
            `Brouillon actif :\n${ctx.draft ?? "Aucun brouillon."}`,
            `Dernier document émis :\n${ctx.latest ?? "Aucun."}`,
            ctx.awaiting ? `Firmo attend une réponse à : ${ctx.awaiting}` : "",
            `Dernier message de l'artisan :\n${message}`,
          ].filter(Boolean).join("\n\n"),
        }],
        maxRetries: 1,
      });
      const o = result.output;
      return {
        value: {
          intent: o.intent,
          corrections: o.intent === "other" ? toCorrections(o.corrections) : [],
          reply: o.reply,
          searchQuery: o.search_query,
          targetType: o.target_type,
          startNewDocument: o.start_new_document,
        },
        usage: { model: name, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs: Date.now() - started },
      };
    },
  };
}
