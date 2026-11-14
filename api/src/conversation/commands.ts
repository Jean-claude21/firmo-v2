// Commandes reconnues sans IA (rapides, gratuites, prévisibles), en français et en anglais.
// Les valeurs restent du texte brut : l'engine les convertit (unités mineures de la devise).

export type Command =
  | { type: "start" }
  | { type: "help" }
  | { type: "confirm" }
  | { type: "finalize" }
  | { type: "intent"; intent: "new_document" | "subscription" | "admin" | "quota" | "preview" | "stats" }
  | { type: "cancel" }
  | { type: "edit_hint" }
  | { type: "list" }
  | { type: "settings" }
  | { type: "invoice"; number: string | null }
  | { type: "doc_type"; docType: "quote" | "proforma" | "delivery_note" }
  | { type: "payment"; amount: string; number: string | null; method: string | null }
  | { type: "receipt" }
  | { type: "decision"; accepted: boolean; number: string | null }
  | { type: "set_price"; line: number; value: string }
  | { type: "set_quantity"; line: number; value: string }
  | { type: "set_label"; line: number; value: string }
  | { type: "remove"; line: number }
  | { type: "add"; text: string }
  | { type: "client"; name: string | null }
  | { type: "title"; text: string | null }
  | { type: "discount"; value: string | null }
  | { type: "tax"; enabled: boolean }
  | { type: "revise"; number: string | null };

// Numéro de document : format configurable ou manuel (DEV-2026-001, D/00002, FAC-MAIRIE-7, DEV-2026-001/R2).
const NUMBER = /(?<![A-Za-z0-9])([A-Za-z]{1,12}[-_\/.][A-Za-z0-9_.\/-]*[0-9][A-Za-z0-9]*(?:\/R[0-9]+)?)(?![A-Za-z0-9])/;

function norm(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ");
}

/** Identifiants des boutons du chat (WhatsApp, Telegram). */
export const BUTTONS = { issue: "cmd:issue", preview: "cmd:preview", edit: "cmd:edit", cancel: "cmd:cancel", list: "cmd:list", settings: "cmd:settings" } as const;

