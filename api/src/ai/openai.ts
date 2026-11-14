import { createOpenAI } from "@ai-sdk/openai";
import { generateText, NoTranscriptGeneratedError, Output, transcribe } from "ai";
import { z } from "zod";
import type { AiCall, AiReader, EditOp, Interpretation, ReadContext, SaleReading } from "./types.js";

// Lecture par IA (AI SDK + OpenAI). Les modèles viennent de la base (`ai_tasks`) : aucun nom de
// modèle dans le code (constitution IV). L'IA recopie ; elle ne calcule et n'invente jamais.

export type ModelResolver = (task: "transcribe" | "read" | "intent") => Promise<{ model: string; enabled: boolean }>;

const lineSchema = z.object({
  label: z.string().describe("Désignation, recopiée et mise au propre (orthographe, majuscule), sans prix."),
  quantity_text: z.string().nullable().describe("Quantité exactement comme dite ou écrite, sinon null."),
  unit: z.string().nullable().describe("Code d'unité choisi dans la liste fournie, sinon null."),
  unit_price_text: z.string().nullable().describe("Prix UNITAIRE exactement comme dit ou écrit (chiffres ou lettres), sinon null."),
  line_total_text: z.string().nullable().describe("Montant de la ligne s'il est donné à la place du prix unitaire, sinon null."),
});

const readingSchema = z.object({
  document_type: z.enum(["quote", "proforma", "invoice", "delivery_note"]).nullable(),
  client_name: z.string().nullable(),
  title: z.string().nullable().describe("Objet court du document (ex. « Rénovation cuisine »), sinon null."),
  lines: z.array(lineSchema),
});

const RULES = [
  "Tu lis une vente décrite par un artisan ou un commerçant, pour en faire un devis ou une facture.",
  "RÈGLE ABSOLUE : tu ne calcules rien, tu n'inventes rien, tu ne corriges aucun nombre.",
  "Recopie chaque nombre (quantité, prix, montant) EXACTEMENT comme il apparaît dans la source.",
  "Si un prix ou une quantité n'est pas dit, mets null : l'artisan le précisera.",
  "Si seul un montant global de ligne est donné, mets-le dans line_total_text, pas dans unit_price_text.",
  "Ne fusionne pas et ne découpe pas les lignes autrement que la source.",
  "Les désignations restent dans la langue de l'artisan ; corrige seulement l'orthographe et la casse.",
  "Ignore les salutations et tout ce qui n'est pas une ligne de vente.",
].join("\n");

function context(ctx: ReadContext): string {
  return [
    `Langue de l'artisan : ${ctx.locale}. Devise : ${ctx.currencyCode} (${ctx.currencySymbol}).`,
    ctx.trade ? `Métier : ${ctx.trade}.` : "",
    `Unités possibles (code = libellé) : ${ctx.units.map((u) => `${u.code} = ${u.label}`).join(", ")}.`,
  ].filter(Boolean).join("\n");
}

function toReading(o: z.infer<typeof readingSchema>): SaleReading {
  return {
    documentType: o.document_type,
    clientName: o.client_name,
    title: o.title,
    lines: o.lines.map((l) => ({
      label: l.label,
      quantityText: l.quantity_text,
      unit: l.unit,
      unitPriceText: l.unit_price_text,
      lineTotalText: l.line_total_text,
    })),
  };
}

const opSchema = z.object({
  op: z.enum(["set_price", "set_quantity", "set_label", "set_unit", "remove", "add", "client", "title", "discount", "tax"]),
  line: z.number().int().nullable().describe("Numéro de ligne concerné (1 = première), sinon null."),
  value_text: z.string().nullable().describe("Valeur EXACTEMENT comme écrite par l'artisan (prix, quantité, texte, nom…)."),
  enabled: z.boolean().nullable().describe("Pour « tax » : true = avec taxe, false = sans."),
  lines: z.array(lineSchema).nullable().describe("Pour « add » : lignes à ajouter."),
});

const interpretationSchema = z.object({
  action: z.enum(["new_sale", "edit", "issue", "cancel", "help", "list", "settings", "other"]),
  ops: z.array(opSchema),
});

