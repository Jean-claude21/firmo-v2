import { amountFromUser, guardLines } from "../ai/guard.js";
import type { AiCall, AiReader, EditOp, ReadContext, ReadLine, SaleReading } from "../ai/types.js";
import { BUTTONS, type Command, parseCommand } from "./commands.js";
import type { ConversationState, ConversationStore, OrgContext, StoredMessage } from "./store.js";
import { ChannelError, type Button, type Channel } from "../channels/types.js";
import { formatMoney, formatQuantity, parseQuantity } from "../documents/money.js";
import type { DocumentStore, DocumentView } from "../documents/store.js";
import { HttpError } from "../lib/errors.js";
import type { ObjectStore } from "../lib/storage.js";
import type { RenderedFiles, RenderService } from "../render/service.js";
import { chatWords, type ChatWords, type DraftView } from "../voix/chat.js";
import { PermanentJobError, type Job } from "../worker/worker.js";

// Moteur de conversation (CH-1, CH-3, DOC-1, DOC-2) : un message entrant → au plus un geste sur
// les documents → des réponses courtes. Les règles (montants, numéros, quota) restent en SQL.

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
}

interface Turn {
  msg: StoredMessage;
  ctx: OrgContext;
  w: ChatWords;
  channel: Channel;
  state: ConversationState;
  documentId: string | null;
}

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
    const turn: Turn = { msg, ctx, w: chatWords(ctx.locale), channel, state: await this.d.store.state(msg.identityId), documentId: null };
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
    if (msg.firstMessage && !/^\/start/.test(msg.text ?? "")) {
      await this.say(t, w.welcome(null));
    }
    if (msg.kind === "form" && msg.form) {
      await this.d.applyForm?.(msg.orgId, msg.form.name, msg.form.values);
      await this.say(t, w.updated);
      return;
    }
    if (msg.kind === "image") {
      await this.readSale(t, { image: await this.download(t) });
      return;
    }
    let text = msg.text?.trim() ?? "";
    if (msg.kind === "audio") {
      const audio = await this.download(t);
      if (this.d.reader.simulated) {
        await this.say(t, w.readingUnavailable);
        return;
      }
      const heard = await this.ai(t, "transcribe", () => this.d.reader.transcribe(audio.bytes, audio.mediaType, t.ctx.locale));
      if (!heard) {
        await this.say(t, w.transcribeFailed);
        return;
      }
      text = heard;
      await this.d.store.setStatus(msg.id, "processing", { transcript: heard });
    }
    if (!text) {
      await this.say(t, w.notUnderstood);
      return;
    }

    if (t.state.awaiting === "business_name") {
      const command = parseCommand(text);
      if (!command || command.type === "issue") {
        if (command?.type !== "issue") {
          await this.d.store.setBusinessName(msg.orgId, text);
          await this.say(t, w.businessNameSaved(text.trim()));
        }
        await this.d.store.setState(msg.identityId, t.state.documentId);
        t.state = { ...t.state, awaiting: null };
        if (t.state.resume === "issue" || command?.type === "issue") await this.issue(t);
        return;
      }
    }

    const command = parseCommand(text);
    if (command) {
      await this.command(t, command);
      return;
    }
    const draft = await this.currentDraft(t);
    if (draft && !this.d.reader.simulated) {
      const summary = this.draftView(draft, t.ctx, w);
      const meaning = await this.ai(t, "intent", () => this.d.reader.interpret(text, w.draft(summary), this.readContext(t.ctx)));
      switch (meaning.action) {
        case "edit":
          await this.applyOps(t, draft, meaning.ops, text);
          return;
        case "issue":
          await this.issue(t);
          return;
        case "cancel":
          await this.command(t, { type: "cancel" });
          return;
        case "help":
          await this.say(t, w.help);
          return;
        case "list":
          await this.command(t, { type: "list" });
          return;
        case "settings":
          await this.command(t, { type: "settings" });
          return;
        case "other":
          await this.say(t, w.notUnderstood);
          return;
        case "new_sale":
          break;
      }
    }
    await this.readSale(t, { text });
  }

  // ---------------------------------------------------------------- lecture

  private readContext(ctx: OrgContext): ReadContext {
    return { locale: ctx.locale, currencyCode: ctx.currency.code, currencySymbol: ctx.currency.symbol, units: ctx.units, trade: ctx.trade };
  }

  private async readSale(t: Turn, source: { text?: string; image?: { bytes: Buffer; mediaType: string } }) {
    const { w, ctx } = t;
    if (source.image && this.d.reader.simulated) {
      await this.say(t, w.readingUnavailable);
      return;
    }
    const started = Date.now();
    let cost: number | null = null;
    const reading = await this.ai<SaleReading>(t, "read", async () => {
      const call = source.image
        ? await this.d.reader.readImage(source.image.bytes, source.image.mediaType, this.readContext(ctx))
        : await this.d.reader.readText(source.text ?? "", this.readContext(ctx));
      return call;
    }, (c) => (cost = c));
    const guarded = guardLines(reading.lines, source.image ? null : (source.text ?? ""), ctx.currency.minorUnits, new Set(ctx.units.map((u) => u.code)));
    await this.d.store.recordReading(ctx.orgId, source.image ? "image" : t.msg.kind === "audio" ? "audio" : "text", guarded.lines.length,
      guarded.lines.reduce((n, l) => n + (l.toConfirm?.length ?? 0) + (l.unitPriceMinor === null ? 1 : 0) + (l.quantity === null ? 1 : 0), 0),
      Date.now() - started, cost);
    if (guarded.lines.length === 0) {
      await this.say(t, w.readEmpty);
      return;
    }
    const type = reading.documentType ?? "quote";
    const id = await this.d.documents.createDraft(ctx.orgId, type, guarded.lines, "chat", reading.title?.slice(0, 200) ?? null);
    if (reading.clientName) await this.d.documents.setClient(ctx.orgId, id, reading.clientName.slice(0, 160));
    await this.d.store.setState(t.msg.identityId, id);
    t.documentId = id;
    await this.showDraft(t, id);
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

  /** Brouillon à modifier : celui en cours ; sinon révision du dernier document émis. */
  private async editable(t: Turn): Promise<DocumentView | null> {
    const draft = await this.currentDraft(t);
    if (draft) return draft;
    const last = t.state.documentId ?? (await this.d.documents.lastIssued(t.ctx.orgId));
    if (!last) return null;
    const doc = await this.d.documents.get(t.ctx.orgId, last).catch(() => null);
    if (!doc || !["issued", "accepted", "refused"].includes(doc.status)) return null;
    const revision = await this.d.documents.revise(t.ctx.orgId, doc.id);
    await this.d.store.setState(t.msg.identityId, revision);
    await this.say(t, t.w.revised(doc.number ?? ""));
    return this.d.documents.get(t.ctx.orgId, revision);
  }

  draftView(doc: DocumentView, ctx: OrgContext, w: ChatWords): DraftView {
    const money = (v: string) => formatMoney(v, doc.currency);
    return {
      typeLabel: doc.typeLabel,
      lines: doc.lines.map((l) => ({
        n: l.position,
        label: l.label,
        qty: l.quantity ? formatQuantity(l.quantity, doc.currency.decimalSeparator) : null,
        unit: l.unitLabel,
        price: l.unitPriceMinor !== null ? money(l.unitPriceMinor) : null,
        total: l.lineTotalMinor !== null ? money(l.lineTotalMinor) : null,
        toConfirm: l.toConfirm,
      })),
      total: money(doc.totalMinor),
      complete: doc.blockers.filter((b) => b !== "missing_business_name").length === 0,
      client: doc.client.name,
      title: doc.title,
      discount: BigInt(doc.discountTotalMinor) > 0n ? `− ${money(doc.discountTotalMinor)}` : null,
      tax: BigInt(doc.taxMinor) > 0n ? `${doc.taxLabel ?? ""} ${money(doc.taxMinor)}`.trim() : null,
      simulated: this.d.reader.simulated,
    };
    void ctx;
    void w;
  }

  private async showDraft(t: Turn, id: string) {
    const doc = await this.d.documents.get(t.ctx.orgId, id);
    const view = this.draftView(doc, t.ctx, t.w);
    const b = t.w.buttons;
    const buttons: Button[] = view.complete
      ? [{ id: BUTTONS.issue, title: b.issue }, { id: BUTTONS.edit, title: b.edit }, { id: BUTTONS.cancel, title: b.cancel }]
      : [{ id: BUTTONS.edit, title: b.edit }, { id: BUTTONS.cancel, title: b.cancel }];
    await this.say(t, t.w.draft(view), buttons);
  }

  private amount(t: Turn, raw: string): bigint | null {
    return amountFromUser(raw, t.ctx.currency.minorUnits);
  }

  /** Remise : « 10% » → points de base ; « 5000 » → montant. Valeur illisible : null. */
  private discount(t: Turn, raw: string): Record<string, unknown> | null {
    const pct = /^(\d+(?:[.,]\d{1,2})?)\s*%$/.exec(raw.trim());
    if (pct) {
      const bp = Math.round(Number(pct[1]!.replace(",", ".")) * 100);
      return bp >= 1 && bp <= 10000 ? { discount_bp: bp } : null;
    }
    const minor = this.amount(t, raw);
    return minor !== null && minor > 0n ? { discount_minor: minor.toString() } : null;
  }

  private async applyOps(t: Turn, draft: DocumentView, ops: EditOp[], source: string) {
    const org = t.ctx.orgId;
    const minorUnits = t.ctx.currency.minorUnits;
    const units = new Set(t.ctx.units.map((u) => u.code));
    for (const op of ops) {
      const lineExists = (n: number) => draft.lines.some((l) => l.position === n);
      switch (op.op) {
        case "set_price": {
          if (!lineExists(op.line)) return this.say(t, t.w.lineNotFound(op.line));
          const v = this.amount(t, op.valueText);
          // Garde : la valeur doit venir du message de l'artisan.
          if (v === null || guardLines([{ label: "x", quantityText: null, unit: null, unitPriceText: op.valueText, lineTotalText: null }], source, minorUnits, units).lines[0]?.unitPriceMinor === null) {
            return this.say(t, t.w.invalidValue(op.valueText));
          }
          await this.d.documents.patchLine(org, draft.id, op.line, { unitPriceMinor: v.toString() });
          break;
        }
        case "set_quantity": {
          if (!lineExists(op.line)) return this.say(t, t.w.lineNotFound(op.line));
          const q = parseQuantity(op.valueText.replace(/[^\d.,]/g, ""));
          if (!q || !source.includes(op.valueText.trim())) return this.say(t, t.w.invalidValue(op.valueText));
          await this.d.documents.patchLine(org, draft.id, op.line, { quantity: q });
          break;
        }
        case "set_label":
          if (!lineExists(op.line)) return this.say(t, t.w.lineNotFound(op.line));
          await this.d.documents.patchLine(org, draft.id, op.line, { label: op.text.slice(0, 300) });
          break;
        case "set_unit":
          if (!lineExists(op.line)) return this.say(t, t.w.lineNotFound(op.line));
          await this.d.documents.patchLine(org, draft.id, op.line, { unit: op.unit && units.has(op.unit) ? op.unit : null });
          break;
        case "remove":
          if (!lineExists(op.line)) return this.say(t, t.w.lineNotFound(op.line));
          await this.d.documents.removeLine(org, draft.id, op.line);
          break;
        case "add": {
          const guarded = guardLines(op.lines as ReadLine[], source, minorUnits, units);
          if (guarded.lines.length) await this.d.documents.addLines(org, draft.id, guarded.lines);
          break;
        }
        case "client":
          await this.d.documents.setClient(org, draft.id, op.name ? op.name.slice(0, 160) : null);
          break;
        case "title":
          await this.d.documents.updateDraft(org, draft.id, { title: op.text });
          break;
        case "discount": {
          if (op.valueText === null) {
            await this.d.documents.updateDraft(org, draft.id, { discount_bp: null, discount_minor: null });
            break;
          }
          const patch = this.discount(t, op.valueText);
          if (!patch) return this.say(t, t.w.invalidValue(op.valueText));
          await this.d.documents.updateDraft(org, draft.id, patch);
          break;
        }
        case "tax":
          await this.d.documents.updateDraft(org, draft.id, { apply_tax: op.enabled });
          break;
      }
    }
    t.documentId = draft.id;
    await this.showDraft(t, draft.id);
  }

  // ---------------------------------------------------------------- commandes

  private async command(t: Turn, c: Command): Promise<void> {
    const { w, ctx } = t;
    const org = ctx.orgId;
    switch (c.type) {
      case "start":
        await this.say(t, w.welcome(t.msg.firstMessage ? null : ctx.name));
        return;
      case "help":
        await this.say(t, w.help, [{ id: BUTTONS.list, title: w.buttons.documents }, { id: BUTTONS.settings, title: w.buttons.settings }]);
        return;
      case "edit_hint":
        await this.say(t, w.editHint);
        return;
      case "issue":
        await this.issue(t);
        return;
      case "cancel": {
        const draft = await this.currentDraft(t);
        if (!draft) return void (await this.say(t, w.nothingToCancel));
        await this.d.documents.cancel(org, draft.id);
        await this.d.store.setState(t.msg.identityId, null);
        await this.say(t, w.cancelled);
        return;
      }
      case "list": {
        const { items } = await this.d.documents.list(org, { limit: 5 });
        if (!items.length) return void (await this.say(t, w.listEmpty));
        await this.say(t, w.list(items.map((i) => ({
          number: i.number,
          type: i.typeLabel,
          client: i.clientName,
          total: formatMoney(i.totalMinor, ctx.currency),
          status: w.status[i.status] ?? i.status,
        }))));
        return;
      }
      case "settings":
        await this.sendPortal(t, "form:profile", "/app/profil");
        return;
      case "invoice": {
        const draft = c.number ? null : await this.currentDraft(t);
        if (draft) {
          await this.d.documents.updateDraft(org, draft.id, { type: "invoice" });
          await this.showDraft(t, draft.id);
          return;
        }
        const quote = c.number ? await this.d.documents.findByNumber(org, c.number) : await this.d.store.lastQuote(org, ["accepted", "issued"]);
        if (!quote) return void (await this.say(t, w.nothingToConvert));
        const source = await this.d.documents.get(org, quote);
        const invoice = await this.d.documents.convert(org, quote);
        await this.d.store.setState(t.msg.identityId, invoice);
        t.documentId = invoice;
        await this.say(t, w.converted(source.number ?? ""));
        await this.showDraft(t, invoice);
        return;
      }
      case "doc_type": {
        const draft = await this.currentDraft(t);
        if (!draft) return void (await this.say(t, w.nothingToIssue));
        await this.d.documents.updateDraft(org, draft.id, { type: c.docType });
        await this.showDraft(t, draft.id);
        return;
      }
      case "payment": {
        const invoice = c.number ? await this.d.documents.findByNumber(org, c.number) : await this.d.store.lastOpenInvoice(org);
        if (!invoice) return void (await this.say(t, w.noInvoice));
        const amount = this.amount(t, c.amount);
        if (amount === null || amount <= 0n) return void (await this.say(t, w.invalidValue(c.amount)));
        await this.d.documents.recordPayment(org, invoice, amount.toString(), null, c.method);
        const doc = await this.d.documents.get(org, invoice);
        const balance = (BigInt(doc.totalMinor) - BigInt(doc.paidMinor)).toString();
        await this.say(t, w.paymentRecorded(formatMoney(amount, ctx.currency), doc.number ?? "", formatMoney(balance, ctx.currency), doc.status === "paid"));
        return;
      }
      case "receipt": {
        const payment = await this.d.store.lastPaymentWithoutReceipt(org);
        if (!payment) return void (await this.say(t, w.noPayment));
        const receipt = await this.d.documents.issueReceipt(org, payment);
        const doc = await this.d.documents.get(org, receipt);
        await this.d.store.addDelivery(receipt, t.msg.identityId);
        t.documentId = receipt;
        await this.say(t, w.receiptIssued(doc.number ?? ""));
        return;
      }
      case "decision": {
        const quote = c.number ? await this.d.documents.findByNumber(org, c.number) : await this.d.store.lastQuote(org, ["issued"]);
        if (!quote) return void (await this.say(t, w.noQuote));
        await this.d.documents.decide(org, quote, c.accepted ? "accepted" : "refused");
        const doc = await this.d.documents.get(org, quote);
        await this.say(t, w.decision(doc.number ?? "", c.accepted));
        return;
      }
      case "revise": {
        const id = c.number ? await this.d.documents.findByNumber(org, c.number) : null;
        if (!id) return void (await this.say(t, w.noQuote));
        const revision = await this.d.documents.revise(org, id);
        await this.d.store.setState(t.msg.identityId, revision);
        await this.showDraft(t, revision);
        return;
      }
      case "template": {
        await this.d.store.setTemplate(org, c.template);
        const draft = await this.currentDraft(t);
        if (draft) await this.d.documents.updateDraft(org, draft.id, { template: c.template });
        await this.say(t, w.updated);
        return;
      }
      default: {
        // Corrections de lignes et réglages du brouillon : mêmes opérations que l'IA.
        const draft = await this.editable(t);
        if (!draft) return void (await this.say(t, w.nothingToIssue));
        const text = t.msg.text ?? "";
        const op: EditOp | null =
          c.type === "set_price" ? { op: "set_price", line: c.line, valueText: c.value }
          : c.type === "set_quantity" ? { op: "set_quantity", line: c.line, valueText: c.value }
          : c.type === "set_label" ? { op: "set_label", line: c.line, text: c.value }
          : c.type === "remove" ? { op: "remove", line: c.line }
          : c.type === "client" ? { op: "client", name: c.name }
          : c.type === "title" ? { op: "title", text: c.text }
          : c.type === "discount" ? { op: "discount", valueText: c.value }
          : c.type === "tax" ? { op: "tax", enabled: c.enabled }
          : null;
        if (c.type === "add") {
          const reading = await this.ai(t, "read", () => this.d.reader.readText(c.text, this.readContext(ctx)));
          await this.applyOps(t, draft, [{ op: "add", lines: reading.lines }], text);
          return;
        }
        if (op) await this.applyOps(t, draft, [op], text);
      }
    }
  }

  // ---------------------------------------------------------------- émission et remise

  private async issue(t: Turn): Promise<void> {
    const { w, ctx } = t;
    const draft = await this.currentDraft(t);
    if (!draft) return void (await this.say(t, w.nothingToIssue));
    if (draft.blockers.includes("missing_business_name")) {
      await this.d.store.setState(t.msg.identityId, draft.id, "business_name", "issue");
      await this.say(t, w.askBusinessName);
      return;
    }
    if (draft.blockers.length) {
      await this.say(t, w.missing(draft.blockers.map((b) => w.missingItem[b] ?? b)));
      return;
    }
    try {
      const issued = await this.d.documents.issue(ctx.orgId, draft.id);
      await this.d.store.addDelivery(issued.id, t.msg.identityId);
      await this.d.store.setState(t.msg.identityId, issued.id);
      t.documentId = issued.id;
      await this.say(t, w.issued(issued.typeLabel, issued.number ?? ""));
      const ent = await this.d.documents.entitlement(ctx.orgId);
      if (ent && ent.remaining > 0 && ent.remaining * 5 <= ent.quota) await this.say(t, w.quotaWarning(ent.remaining));
    } catch (error) {
      if (error instanceof HttpError && /quota/.test(error.message)) {
        const { token } = await this.d.store.accessLink(ctx.orgId, "portal", "/app/abonnement");
        await this.say(t, w.quotaExhausted(this.portalUrl(token)));
        return;
      }
      throw error;
    }
  }

  private portalUrl(token: string): string {
    return `${this.d.webUrl.replace(/\/$/, "")}/acces/${token}`;
  }

  private async sendPortal(t: Turn, purpose: string, target: string) {
    // WhatsApp vérifié + drapeau : formulaire natif ; sinon lien vers le formulaire web.
    if (purpose.startsWith("form:") && t.channel.sendForm && (await this.d.store.flag("whatsapp_flows"))) {
      const sent = await t.channel.sendForm(t.msg.to, purpose.slice(5), t.w.buttons.settings, t.w.editHint);
      if (sent) return;
    }
    const { token, minutes } = await this.d.store.accessLink(t.ctx.orgId, purpose, target);
    await this.say(t, t.w.portalLink(this.portalUrl(token), minutes));
  }

  /** Tâche `notify_subscription` : l'artisan apprend dans son chat que son abonnement est actif. */
  async notifySubscription(job: Job): Promise<void> {
    const orgId = String(job.payload.org_id ?? "");
    const ok = job.payload.outcome === "succeeded";
    const ctx = await this.d.store.context(orgId);
    const w = chatWords(ctx.locale);
    const ent = await this.d.documents.entitlement(orgId);
    const until = ent?.periodEnd ? ent.periodEnd.slice(0, 10).split("-").reverse().join("/") : "";
    for (const id of await this.d.store.identities(orgId)) {
      const channel = this.d.channels.get(id.channel);
      if (!channel) continue;
      const text = ok ? w.subscriptionActive(ent?.quota ?? 0, until) : w.subscriptionFailed;
      const r = await channel.sendText(id.to, text);
      await this.logOut(channel, id.identityId, "text", text, null, null, r.externalId);
    }
  }

  /** Rendu prêt : aperçu, PDF et lien envoyés à chaque identité qui attendait ce document. */
  private async deliver(doc: DocumentView, files: RenderedFiles): Promise<void> {
    const pending = await this.d.store.pendingDeliveries(doc.id);
    if (!pending.length) return;
    const w = chatWords(doc.locale);
    const [pdf, png] = await Promise.all([this.d.render.file(files.pdfKey), this.d.render.file(files.pngKey)]);
    const preview = await this.d.store.flag("png_preview");
    for (const p of pending) {
      const channel = this.d.channels.get(p.channel);
      if (!channel) continue;
      const total = formatMoney(doc.totalMinor, doc.currency);
      if (preview) {
        const r = await channel.sendImage(p.to, png, w.previewCaption(doc.typeLabel, doc.number ?? "", total));
        await this.logOut(channel, p.identityId, "image", null, files.pngKey, "image/png", r.externalId, doc.id);
      }
      const r = await channel.sendDocument(p.to, pdf, `${doc.number}.pdf`, w.pdfCaption(doc.typeLabel, doc.number ?? ""));
      await this.logOut(channel, p.identityId, "document", `${doc.number}.pdf`, files.pdfKey, "application/pdf", r.externalId, doc.id);
      const text = w.delivered(doc.typeLabel, doc.number ?? "", this.d.render.shareLink(doc.id));
      const r2 = await channel.sendText(p.to, text);
      await this.logOut(channel, p.identityId, "text", text, null, null, r2.externalId, doc.id);
      await this.d.store.markDelivered(p.id);
      await this.d.documents.markShared(doc.orgId, doc.id, p.channel).catch(() => undefined);
    }
  }

  private async say(t: Turn, text: string, buttons?: Button[]): Promise<void> {
    const r = await t.channel.sendText(t.msg.to, text, buttons);
    await this.logOut(t.channel, t.msg.identityId, "text", text, null, null, r.externalId);
  }

  /** Journal des messages sortants (le simulateur les enregistre déjà lui-même). */
  private async logOut(channel: Channel, identityId: string, kind: "text" | "image" | "document", text: string | null, mediaKey: string | null, mediaType: string | null, externalId: string | null, documentId: string | null = null) {
    if (channel.code === "simulator") return;
    await this.d.store.recordOutbound(identityId, kind, text, mediaKey, mediaType, externalId, documentId);
  }
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
