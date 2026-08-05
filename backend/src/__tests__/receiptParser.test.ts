import { describe, expect, it } from "vitest";
import { parseReceiptTextLocally } from "../services/receiptParser.js";

describe("analyse comptable locale d'un ticket", () => {
  it("reconstruit une ventilation multi-TVA à partir des bases HT et TVA", () => {
    const result = parseReceiptTextLocally(`BISTRO DU TEST\nFACTURE N-42\n04/08/2026\nTVA 10 % 16,18 1,62\nTVA 20 % 7,50 1,50\nTOTAL HT 23,68\nTOTAL TTC 26,80`);
    expect(result).toMatchObject({ supplier: "BISTRO DU TEST", date: "2026-08-04", invoiceRef: "N-42", amountHt: 23.68, amountTtc: 26.8, category: "restaurant", confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 10, amountTtc: 17.8 }, { rate: 20, amountTtc: 9 }]);
  });

  it("refuse une ventilation incohérente avec le total", () => {
    const result = parseReceiptTextLocally(`RESTAURANT TEST\nTVA 10 % TTC 12,00\nTOTAL TTC 30,00`);
    expect(result.vatSplits).toEqual([]);
    expect(result.confidence).not.toBe("high");
  });

  it("associe correctement un récapitulatif PDF lu colonne par colonne", () => {
    const result = parseReceiptTextLocally(`Scaleaway\nBill 5419116\nDesignation\nTotal HT\nTaux TVA\nTotal TVA\nTotal TTC\n72,99 Euros\n20,00 %\n14,60 Euros\n87,59 Euros`);
    expect(result).toMatchObject({ supplier: "Scaleaway", invoiceRef: "5419116", amountHt: 72.99, amountTtc: 87.59, confidence: "high" });
    expect(result.vatSplits).toEqual([{ rate: 20, amountTtc: 87.59 }]);
  });
});
