import { type Checker, capitalizeInitial, checker, guardAdjustment, guardLine, guardReading, heard } from "../ai/guard.js";
import { decideSimple } from "../ai/rules.js";
import type { AiCall, AiReader, Correction, DocumentType, Intent, ReadContext, ReadLine, SaleReading, TurnDecision } from "../ai/types.js";
import { ChannelError, type Button, type Channel } from "../channels/types.js";
import { formatMoney, formatQuantity } from "../documents/money.js";
import type { DocumentStore, DocumentView, DraftContent, DraftFields, LineInput } from "../documents/store.js";
import { HttpError } from "../lib/errors.js";
import type { ObjectStore } from "../lib/storage.js";
import { percentText } from "../render/model.js";
import type { RenderedFiles, RenderService } from "../render/service.js";
import { type ChatDraft, type ChatLine, type ChatWords, chatWords, type Missing, noun } from "../voix/chat.js";
import { PermanentJobError, type Job } from "../worker/worker.js";
import { BUTTONS, type Command, parseCommand } from "./commands.js";
import type { ConversationState, ConversationStore, OrgContext, StoredMessage } from "./store.js";

// Moteur de conversation au niveau de la v1 (PARITE_V1 §3) : un message → une décision (intention
// et corrections, avec les 12 derniers échanges) → des réponses courtes dans la voix de Firmo.
// Règles de la v1 : la lecture est toujours montrée avant de composer ; une question à la fois ;
// l'aperçu est gratuit et filigrané ; l'émission (1 document) n'a lieu qu'après « OK » ; aucun
// nombre n'entre dans un document s'il n'a pas été dit par l'artisan. Montants et quota : SQL.

export interface EngineDeps {
  store: ConversationStore;
  documents: DocumentStore;
  reader: AiReader;
  channels: Map<string, Channel>;
  files: ObjectStore;
  render: RenderService;
  webUrl: string;
  /** Formulaire reçu par le chat (WhatsApp Flows) : enregistré comme sur le web (spec 005). */
  applyForm?: (orgId: string, name: string, values: Record<string, string>) => Promise<void>;
  /** Lien d'administration pour une identité de l'équipe (spec 013) ; null si elle n'en est pas. */
  adminLink?: (identityId: string) => Promise<{ url: string; minutes: number } | null>;
}

interface Turn {
  msg: StoredMessage;
  ctx: OrgContext;
  w: ChatWords;
  channel: Channel;
  state: ConversationState;
  documentId: string | null;
  /** Texte du message (ou transcription du vocal) : seule preuve des nombres. */
  text: string;
  attempts: number;
}

type Awaiting = "pdf_offer" | "issue_confirm" | "missing" | "business_name" | null;

export class ConversationEngine {
  constructor(private readonly d: EngineDeps) {
    d.render.onRendered((doc, files) => this.deliver(doc, files));
  }

  /** Tâche `process_message`. */
  async handleJob(job: Job): Promise<void> {
    const id = String(job.payload.message_id ?? "");
    const msg = await this.d.store.load(id);
    if (!msg) throw new PermanentJobError("message introuvable");
    if (msg.status === "processed") return;
    const channel = this.d.channels.get(msg.channel);
    if (!channel) throw new PermanentJobError(`canal non configuré : ${msg.channel}`);
    const started = Date.now();
    await this.d.store.setStatus(id, "processing");
    const ctx = await this.d.store.context(msg.orgId);
    const turn: Turn = {
      msg, ctx, w: chatWords(ctx.locale), channel, state: await this.d.store.state(msg.identityId),
      documentId: null, text: msg.text?.trim() ?? "", attempts: job.attempts,
    };
    try {
      await this.process(turn);
      await this.d.store.setStatus(id, "processed", { durationMs: Date.now() - started, documentId: turn.documentId });
    } catch (error) {
      // Panne passagère avant tout geste (IA, téléchargement) : la tâche est retentée.
      if (isRetryable(error) && job.attempts < 3) {
        await this.d.store.setStatus(id, "received").catch(() => undefined);
        throw error;
      }
      await this.d.store.setStatus(id, "failed", { error: (error as Error).message?.slice(0, 500), durationMs: Date.now() - started });
      await this.say(turn, turn.w.error).catch(() => undefined);
      throw new PermanentJobError((error as Error).message);
    }
  }

  // ---------------------------------------------------------------- aiguillage

  private async process(t: Turn): Promise<void> {
    const { msg, w } = t;
    if (msg.firstMessage) {
      // Premier contact (voix #1) et ce qu'un lien expose, dit tout de suite (décisions v1).
      await this.say(t, w.welcome);
      await this.say(t, w.privacy(`${this.web()}/confidentialite`));
      if (msg.kind === "text" && (/^\/start/.test(t.text) || decideSimple(t.text, { draft: null }).intent === "greeting")) return;
    }
    if (msg.kind === "form" && msg.form) {
      await this.d.applyForm?.(msg.orgId, msg.form.name, msg.form.values);
      await this.say(t, w.updated);
      return;
    }
    if (msg.kind === "image") {
      await this.say(t, w.ackPhoto);
      if (this.d.reader.simulated) return void (await this.say(t, w.outagePhoto));
      await this.readSource(t, { image: await this.download(t) }, false);
      return;
    }
    if (msg.kind === "audio") {
      await this.say(t, w.ackVoice);
      if (this.d.reader.simulated) return void (await this.say(t, w.outageVoice));
      const audio = await this.download(t);
      const heard = await this.ai(t, "transcribe", () => this.d.reader.transcribe(audio.bytes, audio.mediaType, t.ctx.locale));
      if (!heard) return void (await this.say(t, w.transcribeFailed));
      t.text = heard;
      await this.d.store.setStatus(msg.id, "processing", { transcript: heard });
    }
    if (!t.text) return void (await this.say(t, w.notUnderstood));

    const command = parseCommand(t.text);
    if (t.state.awaiting === "business_name" && (!command || command.type === "confirm")) {
      if (!command) {
        const name = t.text.trim().slice(0, 120);
        await this.d.store.setBusinessName(msg.orgId, name);
        t.ctx = { ...t.ctx, name };
        await this.say(t, w.businessNameSaved(name));
      }
      const resume = t.state.resume;
      await this.setState(t, t.state.documentId, null);
      if (resume === "issue") await this.issue(t);
      else await this.preview(t);
      return;
    }
    // « Ajoute … » : avec l'IA, la phrase entière est comprise (section visée, condition, poste) ;
    // la commande figée ne sert qu'en mode dégradé.
    if (command && !(command.type === "add" && !this.d.reader.simulated)) {
      await this.command(t, command);
      return;
    }
    const decision = await this.decide(t);
    await this.dispatch(t, decision);
  }