export function parseCommand(raw: string): Command | null {
  const original = raw.trim();
  const t = norm(original);
  if (!t) return null;
  const docNumber = NUMBER.exec(original)?.[1]?.toUpperCase() ?? null;

  switch (t) {
    case BUTTONS.issue:
      return { type: "confirm" };
    case BUTTONS.preview:
      return { type: "intent", intent: "preview" };
    case BUTTONS.edit:
      return { type: "edit_hint" };
    case BUTTONS.cancel:
      return { type: "cancel" };
    case BUTTONS.list:
      return { type: "list" };
    case BUTTONS.settings:
      return { type: "settings" };
  }

  if (/^\/start\b/.test(t)) return { type: "start" };
  if (/^(\/help|aide|help|\?|comment ca marche|menu)$/.test(t)) return { type: "help" };
  // « OK » répond à ce que Firmo vient de proposer (aperçu, puis PDF final) : jamais une émission directe.
  if (/^(ok|okay|oui|yes|valide|valider|je valide|c'est bon|cest bon|c'est juste|cest juste|go|d'accord|daccord|parfait|confirme|confirmer|vas-y|vas y)[ .!]*$/.test(t)) {
    return { type: "confirm" };
  }
  if (/^(emets|emettre|emet|issue|finalise|finaliser|pdf final|le pdf final)[ .!]*$/.test(t)) return { type: "finalize" };
  // Mots-clés de la v1 (voix : « réponds ABONNEMENT ou RECHARGE »).
  if (/^(nouveau|nouveau devis|nouvelle facture|new|start over)[ .!]*$/.test(t)) return { type: "intent", intent: "new_document" };
  if (/^(abonnement|recharge|recharger|subscribe|top up)[ .!]*$/.test(t)) return { type: "intent", intent: "subscription" };
  if (/^(admin|administration)[ .!]*$/.test(t)) return { type: "intent", intent: "admin" };
  if (/^(quota|mon quota)[ .!?]*$/.test(t)) return { type: "intent", intent: "quota" };
  if (/^(apercu|l'apercu|voir l'apercu|preview)[ .!]*$/.test(t)) return { type: "intent", intent: "preview" };
  if (/^(stats|statistiques|mes stats)[ .!]*$/.test(t)) return { type: "intent", intent: "stats" };
  if (/^(annule|annuler|supprime le brouillon|cancel|delete draft|stop)[ .!]*$/.test(t)) return { type: "cancel" };
  if (/^(corriger|modifier|edit|correct)[ .!]*$/.test(t)) return { type: "edit_hint" };
  if (/^(mes documents|documents|liste|historique|my documents|list|history)[ .!]*$/.test(t)) return { type: "list" };
  if (/^(reglages|reglage|parametres|profil|mon profil|logo|mon espace|espace|settings|profile|my account|compte|mon compte)[ .!]*$/.test(t)) {
    return { type: "settings" };
  }

  // Type du document.
  if (/^(facture|invoice|fais la facture|transforme en facture|faire la facture)\b/.test(t)) return { type: "invoice", number: docNumber };
  if (/^(devis|quote)[ .!]*$/.test(t)) return { type: "doc_type", docType: "quote" };
  if (/^((facture )?pro ?forma|proforma)[ .!]*$/.test(t)) return { type: "doc_type", docType: "proforma" };
  if (/^(bon de livraison|delivery note)[ .!]*$/.test(t)) return { type: "doc_type", docType: "delivery_note" };

  // Paiement noté : « payé 50000 », « acompte 50 000 FAC-2026-0003 », « paid 120.50 by bank ».
  const pay = /^(paye|payee|paiement|acompte|regle|reglement|solde|paid|payment|deposit)\s*(?:de\s+)?([\d][\d\s.,']*(?:k|mille|million)?)\s*(.*)$/.exec(t);
  if (pay) {
    const rest = (pay[3] ?? "").replace(NUMBER, "").replace(/^(f ?cfa|fcfa|cfa|francs?|par|via|en|by|with)\b/, "").trim();
    return { type: "payment", amount: pay[2]!.trim(), number: docNumber, method: rest ? restoreCase(original, rest) : null };
  }
  if (/^(recu|receipt|fais le recu|envoie le recu)[ .!]*$/.test(t)) return { type: "receipt" };
  const decision = /^(accepte|acceptee|accepted|refuse|refusee|declined|refused)\b/.exec(t);
  if (decision) return { type: "decision", accepted: decision[1]!.startsWith("accept"), number: docNumber };
  if (/^(reviser|revise|corriger le document|revise)\b/.test(t) && docNumber) return { type: "revise", number: docNumber };

  // Lignes : « ligne 2 prix 15000 », « l2 qte 3 », « line 2 label Door ».
  const line = /^(?:ligne|line|l)\s*(\d{1,3})\s*[:,-]?\s*(prix|pu|price|quantite|qte|qty|quantity|designation|libelle|label|description)?\s*[:=]?\s*(.+)$/.exec(t);
  if (line) {
    const n = Number(line[1]);
    const field = line[2] ?? "prix";
    const value = restoreCase(original, line[3]!.trim());
    if (/^(quantite|qte|qty|quantity)$/.test(field)) return { type: "set_quantity", line: n, value };
    if (/^(designation|libelle|label|description)$/.test(field)) return { type: "set_label", line: n, value };
    return { type: "set_price", line: n, value };
  }
  const remove = /^(?:enleve|enlever|retire|retirer|supprime|supprimer|remove|delete)\s+(?:la\s+|le\s+)?(?:ligne\s+|line\s+)?(\d{1,3})[ .!]*$/.exec(t);
  if (remove) return { type: "remove", line: Number(remove[1]) };
  const add = /^(?:ajoute|ajouter|add)\s*:?\s*(.+)$/.exec(t);
  if (add) return { type: "add", text: restoreCase(original, add[1]!) };

  const client = /^(?:client|cliente|pour le client|bill to)\s*[:=]?\s*(.*)$/.exec(t);
  if (client) {
    const name = client[1]!.trim();
    return { type: "client", name: name && !/^(aucun|none|sans)$/.test(name) ? restoreCase(original, name) : null };
  }
  const title = /^(?:objet|subject|titre|title)\s*[:=]?\s*(.*)$/.exec(t);
  if (title) return { type: "title", text: title[1]!.trim() ? restoreCase(original, title[1]!.trim()) : null };
  if (/^(sans remise|pas de remise|no discount)[ .!]*$/.test(t)) return { type: "discount", value: null };
  const discount = /^(?:remise|reduction|discount)\s*(?:de\s+)?[:=]?\s*(.+)$/.exec(t);
  if (discount) return { type: "discount", value: discount[1]!.trim() };
  if (/^(sans|pas de|no|without)\s+(tva|taxe|taxes|vat|tax)[ .!]*$/.test(t)) return { type: "tax", enabled: false };
  if (/^(avec|with|ajoute la|add)\s+(tva|taxe|taxes|vat|tax)[ .!]*$/.test(t)) return { type: "tax", enabled: true };
  return null;
}

/** Retrouve la casse d'origine d'un fragment (les noms propres gardent leurs majuscules). */
function restoreCase(original: string, fragment: string): string {
  const plain = norm(original);
  const index = plain.lastIndexOf(fragment);
  if (index < 0 || plain.length !== original.trim().replace(/\s+/g, " ").length) return fragment;
  return original.trim().replace(/\s+/g, " ").slice(index, index + fragment.length);
}