function toOps(ops: z.infer<typeof opSchema>[]): EditOp[] {
  const out: EditOp[] = [];
  for (const o of ops) {
    const line = o.line ?? 0;
    const v = o.value_text;
    switch (o.op) {
      case "set_price":
        if (line && v) out.push({ op: "set_price", line, valueText: v });
        break;
      case "set_quantity":
        if (line && v) out.push({ op: "set_quantity", line, valueText: v });
        break;
      case "set_label":
        if (line && v) out.push({ op: "set_label", line, text: v });
        break;
      case "set_unit":
        if (line) out.push({ op: "set_unit", line, unit: v });
        break;
      case "remove":
        if (line) out.push({ op: "remove", line });
        break;
      case "add":
        if (o.lines?.length) {
          out.push({
            op: "add",
            lines: o.lines.map((l) => ({ label: l.label, quantityText: l.quantity_text, unit: l.unit, unitPriceText: l.unit_price_text, lineTotalText: l.line_total_text })),
          });
        }
        break;
      case "client":
        out.push({ op: "client", name: v });
        break;
      case "title":
        out.push({ op: "title", text: v });
        break;
      case "discount":
        out.push({ op: "discount", valueText: v });
        break;
      case "tax":
        if (o.enabled !== null) out.push({ op: "tax", enabled: o.enabled });
        break;
    }
  }
  return out;
}

export function openAiReader(apiKey: string, resolve: ModelResolver): AiReader {
  const provider = createOpenAI({ apiKey });

  async function model(task: "transcribe" | "read" | "intent") {
    const m = await resolve(task);
    if (!m.enabled) throw new Error(`tâche d'IA désactivée : ${task}`);
    return m.model;
  }

  return {
    simulated: false,
    async transcribe(audio, mediaType, locale): Promise<AiCall<string | null>> {
      const started = Date.now();
      const name = await model("transcribe");
      try {
        const result = await transcribe({
          model: provider.transcription(name),
          audio,
          providerOptions: { openai: { language: locale.slice(0, 2) } },
          maxRetries: 1,
        });
        return {
          value: result.text.trim() || null,
          usage: { model: name, audioSeconds: result.durationInSeconds ?? undefined, durationMs: Date.now() - started },
        };
      } catch (error) {
        if (NoTranscriptGeneratedError.isInstance(error)) {
          return { value: null, usage: { model: name, durationMs: Date.now() - started } };
        }
        throw error;
      }
      void mediaType;
    },
    async readText(text, ctx): Promise<AiCall<SaleReading>> {
      const started = Date.now();
      const name = await model("read");
      const result = await generateText({
        model: provider(name),
        output: Output.object({ schema: readingSchema }),
        instructions: `${RULES}\n${context(ctx)}`,
        messages: [{ role: "user", content: text }],
        maxRetries: 1,
      });
      return {
        value: toReading(result.output),
        usage: { model: name, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs: Date.now() - started },
      };
    },
    async readImage(image, mediaType, ctx): Promise<AiCall<SaleReading>> {
      const started = Date.now();
      const name = await model("read");
      const result = await generateText({
        model: provider(name),
        output: Output.object({ schema: readingSchema }),
        instructions: `${RULES}\nLa source est une photo de devis, de facture ou de note manuscrite.\n${context(ctx)}`,
        messages: [{ role: "user", content: [{ type: "image", image, mediaType }] }],
        maxRetries: 1,
      });
      return {
        value: toReading(result.output),
        usage: { model: name, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs: Date.now() - started },
      };
    },
    async interpret(text, draftSummary, ctx): Promise<AiCall<Interpretation>> {
      const started = Date.now();
      const name = await model("intent");
      const result = await generateText({
        model: provider(name),
        output: Output.object({ schema: interpretationSchema }),
        instructions: [
          "Un artisan échange avec Firmo à propos de son brouillon de document (affiché ci-dessous).",
          "Décide si son message corrige le brouillon (edit), décrit une NOUVELLE vente (new_sale), valide (issue),",
          "annule (cancel), demande de l'aide (help), ses documents (list) ou ses réglages (settings).",
          "Pour edit, liste les opérations. Recopie les valeurs EXACTEMENT comme écrites, sans calcul.",
          context(ctx),
          `Brouillon actuel :\n${draftSummary}`,
        ].join("\n"),
        messages: [{ role: "user", content: text }],
        maxRetries: 1,
      });
      return {
        value: { action: result.output.action, ops: toOps(result.output.ops) },
        usage: { model: name, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, durationMs: Date.now() - started },
      };
    },
  };
}