  /** Décision du tour : IA avec le contexte (12 échanges, brouillon), sinon règles (mode dégradé). */
  private async decide(t: Turn): Promise<TurnDecision> {
    const draft = await this.currentDraft(t);
    const latestId = await this.d.documents.lastIssued(t.ctx.orgId);
    const latest = latestId ? await this.d.documents.get(t.ctx.orgId, latestId).catch(() => null) : null;
    const ctx = {
      ...this.readContext(t.ctx),
      draft: draft ? this.draftText(t, draft) : null,
      latest: latest ? `${latest.typeLabel} ${latest.number} — ${latest.client.name ?? ""} — ${formatMoney(latest.totalMinor, latest.currency)}` : null,
      history: await this.d.store.history(t.msg.identityId, t.msg.id),
      awaiting: t.state.awaiting === "missing" && draft ? this.missingText(t, draft) : t.state.awaiting,
    };
    if (this.d.reader.simulated) return decideSimple(t.text, ctx);
    try {
      return await this.ai(t, "intent", () => this.d.reader.decide(t.text, ctx));
    } catch (error) {
      // Dernière tentative : on ne laisse pas l'artisan sans réponse (mode dégradé de la v1).
      if (t.attempts >= 3) return { ...decideSimple(t.text, ctx), reply: null };
      throw error;
    }
  }

  private async dispatch(t: Turn, decision: TurnDecision): Promise<void> {
    const { w } = t;
    const d = { ...decision, reply: voiceOf(decision.reply) };
    switch (d.intent) {
      case "greeting":
        return this.say(t, d.reply ?? w.welcome);
      case "help":
        return this.say(t, d.reply ?? w.help, [{ id: BUTTONS.list, title: w.buttons.documents }, { id: BUTTONS.settings, title: w.buttons.settings }]);
      case "source":
        return this.readSource(t, { text: t.text }, d.startNewDocument);
      case "other":
        if (d.corrections.length) return this.applyCorrections(t, d.corrections);
        if (d.reply) return this.say(t, d.reply);
        if (this.d.reader.simulated) return this.say(t, w.outage);
        return this.say(t, w.notUnderstood);
      default:
        return this.intent(t, d.intent, d);
    }
  }

  private async intent(t: Turn, intent: Intent, d?: Partial<TurnDecision>): Promise<void> {
    const { w, ctx } = t;
    const org = ctx.orgId;
    switch (intent) {
      case "confirm":
        return this.confirm(t);
      case "finalize":
        return this.finalize(t);
      case "preview":
        return this.preview(t);
      case "settings":
        return this.sendPortal(t, "form:profile", "/app/profil", "settings");
      case "list_documents":
        return this.listDocuments(t);
      case "subscription":
        return this.sendPortal(t, "portal", "/app/abonnement", "subscription");
      case "show_latest":
        return this.showLatest(t);
      case "download_latest":
        return this.downloadLatest(t);
      case "quota": {
        const ent = await this.d.documents.entitlement(org);
        if (!ent) return this.say(t, w.nothingYet);
        return this.say(t, w.quota(ent.used, ent.quota, ent.remaining, ent.kind === "trial"));
      }
      case "stats": {
        const s = await this.d.store.stats(org);
        if (s.drafts + s.issued === 0) return this.say(t, w.nothingYet);
        return this.say(t, w.stats(s));
      }
      case "search": {
        const query = (d?.searchQuery ?? t.text).trim().slice(0, 80);
        const { items } = await this.d.documents.list(org, { search: query, limit: 5 });
        return this.say(t, w.search(items.map((i) => ({ number: i.number, client: i.clientName, title: i.title, total: formatMoney(i.totalMinor, ctx.currency) }))));
      }
      case "convert":
        return this.convert(t, d?.targetType ?? "invoice", null);
      case "duplicate":
        return this.duplicate(t);
      case "share":
        return this.share(t);
      case "new_document":
        await this.setState(t, null, null);
        return this.say(t, w.newDocument);
      case "delete_data":
        await this.d.store.requestData(org, t.msg.identityId, "deletion", "chat");
        return this.say(t, w.deletionRecorded);
      case "admin": {
        const link = (await this.d.adminLink?.(t.msg.identityId)) ?? null;
        return this.say(t, link ? w.adminLink(link.url, link.minutes) : w.adminDenied);
      }
      case "greeting":
        return this.say(t, w.welcome);
      case "help":
        return this.say(t, w.help);
      default:
        return this.say(t, w.notUnderstood);
    }
  }

  // ---------------------------------------------------------------- lecture

  private readContext(ctx: OrgContext): ReadContext {
    return { locale: ctx.locale, currencyCode: ctx.currency.code, currencySymbol: ctx.currency.symbol, units: ctx.units, trade: ctx.trade };
  }

  /**
   * Nouvelle source (P-30). Sans brouillon (ou nouveau document demandé) : un brouillon est créé.
   * Avec un brouillon actif : la source le complète (v1 : « un nouveau message complète ce brouillon »).
   */
  private async readSource(t: Turn, source: { text?: string; image?: { bytes: Buffer; mediaType: string } }, startNew: boolean) {
    const { w, ctx } = t;
    const started = Date.now();
    let cost: number | null = null;
    const reading = await this.ai<SaleReading>(t, "read", () => (source.image
      ? this.d.reader.readImage(source.image.bytes, source.image.mediaType, this.readContext(ctx))
      : this.d.reader.readText(source.text ?? "", this.readContext(ctx))), (c) => (cost = c));
    if (reading.sourceText) await this.d.store.setStatus(t.msg.id, "processing", { transcript: reading.sourceText });
    const guarded = guardReading(reading, reading.sourceText ?? source.text ?? null, ctx.currency.minorUnits);
    await this.d.store.recordReading(ctx.orgId, source.image ? "image" : t.msg.kind === "audio" ? "audio" : "text",
      guarded.lines, guarded.rejected + guarded.toConfirm, Date.now() - started, cost);

    const existing = startNew ? null : await this.currentDraft(t);
    if (guarded.lines === 0 && !existing) {
      // Rien de chiffrable (v1) : on demande, on ne crée pas de document vide.
      return this.say(t, w.question({ kind: "no_lines" }, noun(ctx.locale, guarded.type ?? "quote")));
    }
    let id: string;
    if (existing) {
      id = existing.id;
      await this.merge(t, existing, guarded.content);
      if (guarded.client && !existing.client.name) {
        await this.d.documents.setClient(ctx.orgId, id, guarded.client.name, { phone: guarded.client.phone, address: guarded.client.address });
      }
    } else {
      id = await this.d.documents.createDraftContent(ctx.orgId, guarded.type ?? "quote", guarded.content, "chat");
      if (guarded.client) await this.d.documents.setClient(ctx.orgId, id, guarded.client.name, { phone: guarded.client.phone, address: guarded.client.address });
    }
    t.documentId = id;
    await this.showReading(t, id);
  }

  /** Ajoute une lecture à un brouillon : lignes, sections, ajustements ; ne remplace aucun champ rempli. */
  private async merge(t: Turn, draft: DocumentView, content: DraftContent) {
    const org = t.ctx.orgId;
    for (const s of content.sections ?? []) {
      if (s.title) await this.d.documents.addSection(org, draft.id, s);
      else await this.d.documents.addLines(org, draft.id, s.lines);
    }
    for (const a of content.adjustments ?? []) await this.d.documents.addAdjustment(org, draft.id, a);
    const fields: DraftFields = {};
    const fill = <K extends keyof DraftFields>(k: K, current: unknown) => {
      if (content[k] !== undefined && content[k] !== null && (current === null || current === undefined)) fields[k] = content[k];
    };
    fill("title", draft.title);
    fill("site", draft.site);
    fill("delivery_text", draft.deliveryText);
    fill("warranty_text", draft.warrantyText);
    fill("assumptions", draft.assumptions);
    fill("validity_days", draft.validityDays);
    fill("deposit_bp", draft.depositBp);
    if (Object.keys(fields).length) await this.d.documents.updateDraft(org, draft.id, fields);
  }

