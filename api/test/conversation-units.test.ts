import { describe, expect, it } from "vitest";
import { checker, guardLines, guardReading, numbersIn } from "../src/ai/guard.js";
import { toCorrections } from "../src/ai/openai.js";
import { decideSimple, readSimple } from "../src/ai/rules.js";
import { parseCommand } from "../src/conversation/commands.js";
import { BANNED_WORDS, chatWords, type ChatDraft, noun } from "../src/voix/chat.js";

describe("commandes", () => {
  it.each([
    ["OK", { type: "confirm" }],
    ["c'est bon !", { type: "confirm" }],
    ["émets", { type: "finalize" }],
    ["pdf final", { type: "finalize" }],
    ["NOUVEAU", { type: "intent", intent: "new_document" }],
    ["ABONNEMENT", { type: "intent", intent: "subscription" }],
    ["RECHARGE", { type: "intent", intent: "subscription" }],
    ["ADMIN", { type: "intent", intent: "admin" }],
    ["quota", { type: "intent", intent: "quota" }],
    ["aperçu", { type: "intent", intent: "preview" }],
    ["Annuler", { type: "cancel" }],
    ["mes documents", { type: "list" }],
    ["Réglages", { type: "settings" }],
    ["ligne 2 prix 15 000", { type: "set_price", line: 2, value: "15 000" }],
    ["l3 qté 4", { type: "set_quantity", line: 3, value: "4" }],
    ["line 1 label Steel door", { type: "set_label", line: 1, value: "Steel door" }],
    ["enlève la 3", { type: "remove", line: 3 }],
    ["client Hôtel du Lac", { type: "client", name: "Hôtel du Lac" }],
    ["remise 10%", { type: "discount", value: "10%" }],
    ["sans TVA", { type: "tax", enabled: false }],
    ["facture", { type: "invoice", number: null }],
    ["facture DEV-2026-003", { type: "invoice", number: "DEV-2026-003" }],
    ["facture D/00002", { type: "invoice", number: "D/00002" }],
    ["facture DEV-2026-001/R2", { type: "invoice", number: "DEV-2026-001/R2" }],
    ["payé 50 000 par Mobile Money", { type: "payment", amount: "50 000", number: null, method: "Mobile Money" }],
    ["acompte 20000 FAC-2026-001", { type: "payment", amount: "20000", number: "FAC-2026-001", method: null }],
    ["payé 15000 FAC-MAIRIE-7", { type: "payment", amount: "15000", number: "FAC-MAIRIE-7", method: null }],
    ["reçu", { type: "receipt" }],
    ["accepté DEV-2026-002", { type: "decision", accepted: true, number: "DEV-2026-002" }],
    ["cmd:issue", { type: "confirm" }],
    ["cmd:preview", { type: "intent", intent: "preview" }],
  ])("« %s »", (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it("une vente n'est pas une commande", () => {
    expect(parseCommand("2 portes à 45000 et la pose 10000")).toBeNull();
  });
});

describe("garde anti-invention", () => {
  it("relève les nombres en chiffres et en lettres, et les pourcentages", () => {
    const found = numbersIn("2 portes à 45 000, pose quinze mille, 1,5 m2, main d'œuvre 30 %");
    expect(found.has("45000")).toBe(true);
    expect(found.has("15000")).toBe(true);
    expect(found.has("q:1.5")).toBe(true);
    expect(found.has("p:3000")).toBe(true);
  });

  it("refuse un prix absent de la source", () => {
    const r = guardLines([{ label: "Porte", quantityText: "2", unit: "porte", unitPriceText: "50000", lineTotalText: null }], "2 portes à 45000", 0);
    expect(r.lines[0]?.unitPriceMinor).toBeNull();
    expect(r.rejected).toBe(1);
  });

  it("montant sans quantité : ligne au forfait (v1)", () => {
    const r = guardLines([{ label: "Pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "60 000" }], "pose 60 000", 0);
    expect(r.lines[0]).toMatchObject({ kind: "flat", flatAmountMinor: "60000", quantity: null });
  });

  it("unité telle que dite, jamais normalisée", () => {
    const r = guardLines([{ label: "Barre tube 80 x 40", quantityText: "45", unit: "barre", unitPriceText: "17 000", lineTotalText: null }], "45 barres de tube 80 x 40 à 17 000", 0);
    expect(r.lines[0]).toMatchObject({ unit: "barre", quantity: "45", unitPriceMinor: "17000" });
  });

  it("total + quantité : prix unitaire seulement si la division tombe juste, à confirmer", () => {
    const ok = guardLines([{ label: "Porte", quantityText: "3", unit: null, unitPriceText: null, lineTotalText: "150000" }], "3 portes pour 150000", 0);
    expect(ok.lines[0]).toMatchObject({ unitPriceMinor: "50000", toConfirm: ["unit_price"] });
    const no = guardLines([{ label: "Porte", quantityText: "3", unit: null, unitPriceText: null, lineTotalText: "100000" }], "3 portes pour 100000", 0);
    expect(no.lines[0]?.unitPriceMinor).toBeNull();
  });

  it("photo sans transcription : valeurs lues marquées à confirmer", () => {
    const r = guardLines([{ label: "Tôle", quantityText: "4", unit: null, unitPriceText: "7500", lineTotalText: null }], null, 0);
    expect([...(r.lines[0]?.toConfirm ?? [])].sort()).toEqual(["quantity", "unit_price"]);
  });

  it("lecture complète : sections, ajustement en pourcentage gardé, acompte, champs latents", () => {
    const source = "Devis pour la mairie d'Agoè, portail coulissant : 12 barres de tube 80 x 40 à 18 000, 4 feuilles de tôle à 32 000. Main d'œuvre 25 %, transport 30 000. Acompte 30 %, valable 15 jours, chantier Adidogomé.";
    const g = guardReading({
      documentType: "quote", clientName: "Mairie d'Agoè", title: "Portail", site: "Adidogomé",
      validityDaysText: "15 jours", depositPercentText: "30 %",
      sections: [{ title: "Portail coulissant", showSubtotal: true, lines: [
        { label: "Tube 80 x 40", quantityText: "12", unit: "barre", unitPriceText: "18 000", lineTotalText: null },
        { label: "Tôle", quantityText: "4", unit: "feuille", unitPriceText: "32 000", lineTotalText: null },
      ] }],
      adjustments: [
        { label: "Main d'œuvre", mode: "percent", sign: 1, base: "items_total", valueText: "25" },
        { label: "Transport", mode: "amount", sign: 1, base: "items_total", valueText: "30 000" },
        { label: "Remise", mode: "percent", sign: -1, base: "items_total", valueText: "10" },
      ],
    }, source, 0);
    expect(g.content.sections?.[0]).toMatchObject({ title: "Portail coulissant", showSubtotal: true });
    expect(g.content.adjustments?.map((a) => [a.mode, a.rateBp ?? a.valueMinor ?? null])).toEqual([
      ["percent", 2500], ["amount", "30000"], ["percent", null],
    ]);
    expect(g.content).toMatchObject({ validity_days: 15, deposit_bp: 3000, site: "Adidogomé" });
    expect(g.rejected).toBe(1);
  });

  it("une correction ne retient qu'un nombre dit dans le message", () => {
    const c = checker("non, la tôle c'est 20 000", 0);
    expect(c.amount("20 000")).toBe(20000n);
    expect(c.amount("25 000")).toBeNull();
    expect(c.rejected).toBe(1);
  });
});

describe("lecture simplifiée (mode dégradé)", () => {
  it("lit une vente écrite simplement, main-d'œuvre en ajustement", () => {
    const r = readSimple("2 portes à 45 000\n3 sacs de ciment x 5000, pose 10000, main d'œuvre 30 %");
    expect(r.sections[0]?.lines).toEqual([
      { label: "portes", quantityText: "2", unit: null, unitPriceText: "45 000", lineTotalText: null },
      { label: "ciment", quantityText: "3", unit: "sacs", unitPriceText: "5000", lineTotalText: null },
      { label: "pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "10000" },
    ]);
    expect(r.adjustments).toEqual([{ label: "main d'œuvre", mode: "percent", sign: 1, base: "items_total", valueText: "30" }]);
  });

  it("format de secours annoncé dans le chat : quantité | libellé | prix", () => {
    const r = readSimple("45 | Barre tube 80 x 40 | 17 000\nforfait | Pose | 60 000");
    expect(r.sections[0]?.lines).toEqual([
      { label: "Barre tube 80 x 40", quantityText: "45", unit: null, unitPriceText: "17 000", lineTotalText: null },
      { label: "Pose", quantityText: null, unit: null, unitPriceText: null, lineTotalText: "60 000" },
    ]);
  });

  it("décision sans IA : salutation, source, suppression", () => {
    expect(decideSimple("Bonjour", { draft: null }).intent).toBe("greeting");
    expect(decideSimple("2 portes à 45000", { draft: null }).intent).toBe("source");
    expect(decideSimple("Je demande la suppression de mes données", { draft: null }).intent).toBe("delete_data");
  });
});

describe("corrections renvoyées par l'IA", () => {
  it("garde les corrections complètes, écarte les incomplètes", () => {
    const base = { line: null, section: null, adjustment: null, field: null, value_text: null, new_lines: [], new_adjustment: null, method: null };
    const out = toCorrections([
      { ...base, target: "line", op: "set", line: 2, field: "unit_price", value_text: "20 000" },
      { ...base, target: "line", op: "set", line: null, field: "unit_price", value_text: "5" },
      { ...base, target: "document", op: "set", field: "client_name", value_text: "M. Kodjo" },
      { ...base, target: "document", op: "append", field: "assumptions", value_text: "Valable 30 jours" },
      { ...base, target: "payment", op: "add", value_text: "50 000", method: "Flooz" },
    ] as never);
    expect(out).toEqual([
      { target: "line", op: "set", line: 2, field: "unit_price", valueText: "20 000" },
      { target: "document", op: "set", field: "client_name", valueText: "M. Kodjo" },
      { target: "document", op: "append", field: "assumptions", valueText: "Valable 30 jours" },
      { target: "payment", op: "add", amountText: "50 000", method: "Flooz" },
    ]);
  });
});

describe("voix de Firmo (v1)", () => {
  const draft: ChatDraft = {
    typeLabel: "Devis", noun: noun("fr", "quote"), title: "Supports 60 modules", client: "Mairie d'Agoè",
    sections: [{ n: 1, title: null, subtotal: null, lines: [{ n: 1, label: "Barre tube 80 x 40", description: null, kind: "priced", qty: "45", unit: "barre", price: "17 000 F CFA", flat: null, total: "765 000 F CFA", toConfirm: false }] }],
    adjustments: [{ n: 1, label: "Main-d'œuvre", percent: null, amount: "160 000 F CFA", missing: false }],
    total: "925 000 F CFA", deposit: null, details: [],
  };

  /** Tous les messages possibles, avec des valeurs d'exemple. */
  function allMessages(locale: string): string[] {
    const w = chatWords(locale);
    const n = noun(locale, "invoice");
    const out: string[] = [];
    for (const [key, value] of Object.entries(w)) {
      if (typeof value === "string") out.push(value);
      else if (typeof value === "function") {
        const f = value as (...a: unknown[]) => unknown;
        const r = key === "reading" || key === "latest" ? f(draft, null, "émis")
          : key === "corrected" ? f("1. Barre", null, draft)
          : key === "question" ? f({ kind: "client" }, n)
          : key === "quota" ? f(3, 30, 27, false)
          : key === "stats" ? f({ drafts: 1, issued: 2, quotes: 1, invoices: 1, accepted: 1 })
          : key === "search" ? f([])
          : key === "link" ? f("settings", "https://x", 15)
          : key === "converted" ? f("DEV-2026-001", n)
          : f(n, "2", "3", false);
        if (typeof r === "string") out.push(r);
      }
    }
    return out;
  }

  it.each(["fr", "en"])("%s : aucun mot banni, aucun point d'exclamation, aucun emoji", (locale) => {
    const messages = allMessages(locale);
    expect(messages.length).toBeGreaterThan(40);
    for (const m of messages) {
      const lower = m.toLowerCase();
      for (const word of BANNED_WORDS) expect(lower, m).not.toContain(word);
      expect(m, m).not.toMatch(/!/);
      expect(m, m).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("les dix messages qui reviennent toujours (voix.md)", () => {
    const w = chatWords("fr");
    expect(w.welcome).toBe("Envoie-moi une vente, je t'en fais un devis. Tu peux parler : dis ce que tu as chiffré, comme tu le dirais à quelqu'un.");
    expect(w.ackVoice).toBe("J'écoute…");
    expect(w.ackPhoto).toBe("Je regarde ta feuille…");
    expect(w.reading(draft, null)).toMatch(/^J'ai lu :/);
    expect(w.askBusinessName(noun("fr", "quote"))).toBe("Sous quel nom doit partir ce devis ?");
    expect(w.corrected("1. Barre", null, draft)).toMatch(/^C'est corrigé\./);
    expect(w.notUnderstood).toBe("Je n'ai pas bien saisi la fin. Redis-moi juste les dernières lignes, ou écris-les.");
    expect(w.outage).toBe("Je n'arrive pas à lire une nouvelle source en ce moment. Écris chaque ligne comme ceci : quantité | libellé | prix. Ton devis déjà commencé reste disponible.");
    expect(w.limit("https://x")).toMatch(/^Tes documents du mois sont utilisés\. Ton brouillon reste disponible\. Pour continuer, réponds ABONNEMENT ou RECHARGE/);
    expect(w.delivered(noun("fr", "quote"))).toBe("Ton devis est prêt.");
    expect(w.nothingYet).toBe("Tu n'as pas encore de devis. Le premier prend une minute.");
  });

  it("accords : ce devis, cette facture", () => {
    const w = chatWords("fr");
    expect(w.question({ kind: "client" }, noun("fr", "invoice"))).toBe("Pour qui est cette facture ?");
    expect(w.pdfOffer(noun("fr", "invoice"))).toBe("Ta facture est prête. Souhaites-tu que je prépare le PDF maintenant ?");
  });
});

describe("réponses libres de l'IA", () => {
  it("ramenées à la voix : sans exclamation, sans emoji, deux phrases au plus", async () => {
    const { voiceOf } = await import("../src/conversation/engine.js");
    expect(voiceOf("Bonjour ! 👋 Envoie-moi ta vente. Je m'occupe du reste ! Merci.")).toBe("Bonjour. Envoie-moi ta vente.");
    expect(voiceOf("Tu veux quoi exactement ?")).toBe("Tu veux quoi exactement ?");
    expect(voiceOf("Il me faut le nom du client. Écris-le, par exemple M. Mensah. Merci.")).toBe("Il me faut le nom du client. Écris-le, par exemple M. Mensah.");
    expect(voiceOf("🙂")).toBeNull();
    expect(voiceOf(null)).toBeNull();
  });
});
