import { describe, expect, it } from "vitest";
import { type Currency, formatMoney, formatQuantity, minorToMajorString, parseAmount, parseQuantity } from "../src/documents/money.js";
import { amountInWords, englishWords, frenchWords, parseFrenchNumber } from "../src/documents/words.js";

const XOF: Currency = { code: "XOF", minorUnits: 0, symbol: "F CFA", symbolBefore: false, thousandsSeparator: " ", decimalSeparator: "," };
const USD: Currency = { code: "USD", minorUnits: 2, symbol: "$", symbolBefore: true, thousandsSeparator: ",", decimalSeparator: "." };

describe("formatage", () => {
  it("franc CFA sans décimales", () => {
    expect(formatMoney(1500000n, XOF)).toBe("1 500 000 F CFA");
    expect(formatMoney("0", XOF)).toBe("0 F CFA");
  });
  it("dollar avec décimales et symbole devant", () => {
    expect(formatMoney(125050n, USD)).toBe("$1,250.50");
    expect(formatMoney(5n, USD, false)).toBe("0.05");
  });
  it("quantités", () => {
    expect(formatQuantity("1.500")).toBe("1,5");
    expect(formatQuantity("3.000")).toBe("3");
  });
  it("majeur exact", () => {
    expect(minorToMajorString(125050n, 2)).toBe("1250.5");
    expect(minorToMajorString("15000", 0)).toBe("15000");
  });
});

describe("lecture des montants", () => {
  it.each([
    ["15 000", 15000n],
    ["15.000", 15000n],
    ["15000F", 15000n],
    ["15 000 F CFA", 15000n],
    ["15k", 15000n],
    ["2 mille", 2000n],
    ["1,5 million", 1500000n],
    ["250", 250n],
  ])("XOF « %s » → %s", (text, expected) => {
    expect(parseAmount(text, 0)).toBe(expected);
  });

  it("décimales dans une devise à centimes", () => {
    expect(parseAmount("12,50", 2)).toBe(1250n);
    expect(parseAmount("1,250.50", 2)).toBe(125050n);
  });

  it("refuse une précision supérieure à la devise (jamais d'arrondi)", () => {
    expect(parseAmount("12,5", 0)).toBeNull();
  });

  it("refuse ce qui n'est pas un montant", () => {
    expect(parseAmount("beaucoup", 0)).toBeNull();
    expect(parseAmount("15 abc", 0)).toBeNull();
  });

  it("quantités", () => {
    expect(parseQuantity("1,5")).toBe("1.5");
    expect(parseQuantity("0")).toBeNull();
    expect(parseQuantity("2.1234")).toBeNull();
  });
});

describe("lettres", () => {
  it.each([
    [0n, "zéro"],
    [21n, "vingt et un"],
    [71n, "soixante et onze"],
    [80n, "quatre-vingts"],
    [81n, "quatre-vingt-un"],
    [99n, "quatre-vingt-dix-neuf"],
    [200n, "deux cents"],
    [250n, "deux cent cinquante"],
    [1000n, "mille"],
    [15000n, "quinze mille"],
    [80000n, "quatre-vingt mille"],
    [200000n, "deux cent mille"],
    [1500000n, "un million cinq cent mille"],
    [2000000n, "deux millions"],
  ])("%s → %s", (n, words) => {
    expect(frenchWords(n)).toBe(words);
  });

  it("anglais", () => {
    expect(englishWords(1250n)).toBe("one thousand two hundred and fifty");
  });

  it("montant avec centimes", () => {
    expect(amountInWords(125050n, 2, "fr")).toBe("mille deux cent cinquante et cinquante centimes");
  });

  it("lecture d'un nombre dit en lettres", () => {
    expect(parseFrenchNumber("quinze mille")).toBe(15000n);
    expect(parseFrenchNumber("deux cent cinquante mille")).toBe(250000n);
    expect(parseFrenchNumber("quatre-vingt-dix")).toBe(90n);
    expect(parseFrenchNumber("un million cinq cent mille")).toBe(1500000n);
    expect(parseFrenchNumber("trois portes")).toBeNull();
  });
});