  /** Lecture montrée (voix #3) puis la question suivante, ou l'offre du PDF. */
  private async showReading(t: Turn, id: string, lead?: string) {
    const doc = await this.d.documents.get(t.ctx.orgId, id);
    const next = this.nextMissing(doc, false);
    const text = t.w.reading(this.chatDraft(t, doc), next);
    await this.say(t, lead ? `${lead}\n\n${text}` : text, next ? [] : [{ id: BUTTONS.preview, title: t.w.buttons.preview }]);
    await this.setState(t, id, next ? "missing" : "pdf_offer");
  }

  /** Appel IA mesuré (coût, durée). Une panne passagère est relancée par la file. */
  private async ai<T>(t: Turn, task: string, call: () => Promise<AiCall<T>>, onCost?: (cost: number | null) => void): Promise<T> {
    const started = Date.now();
    try {
      const result = await call();
      if (!this.d.reader.simulated) {
        const cost = await this.d.store.recordAi(t.ctx.orgId, task, true, result.usage);
        onCost?.(cost);
      }
      return result.value;
    } catch (error) {
      if (!this.d.reader.simulated) {
        await this.d.store.recordAi(t.ctx.orgId, task, false, { model: "?", durationMs: Date.now() - started }).catch(() => undefined);
      }
      throw error;
    }
  }

  private async download(t: Turn): Promise<{ bytes: Buffer; mediaType: string }> {
    if (!t.msg.mediaRef) throw new PermanentJobError("média absent");
    const media = await t.channel.downloadMedia(t.msg.mediaRef);
    const ext = media.mediaType.includes("png") ? "png" : media.mediaType.includes("jpeg") || media.mediaType.includes("jpg") ? "jpg" : media.mediaType.includes("webm") ? "webm" : media.mediaType.includes("mpeg") ? "mp3" : "ogg";
    const key = `inbox/${t.msg.orgId}/${t.msg.id}.${ext}`;
    await this.d.files.put(key, media.bytes, media.mediaType);
    await this.d.store.setStatus(t.msg.id, "processing", { mediaKey: key });
    return media;
  }

  // ---------------------------------------------------------------- brouillon

  private async setState(t: Turn, documentId: string | null, awaiting: Awaiting, resume: string | null = null) {
    await this.d.store.setState(t.msg.identityId, documentId, awaiting, resume);
    t.state = { documentId, awaiting, resume };
  }

  private async currentDraft(t: Turn): Promise<DocumentView | null> {
    const id = t.state.documentId;
    if (!id) return null;
    try {
      const doc = await this.d.documents.get(t.ctx.orgId, id);
      return doc.status === "draft" ? doc : null;
    } catch {
      return null;
    }
  }

  /** Brouillon à corriger : celui en cours ; sinon révision du dernier document émis (un émis ne change plus). */
  private async editable(t: Turn): Promise<DocumentView | null> {
    const draft = await this.currentDraft(t);
    if (draft) return draft;
    const last = t.state.documentId ?? (await this.d.documents.lastIssued(t.ctx.orgId));
    if (!last) return null;
    const doc = await this.d.documents.get(t.ctx.orgId, last).catch(() => null);
    if (!doc || !["issued", "accepted", "refused", "no_response"].includes(doc.status)) return null;
    const revision = await this.d.documents.revise(t.ctx.orgId, doc.id);
    await this.setState(t, revision, null);
    await this.say(t, t.w.revised(doc.number ?? ""));
    return this.d.documents.get(t.ctx.orgId, revision);
  }

  /**
   * Ce qui manque, dans l'ordre de la v1 : une prestation, le client, les valeurs des lignes, les
   * ajustements, l'objet. Le client et l'objet sont demandés une fois ; « OK » passe outre (soft).
   */
  nextMissing(doc: DocumentView, hardOnly: boolean): Missing | null {
    if (!doc.lines.some((l) => l.kind !== "text")) return { kind: "no_lines" };
    if (!hardOnly && !doc.client.name) return { kind: "client" };
    for (const l of doc.lines) {
      if (l.kind === "priced" && l.quantity === null) return { kind: "quantity", label: l.label };
      if (l.kind === "priced" && l.unitPriceMinor === null) return { kind: "unit_price", label: l.label };
      if (l.kind === "flat" && l.flatAmountMinor === null) return { kind: "flat_amount", label: l.label };
    }
    for (const a of doc.adjustments) if (a.rateBp === null && a.valueMinor === null) return { kind: "adjustment", label: a.label };
    if (doc.blockers.includes("negative_total")) return { kind: "negative" };
    if (!hardOnly && !doc.title) return { kind: "subject" };
    return null;
  }

  private missingText(t: Turn, doc: DocumentView): string | null {
    const m = this.nextMissing(doc, false);
    return m ? t.w.question(m, noun(t.ctx.locale, doc.type)) : null;
  }

  chatLine(doc: DocumentView, l: DocumentView["lines"][number]): ChatLine {
    const money = (v: string) => formatMoney(v, doc.currency);
    return {
      n: l.position,
      label: l.label,
      description: l.description,
      kind: l.kind,
      qty: l.quantity ? formatQuantity(l.quantity, doc.currency.decimalSeparator) : null,
      unit: l.unit,
      price: l.unitPriceMinor !== null ? money(l.unitPriceMinor) : null,
      flat: l.flatAmountMinor !== null ? money(l.flatAmountMinor) : null,
      total: l.lineTotalMinor !== null ? money(l.lineTotalMinor) : null,
      toConfirm: l.toConfirm.length > 0,
    };
  }

  chatDraft(t: Turn, doc: DocumentView): ChatDraft {
    const money = (v: string) => formatMoney(v, doc.currency);
    const sep = doc.currency.decimalSeparator;
    const valuesComplete = !doc.blockers.some((b) => ["missing_quantity", "missing_price", "missing_adjustment", "no_lines", "negative_total"].includes(b));
    const details: ChatDraft["details"] = [];
    const L = t.ctx.locale.startsWith("en")
      ? { site: "Site", delivery: "Lead time", validity: "Valid for", warranty: "Warranty", conditions: "Terms", days: (n: number) => `${n} days` }
      : { site: "Chantier", delivery: "Délai", validity: "Validité", warranty: "Garantie", conditions: "Conditions", days: (n: number) => `${n} jours` };
    if (doc.site) details.push({ label: L.site, value: doc.site });
    if (doc.deliveryText) details.push({ label: L.delivery, value: doc.deliveryText });
    if (doc.validityDays) details.push({ label: L.validity, value: L.days(doc.validityDays) });
    if (doc.warrantyText) details.push({ label: L.warranty, value: doc.warrantyText });
    if (doc.applyTax && doc.taxRateBp > 0) details.push({ label: doc.taxLabel ?? "TVA", value: `${percentText(doc.taxRateBp, sep)} %` });
    const conditions = [doc.assumptions, ...doc.clauses.map((c) => c.body)].filter(Boolean).join(" ; ");
    if (conditions) details.push({ label: L.conditions, value: conditions });
    return {
      typeLabel: doc.typeLabel,
      noun: noun(t.ctx.locale, doc.type),
      title: doc.title,
      client: doc.client.name,
      sections: doc.sections.map((s) => ({
        n: s.position,
        title: s.title,
        subtotal: s.showSubtotal && s.lines.every((l) => l.kind === "text" || l.lineTotalMinor !== null) ? money(s.subtotalMinor) : null,
        lines: s.lines.map((l) => this.chatLine(doc, l)),
      })),
      adjustments: doc.adjustments.map((a) => ({
        n: a.position,
        label: a.label,
        percent: a.rateBp !== null ? `${a.sign < 0 ? "−" : ""}${percentText(a.rateBp, sep)} %` : null,
        amount: a.valueMinor !== null ? `${a.sign < 0 ? "−" : ""}${money(a.valueMinor)}` : null,
        missing: a.rateBp === null && a.valueMinor === null,
      })),
      total: valuesComplete ? money(doc.totalMinor) : null,
      deposit: doc.depositBp && doc.depositMinor ? { percent: `${percentText(doc.depositBp, sep)} %`, amount: money(doc.depositMinor) } : null,
      details,
    };
  }

  /** Le brouillon tel que l'IA le voit (positions affichées, pour viser la bonne ligne). */
  private draftText(t: Turn, doc: DocumentView): string {
    const d = this.chatDraft(t, doc);
    const lines = d.sections.flatMap((s) => [
      `Section ${s.n}${s.title ? ` « ${s.title} »` : " (sans titre)"} :`,
      ...s.lines.map((l) => `  ligne ${l.n} : ${l.label} | qté ${l.qty ?? "?"}${l.unit ? ` ${l.unit}` : ""} | prix ${l.price ?? (l.kind === "flat" ? `forfait ${l.flat ?? "?"}` : "?")}${l.description ? ` | ${l.description}` : ""}`),
    ]);
    const adj = d.adjustments.map((a) => `ajustement ${a.n} : ${a.label} = ${a.percent ?? a.amount ?? "?"}`);
    return [
      `${doc.typeLabel} (brouillon) ; objet : ${doc.title ?? "?"} ; client : ${doc.client.name ?? "?"}`,
      ...lines,
      ...adj,
      ...d.details.map((x) => `${x.label} : ${x.value}`),
      d.total ? `total : ${d.total}` : "total : incomplet",
    ].join("\n");
  }

  // ---------------------------------------------------------------- corrections

  /** Corrections en langage naturel (P-31) : chaque nombre doit figurer dans le message de l'artisan. */
  private async applyCorrections(t: Turn, corrections: Correction[]) {
    const { w, ctx } = t;
    const org = ctx.orgId;
    const c = checker(t.text, ctx.currency.minorUnits);
    const payments = corrections.filter((x) => x.target === "payment");
    const edits = corrections.filter((x) => x.target !== "payment");
    for (const p of payments) {
      if (p.target === "payment") await this.recordPayment(t, p.amountText, null, p.method);
    }
    if (!edits.length) {
      // Rien de compris à appliquer : on le dit, on ne laisse jamais un message sans réponse.
      if (!payments.length) await this.say(t, this.d.reader.simulated ? w.outage : w.notUnderstood);
      return;
    }
    let draft = await this.editable(t);
    if (!draft) return this.say(t, w.nothingToIssue);
    let changed: string | null = null;
    for (const x of edits) {
      const result = await this.applyOne(t, draft, x, c);
      if (result === false) return;
      if (typeof result === "string") changed = result;
      draft = await this.d.documents.get(org, draft.id);
    }
    t.documentId = draft.id;
    const next = this.nextMissing(draft, false);
    await this.say(t, w.corrected(changed, next, this.chatDraft(t, draft)), next ? [] : [{ id: BUTTONS.preview, title: w.buttons.preview }]);
    await this.setState(t, draft.id, next ? "missing" : "pdf_offer");
  }

  /** Une correction ; false : arrêt (message déjà envoyé) ; texte : la ligne modifiée à montrer. */
  private async applyOne(t: Turn, draft: DocumentView, x: Correction, c: Checker): Promise<boolean | string> {
    const { w } = t;
    const org = t.ctx.orgId;
    const notHeard = async (raw: string | null) => {
      await this.say(t, raw ? w.valueNotHeard(raw) : w.notUnderstood);
      return false;
    };
    const lineShown = async (n: number) => {
      const doc = await this.d.documents.get(org, draft.id);
      const l = doc.lines.find((y) => y.position === n);
      if (!l) return null;
      const v = this.chatLine(doc, l);
      return `${v.n}. ${v.label}${v.qty ? ` · ${v.qty}${v.unit ? ` ${v.unit}` : ""}` : ""}${v.price ? ` × ${v.price}` : ""}${v.total ? ` = ${v.total}` : ""}`;
    };
    switch (x.target) {
      case "line": {
        if (x.op !== "add" && !draft.lines.some((l) => l.position === x.line)) {
          await this.say(t, w.lineNotFound(x.line));
          return false;
        }
        if (x.op === "remove") {
          await this.d.documents.removeLine(org, draft.id, x.line);
          return true;
        }
        if (x.op === "move") {
          await this.d.documents.setContent(org, draft.id, { sections: moveLine(draft, x.line, x.section) });
          return true;
        }
        if (x.op === "add") {
          const line = guardLine(x.line, c);
          if (!line) return notHeard(null);
          await this.d.documents.addLines(org, draft.id, [{ ...line, source: "typed" }], x.section && draft.sections.some((s) => s.position === x.section) ? x.section : null);
          const doc = await this.d.documents.get(org, draft.id);
          return (await lineShown(doc.lines.at(-1)?.position ?? 0)) ?? true;
        }
        const patch: Partial<LineInput> = {};
        switch (x.field) {
          case "quantity": {
            const q = c.quantity(x.valueText);
            if (!q) return notHeard(x.valueText);
            patch.quantity = q;
            break;
          }
          case "unit_price": {
            const v = c.amount(x.valueText);
            if (v === null) return notHeard(x.valueText);
            patch.unitPriceMinor = v.toString();
            break;
          }
          case "flat_amount": {
            const v = c.amount(x.valueText);
            if (v === null) return notHeard(x.valueText);
            patch.flatAmountMinor = v.toString();
            break;
          }
          case "label":
            if (!x.valueText?.trim() || !heard(x.valueText, t.text)) return notHeard(x.valueText);
            patch.label = capitalizeInitial(x.valueText).slice(0, 300);
            break;
          case "description":
            if (x.valueText?.trim() && !heard(x.valueText, t.text)) return notHeard(x.valueText);
            patch.description = x.valueText?.trim().slice(0, 300) || null;
            break;
          case "unit":
            patch.unit = x.valueText?.trim().slice(0, 24) || null;
            break;
        }
        await this.d.documents.patchLine(org, draft.id, x.line, patch);
        return (await lineShown(x.line)) ?? true;
      }
      case "section": {
        if (x.op === "add") {
          const lines = x.lines.map((l) => guardLine(l, c)).filter((l): l is LineInput => l !== null);
          if (!lines.length) {
            // Section annoncée sans poste : elle prendra les lignes ajoutées ensuite.
            await this.say(t, w.question({ kind: "no_lines" }, noun(t.ctx.locale, draft.type)));
            return false;
          }
          await this.d.documents.addSection(org, draft.id, { title: x.title.trim().slice(0, 160), lines });
          return true;
        }
        if (!draft.sections.some((s) => s.position === x.section)) return notHeard(null);
        if (x.op === "remove") {
          await this.d.documents.removeSection(org, draft.id, x.section);
          return true;
        }
        if (x.field === "title") {
          if (x.valueText?.trim() && !heard(x.valueText, t.text)) return notHeard(x.valueText);
          await this.d.documents.patchSection(org, draft.id, x.section, { title: x.valueText?.trim() ? capitalizeInitial(x.valueText) : null });
        }
        else await this.d.documents.patchSection(org, draft.id, x.section, { showSubtotal: !/^(false|non|no|0)$/i.test(x.valueText ?? "true") });
        return true;
      }
      case "adjustment": {
        if (x.op === "add") {
          const a = guardAdjustment(x.adjustment, c);
          if (!a) return notHeard(null);
          await this.d.documents.addAdjustment(org, draft.id, { ...a, source: "typed" });
          return true;
        }
        const current = draft.adjustments.find((a) => a.position === x.adjustment);
        if (!current) return notHeard(null);
        if (x.op === "remove") {
          await this.d.documents.removeAdjustment(org, draft.id, x.adjustment);
          return true;
        }
        switch (x.field) {
          case "value": {
            // Le mode suit la façon de le dire : « 30 % » reste un pourcentage, « 160 000 » un montant.
            const percent = /%|pour\s*cent|percent/i.test(x.valueText ?? "") || (current.mode === "percent" && !/\d{4,}/.test((x.valueText ?? "").replace(/\s/g, "")));
            if (percent) {
              const bp = c.percent(x.valueText);
              if (bp === null) return notHeard(x.valueText);
              await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, { mode: "percent", rateBp: bp });
            } else {
              const v = c.amount(x.valueText);
              if (v === null || v <= 0n) return notHeard(x.valueText);
              await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, { mode: "amount", valueMinor: v.toString() });
            }
            return true;
          }
          case "label":
            if (!x.valueText?.trim() || !heard(x.valueText, t.text)) return notHeard(x.valueText);
            await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, { label: capitalizeInitial(x.valueText).slice(0, 160) });
            return true;
          case "sign":
            await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, { sign: /^(-|moins|remise|negative|-1)/i.test(x.valueText ?? "") ? -1 : 1 });
            return true;
          case "base":
            await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, { base: /tax|ttc|base/i.test(x.valueText ?? "") ? "taxable_base" : "items_total" });
            return true;
          case "mode":
            // Changer le mode sans nouvelle valeur la laisse à préciser : jamais de conversion (v1).
            await this.d.documents.patchAdjustment(org, draft.id, x.adjustment, /%|pour/i.test(x.valueText ?? "")
              ? { mode: "percent", rateBp: null } : { mode: "amount", valueMinor: null });
            return true;
        }
        return true;
      }
      case "document":
        return this.applyField(t, draft, x, c);
      default:
        return true;
    }
  }

  private async applyField(t: Turn, draft: DocumentView, x: Extract<Correction, { target: "document" }>, c: Checker): Promise<boolean> {
    const org = t.ctx.orgId;
    const v = x.valueText?.trim() || null;
    const notHeard = async () => {
      await this.say(t, v ? t.w.valueNotHeard(v) : t.w.notUnderstood);
      return false;
    };
    // Tout texte (nom, objet, lieu, condition) doit figurer dans le message : jamais un nom deviné.
    const textFields = ["client_name", "client_phone", "client_address", "subject", "summary", "site", "delivery_text", "warranty_text", "assumptions"];
    if (v && textFields.includes(x.field) && !heard(v, t.text)) return notHeard();
    if (x.op === "append") {
      const next = [draft.assumptions, v ? capitalizeInitial(v) : null].filter(Boolean).join("\n").slice(0, 1000);
      await this.d.documents.updateDraft(org, draft.id, { assumptions: next });
      return true;
    }
    switch (x.field) {
      case "client_name": {
        const name = v ? capitalizeInitial(v.replace(/^(pour|client|le client c'est)\s+/i, "")).slice(0, 160) : null;
        await this.d.documents.setClient(org, draft.id, name, { phone: draft.client.phone, address: draft.client.address });
        return true;
      }
      case "client_phone":
      case "client_address":
        if (!draft.client.name) return notHeard();
        await this.d.documents.setClient(org, draft.id, draft.client.name, x.field === "client_phone" ? { phone: v } : { address: v });
        return true;
      case "subject":
        await this.d.documents.updateDraft(org, draft.id, { title: v?.slice(0, 200) ?? null });
        return true;
      case "summary":
      case "site":
      case "delivery_text":
      case "warranty_text":
      case "assumptions":
        await this.d.documents.updateDraft(org, draft.id, { [x.field]: v } as DraftFields);
        return true;
      case "validity_days": {
        if (!v) return notHeard();
        const n = c.integer(v);
        if (n === null || n > 365) return notHeard();
        await this.d.documents.updateDraft(org, draft.id, { validity_days: n });
        return true;
      }
      case "deposit_percent": {
        if (!v) {
          await this.d.documents.updateDraft(org, draft.id, { deposit_bp: null });
          return true;
        }
        const bp = c.percent(v);
        if (bp === null || bp > 10000) return notHeard();
        await this.d.documents.updateDraft(org, draft.id, { deposit_bp: bp });
        return true;
      }
      case "tax":
        await this.d.documents.updateDraft(org, draft.id, { apply_tax: !/^(false|non|no|sans|0)$/i.test(v ?? "true") });
        return true;
      case "type":
        if (v && ["quote", "proforma", "invoice", "delivery_note"].includes(v)) await this.d.documents.updateDraft(org, draft.id, { type: v });
        return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- aperçu et émission

  /** « OK » : répond à ce que Firmo vient de proposer (v1). */
  private async confirm(t: Turn): Promise<void> {
    const draft = await this.currentDraft(t);
    if (!draft) return this.say(t, t.w.nothingToConfirm);
    if (t.state.awaiting === "issue_confirm") return this.issueIfExplicit(t);
    return this.preview(t);
  }

  /** Demande de PDF final : l'aperçu d'abord, l'émission seulement après « OK ». */
  private async finalize(t: Turn): Promise<void> {
    if (t.state.awaiting === "issue_confirm" && (await this.currentDraft(t))) return this.issueIfExplicit(t);
    return this.preview(t);
  }

  /**
   * L'émission consomme un document : elle exige un mot de confirmation explicite, quelle que soit
   * l'interprétation de l'IA (« on continue », « bon » ne suffisent pas).
   */
  private async issueIfExplicit(t: Turn): Promise<void> {
    if (!EXPLICIT_CONFIRMATION.test(plainText(t.text))) {
      const ent = await this.d.documents.entitlement(t.ctx.orgId);
      return this.say(t, t.w.previewFollowUp(ent?.remaining ?? null), [{ id: BUTTONS.issue, title: t.w.buttons.issue }]);
    }
    return this.issue(t);
  }

  /** Préalables communs : un brouillon, des valeurs complètes, le nom de l'entreprise. */
  private async ready(t: Turn, resume: "preview" | "issue"): Promise<DocumentView | null> {
    const draft = await this.currentDraft(t);
    if (!draft) {
      await this.say(t, t.w.nothingToIssue);
      return null;
    }
    const hard = this.nextMissing(draft, true);
    if (hard) {
      await this.say(t, t.w.question(hard, noun(t.ctx.locale, draft.type)));
      await this.setState(t, draft.id, "missing");
      return null;
    }
    if (!t.ctx.name) {
      // Seule question obligatoire au premier document (v1, voix #4).
      await this.say(t, t.w.askBusinessName(noun(t.ctx.locale, draft.type)));
      await this.setState(t, draft.id, "business_name", resume);
      return null;
    }
    return draft;
  }

  /** Aperçu filigrané, gratuit (P-37) ; « OK » ensuite émet le PDF final. */
  private async preview(t: Turn): Promise<void> {
    const draft = await this.ready(t, "preview");
    if (!draft) return;
    const n = noun(t.ctx.locale, draft.type);
    const out = await this.d.render.preview(draft);
    if (await this.d.store.flag("png_preview")) {
      const r = await t.channel.sendImage(t.msg.to, out.png, t.w.previewCaption(n));
      await this.logOut(t.channel, t.msg.identityId, "image", null, null, "image/png", r.externalId, draft.id);
    }
    const r = await t.channel.sendDocument(t.msg.to, out.pdf, `${n.word.replace(/\s+/g, "-")}-apercu.pdf`, t.w.previewCaption(n));
    await this.logOut(t.channel, t.msg.identityId, "document", null, null, "application/pdf", r.externalId, draft.id);
    const ent = await this.d.documents.entitlement(t.ctx.orgId);
    await this.say(t, t.w.previewFollowUp(ent?.remaining ?? null), [{ id: BUTTONS.issue, title: t.w.buttons.issue }]);
    t.documentId = draft.id;
    await this.setState(t, draft.id, "issue_confirm");
    await this.d.store.emit(t.ctx.orgId, "preview_sent", { doc_type: draft.type });
  }

  private async issue(t: Turn): Promise<void> {
    const { w, ctx } = t;
    const draft = await this.ready(t, "issue");
    if (!draft) return;
    try {
      const issued = await this.d.documents.issue(ctx.orgId, draft.id);
      await this.d.store.addDelivery(issued.id, t.msg.identityId);
      t.documentId = issued.id;
      await this.setState(t, issued.id, null);
      await this.say(t, w.issuing(noun(ctx.locale, issued.type)));
      // Avertissement à 80 % du quota (v1).
      const ent = await this.d.documents.entitlement(ctx.orgId);
      if (ent && ent.remaining > 0 && ent.used * 5 >= ent.quota * 4) await this.say(t, w.quotaWarning(ent.remaining));
    } catch (error) {
      if (error instanceof HttpError && /quota/.test(error.message)) {
        const { token } = await this.d.store.accessLink(ctx.orgId, "portal", "/app/abonnement");
        // Plus aucun droit (période et grâce passées) : abonnement terminé ; sinon, quota atteint.
        const ent = await this.d.documents.entitlement(ctx.orgId);
        await this.say(t, ent ? w.limit(this.portalUrl(token)) : w.expired(this.portalUrl(token)));
        return;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------- documents existants

  private async latestIssued(t: Turn): Promise<DocumentView | null> {
    const id = await this.d.documents.lastIssued(t.ctx.orgId);
    return id ? this.d.documents.get(t.ctx.orgId, id) : null;
  }

  private async showLatest(t: Turn) {
    const draft = await this.currentDraft(t);
    const doc = draft ?? (await this.latestIssued(t));
    if (!doc) return this.say(t, t.w.nothingYet);
    await this.say(t, t.w.latest(this.chatDraft(t, doc), doc.number, t.w.status[doc.status] ?? doc.status));
    if (draft) {
      const next = this.nextMissing(draft, false);
      if (next) await this.say(t, t.w.question(next, noun(t.ctx.locale, draft.type)));
    }
  }

  private async downloadLatest(t: Turn) {
    const doc = await this.latestIssued(t);
    if (!doc) return this.say(t, t.w.nothingYet);
    const files = await this.d.render.current(doc.id);
    if (!files) return this.say(t, t.w.issuing(noun(t.ctx.locale, doc.type)));
    const pdf = await this.d.render.file(files.pdfKey);
    const r = await t.channel.sendDocument(t.msg.to, pdf, `${doc.number}.pdf`, t.w.pdfCaption(doc.typeLabel, doc.number ?? ""));
    await this.logOut(t.channel, t.msg.identityId, "document", `${doc.number}.pdf`, files.pdfKey, "application/pdf", r.externalId, doc.id);
  }

  private async listDocuments(t: Turn) {
    const { items } = await this.d.documents.list(t.ctx.orgId, { limit: 5 });
    if (!items.length) return this.say(t, t.w.nothingYet);
    await this.say(t, t.w.search(items.map((i) => ({ number: i.number, client: i.clientName, title: i.title, total: formatMoney(i.totalMinor, t.ctx.currency) }))));
    await this.sendPortal(t, "portal", "/app/documents", "documents");
  }

  /** Conversion (P-11) : le brouillon change de type ; un document émis donne un nouveau brouillon lié. */
  private async convert(t: Turn, type: DocumentType, number: string | null) {
    const org = t.ctx.orgId;
    const draft = number ? null : await this.currentDraft(t);
    if (draft) {
      await this.d.documents.updateDraft(org, draft.id, { type });
      return this.showReading(t, draft.id);
    }
    const sourceId = number ? await this.d.documents.findByNumber(org, number) : await this.d.documents.lastIssued(org);
    if (!sourceId) return this.say(t, t.w.noQuote);
    const source = await this.d.documents.get(org, sourceId);
    if (source.type === type) return this.say(t, t.w.noQuote);
    const id = await this.d.documents.convert(org, sourceId, type);
    t.documentId = id;
    await this.showReading(t, id, t.w.converted(source.number ?? "", noun(t.ctx.locale, type)));
  }

  private async duplicate(t: Turn) {
    const org = t.ctx.orgId;
    const sourceId = (await this.d.documents.lastIssued(org)) ?? (await this.d.documents.latest(org));
    if (!sourceId) return this.say(t, t.w.nothingYet);
    const source = await this.d.documents.get(org, sourceId);
    const id = await this.d.documents.duplicate(org, sourceId);
    t.documentId = id;
    await this.showReading(t, id, t.w.duplicated(source.number ?? source.title ?? ""));
  }

  private async share(t: Turn) {
    const doc = await this.latestIssued(t);
    if (!doc) return this.say(t, t.w.nothingYet);
    await this.d.documents.share(t.ctx.orgId, doc.id);
    await this.d.documents.markShared(t.ctx.orgId, doc.id, t.msg.channel).catch(() => undefined);
    await this.say(t, t.w.sharePrompt(doc.number ?? "", this.d.render.shareLink(doc.id)));
  }

  private async recordPayment(t: Turn, amountText: string, number: string | null, method: string | null) {
    const { w, ctx } = t;
    const org = ctx.orgId;
    const invoice = number ? await this.d.documents.findByNumber(org, number) : await this.d.store.lastOpenInvoice(org);
    if (!invoice) return this.say(t, w.noInvoice);
    const amount = checker(t.text, ctx.currency.minorUnits).amount(amountText);
    if (amount === null || amount <= 0n) return this.say(t, w.valueNotHeard(amountText));
    await this.d.documents.recordPayment(org, invoice, amount.toString(), null, method);
    const doc = await this.d.documents.get(org, invoice);
    const balance = (BigInt(doc.totalMinor) - BigInt(doc.paidMinor)).toString();
    await this.say(t, w.paymentRecorded(formatMoney(amount, ctx.currency), doc.number ?? "", formatMoney(balance, ctx.currency), doc.status === "paid"));
  }

  // ---------------------------------------------------------------- commandes sans IA

  private async command(t: Turn, c: Command): Promise<void> {
    const { w, ctx } = t;
    const org = ctx.orgId;
    switch (c.type) {
      case "start":
        return this.say(t, w.welcome);
      case "help":
      case "edit_hint":
        return this.say(t, w.help, [{ id: BUTTONS.list, title: w.buttons.documents }, { id: BUTTONS.settings, title: w.buttons.settings }]);
      case "confirm":
        return this.confirm(t);
      case "finalize":
        return this.finalize(t);
      case "intent":
        return this.intent(t, c.intent);
      case "cancel": {
        const draft = await this.currentDraft(t);
        if (draft) await this.d.documents.cancel(org, draft.id);
        await this.setState(t, null, null);
        return this.say(t, w.newDocument);
      }
      case "list":
        return this.listDocuments(t);
      case "settings":
        return this.sendPortal(t, "form:profile", "/app/profil", "settings");
      case "invoice":
        return this.convert(t, "invoice", c.number);
      case "doc_type":
        return this.convert(t, c.docType, null);
      case "payment":
        return this.recordPayment(t, c.amount, c.number, c.method);
      case "receipt": {
        const payment = await this.d.store.lastPaymentWithoutReceipt(org);
        if (!payment) return this.say(t, w.noPayment);
        const receipt = await this.d.documents.issueReceipt(org, payment);
        const doc = await this.d.documents.get(org, receipt);
        await this.d.store.addDelivery(receipt, t.msg.identityId);
        t.documentId = receipt;
        return this.say(t, w.receiptIssued(doc.number ?? ""));
      }
      case "decision": {
        const quote = c.number ? await this.d.documents.findByNumber(org, c.number) : await this.d.store.lastQuote(org, ["issued", "no_response"]);
        if (!quote) return this.say(t, w.noQuote);
        await this.d.documents.decide(org, quote, c.accepted ? "accepted" : "refused");
        const doc = await this.d.documents.get(org, quote);
        return this.say(t, w.decision(doc.number ?? "", c.accepted));
      }
      case "revise": {
        const id = c.number ? await this.d.documents.findByNumber(org, c.number) : null;
        if (!id) return this.say(t, w.noQuote);
        const revision = await this.d.documents.revise(org, id);
        t.documentId = revision;
        return this.showReading(t, revision);
      }
      case "add": {
        const reading = await this.ai(t, "read", () => this.d.reader.readText(c.text, this.readContext(ctx)));
        const lines: ReadLine[] = reading.sections.flatMap((s) => s.lines);
        return this.applyCorrections(t, lines.map((line) => ({ target: "line", op: "add", section: null, line })));
      }
      case "set_price":
        return this.applyCorrections(t, [{ target: "line", op: "set", line: c.line, field: "unit_price", valueText: c.value }]);
      case "set_quantity":
        return this.applyCorrections(t, [{ target: "line", op: "set", line: c.line, field: "quantity", valueText: c.value }]);
      case "set_label":
        return this.applyCorrections(t, [{ target: "line", op: "set", line: c.line, field: "label", valueText: c.value }]);
      case "remove":
        return this.applyCorrections(t, [{ target: "line", op: "remove", line: c.line }]);
      case "client":
        return this.applyCorrections(t, [{ target: "document", op: "set", field: "client_name", valueText: c.name }]);
      case "title":
        return this.applyCorrections(t, [{ target: "document", op: "set", field: "subject", valueText: c.text }]);
      case "tax":
        return this.applyCorrections(t, [{ target: "document", op: "set", field: "tax", valueText: String(c.enabled) }]);
      case "discount": {
        const draft = await this.editable(t);
        if (!draft) return this.say(t, w.nothingToIssue);
        const existing = draft.adjustments.find((a) => a.sign === -1);
        if (c.value === null) {
          return this.applyCorrections(t, existing ? [{ target: "adjustment", op: "remove", adjustment: existing.position }] : []);
        }
        const percent = /%/.test(c.value);
        if (existing) {
          return this.applyCorrections(t, [{ target: "adjustment", op: "set", adjustment: existing.position, field: "value", valueText: c.value }]);
        }
        return this.applyCorrections(t, [{ target: "adjustment", op: "add", adjustment: {
          label: w.discountLabel, mode: percent ? "percent" : "amount", sign: -1, base: "items_total", valueText: c.value.replace(/%/, "").trim(),
        } }]);
      }
    }
  }

  // ---------------------------------------------------------------- liens et remise

  private web(): string {
    return this.d.webUrl.replace(/\/$/, "");
  }

  private portalUrl(token: string): string {
    return `${this.web()}/acces/${token}`;
  }

  private async sendPortal(t: Turn, purpose: string, target: string, kind: "settings" | "documents" | "subscription") {
    // WhatsApp vérifié + drapeau : formulaire natif ; sinon lien vers l'écran exact (v1 : lien signé).
    if (purpose.startsWith("form:") && t.channel.sendForm && (await this.d.store.flag("whatsapp_flows"))) {
      const sent = await t.channel.sendForm(t.msg.to, purpose.slice(5), t.w.buttons.settings, t.w.help);
      if (sent) return;
    }
    const { token, minutes } = await this.d.store.accessLink(t.ctx.orgId, purpose, target);
    await this.say(t, t.w.link(kind, this.portalUrl(token), minutes));
  }

  /**
   * Tâche `notify_subscription` (P-57), mise en file par la confirmation du paiement : abonnement
   * actif, recharge ajoutée ou paiement échoué. Un échec d'envoi est repris par la file.
   */
  async notifySubscription(job: Job): Promise<void> {
    const orgId = String(job.payload.org_id ?? "");
    const ok = job.payload.outcome === "succeeded";
    const ctx = await this.d.store.context(orgId);
    const w = chatWords(ctx.locale);
    // La période que ce paiement a ouverte ou rechargée (un renouvellement anticipé commence plus tard).
    const sub = job.payload.subscription_id ? await this.d.store.periodNotice(String(job.payload.subscription_id)) : null;
    const ent = sub ? null : await this.d.documents.entitlement(orgId);
    const quota = sub?.quota ?? ent?.quota ?? 0;
    const until = dayOf(sub?.periodEnd ?? ent?.periodEnd ?? null);
    const text = !ok
      ? w.subscriptionFailed
      : job.payload.kind === "top_up"
        ? w.topUpAdded(Number(job.payload.units ?? 0), Math.max(0, quota - (sub?.used ?? ent?.used ?? 0)))
        : w.subscriptionActive(quota, until);
    await this.tellOrg(orgId, text);
  }

  /** Tâche `subscription_notice` : conditions de fin (avant la fin, à la fin, fin de la grâce). */
  async periodNotice(job: Job): Promise<void> {
    const n = await this.d.store.periodNotice(String(job.payload.subscription_id ?? ""));
    if (!n?.send) return;
    const w = chatWords((await this.d.store.context(n.orgId)).locale);
    const stage = String(job.payload.stage);
    const text = stage === "ending"
      ? w.periodEnding(Number(job.payload.days ?? 1), dayOf(n.periodEnd))
      : stage === "ended"
        ? w.periodEnded(dayOf(n.graceEnd))
        : w.periodClosed;
    await this.tellOrg(n.orgId, text);
    await this.d.store.emit(n.orgId, "subscription_notice", { stage });
  }

  private async tellOrg(orgId: string, text: string): Promise<void> {
    for (const id of await this.d.store.identities(orgId)) {
      const channel = this.d.channels.get(id.channel);
      if (!channel) continue;
      const r = await channel.sendText(id.to, text);
      await this.logOut(channel, id.identityId, "text", text, null, null, r.externalId);
    }
  }

  /** Rendu prêt (voix #9) : le PDF, puis le lien à transférer. Rien de plus. */
  private async deliver(doc: DocumentView, files: RenderedFiles): Promise<void> {
    const pending = await this.d.store.pendingDeliveries(doc.id);
    if (!pending.length) return;
    const w = chatWords(doc.locale);
    const n = noun(doc.locale, doc.type);
    const [pdf, png] = await Promise.all([this.d.render.file(files.pdfKey), this.d.render.file(files.pngKey)]);
    const preview = await this.d.store.flag("png_preview");
    for (const p of pending) {
      const channel = this.d.channels.get(p.channel);
      if (!channel) continue;
      if (preview) {
        const r = await channel.sendImage(p.to, png, w.pdfCaption(doc.typeLabel, doc.number ?? ""));
        await this.logOut(channel, p.identityId, "image", null, files.pngKey, "image/png", r.externalId, doc.id);
      }
      const r = await channel.sendDocument(p.to, pdf, `${doc.number}.pdf`, w.delivered(n));
      await this.logOut(channel, p.identityId, "document", `${doc.number}.pdf`, files.pdfKey, "application/pdf", r.externalId, doc.id);
      const text = w.shareLink(this.d.render.shareLink(doc.id));
      const r2 = await channel.sendText(p.to, text);
      await this.logOut(channel, p.identityId, "text", text, null, null, r2.externalId, doc.id);
      await this.d.store.markDelivered(p.id);
      await this.d.documents.markShared(doc.orgId, doc.id, p.channel).catch(() => undefined);
    }
  }

  private async say(t: Turn, text: string, buttons?: Button[]): Promise<void> {
    const r = await t.channel.sendText(t.msg.to, text, buttons?.length ? buttons : undefined);
    await this.logOut(t.channel, t.msg.identityId, "text", text, null, null, r.externalId);
  }

  /** Journal des messages sortants (le simulateur les enregistre déjà lui-même). */
  private async logOut(channel: Channel, identityId: string, kind: "text" | "image" | "document", text: string | null, mediaKey: string | null, mediaType: string | null, externalId: string | null, documentId: string | null = null) {
    if (channel.code === "simulator") return;
    await this.d.store.recordOutbound(identityId, kind, text, mediaKey, mediaType, externalId, documentId);
  }
}

/** Contenu d'un brouillon avec une ligne déplacée vers une autre section (positions affichées). */
function moveLine(doc: DocumentView, line: number, section: number): NonNullable<DraftContent["sections"]> {
  const moving = doc.lines.find((l) => l.position === line);
  return doc.sections.map((s) => {
    const lines = s.lines.filter((l) => l.position !== line);
    if (s.position === section && moving) lines.push(moving);
    return {
      title: s.title,
      showSubtotal: s.showSubtotal,
      lines: lines.map((l) => ({
        label: l.label, description: l.description, kind: l.kind, quantity: l.quantity, unit: l.unit,
        unitPriceMinor: l.unitPriceMinor, flatAmountMinor: l.flatAmountMinor, source: "typed" as const,
      })),
    };
  }).filter((s) => s.lines.length > 0);
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ChannelError) return error.retryable;
  if (error instanceof HttpError) return error.status >= 500;
  if (error instanceof PermanentJobError) return false;
  const status = (error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status;
  if (typeof status === "number") return status >= 500 || status === 429;
  // Erreurs réseau (fetch) et pannes de l'IA sans statut : retentées.
  return true;
}

/**
 * Réponse libre de l'IA ramenée à la voix de Firmo (v1) : pas de point d'exclamation, pas d'emoji,
 * deux phrases au plus. Vide après nettoyage : null (le message prévu par Firmo est utilisé).
 */
export function voiceOf(reply: string | null): string | null {
  if (!reply) return null;
  const clean = reply
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, "")
    .replace(/\s*!+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  // Fin de phrase : « . » ou « ? » suivi d'une majuscule, sauf après une civilité (« M. Kodjo »).
  const sentences = clean.split(/(?<=[.?])(?<!\b(?:M|Mme|Mlle|Mr|Dr|St|Ste|cf|ex)\.)\s+(?=[A-ZÀ-Ý])/).map((s) => s.trim()).filter(Boolean);
  const short = sentences.slice(0, 2).join(" ").trim();
  return short || null;
}

/** Mots qui valent confirmation d'émission (bouton « PDF final » compris). */
const EXPLICIT_CONFIRMATION = /(^|\s)(oui|ok|okay|yes|valide|valider|je valide|vas-y|vas y|go|c'est bon|cest bon|c'est juste|parfait|d'accord|daccord|confirme|confirmer|emets|emettre|emet|finalise|finaliser|pdf final|envoie|envoie-le|fais-le|cmd:issue)(\s|$)/;

function plainText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’`]/g, "'").replace(/[.,;:!?]/g, " ").replace(/\s+/g, " ").trim();
}

/** Jour d'une date pour le chat : 28.11.2026 (date UTC de la base). */
function dayOf(value: Date | string | null): string {
  if (!value) return "";
  const iso = typeof value === "string" ? value : value.toISOString();
  return iso.slice(0, 10).split("-").reverse().join(".");
}
