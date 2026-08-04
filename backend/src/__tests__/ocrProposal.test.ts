import { describe, expect, it } from "vitest";
import { normalizeReceiptProposal } from "../services/ocrService.js";

describe("proposition OCR de justificatif", () => {
  it("conserve une ventilation multi-TVA valide", () => {
    expect(normalizeReceiptProposal({ supplier: "Restaurant Test", date: "2026-08-04", invoice_ref: "N-42", amount_ht: 26.51, amount_ttc: 30, category: "restaurant", confidence: "high", vat_splits: [{ rate: 10, amount_ttc: 20 }, { rate: 20, amount_ttc: 10 }] })).toEqual({ supplier: "Restaurant Test", date: "2026-08-04", invoiceRef: "N-42", amountHt: 26.51, amountTtc: 30, category: "restaurant", confidence: "high", vatSplits: [{ rate: 10, amountTtc: 20 }, { rate: 20, amountTtc: 10 }] });
  });
  it("neutralise les valeurs inventées ou invalides", () => {
    expect(normalizeReceiptProposal({ amount_ttc: "inconnu", category: "pirate", confidence: "certain", vat_splits: [{ rate: -1, amount_ttc: 20 }] })).toMatchObject({ amountTtc: 0, category: "misc", confidence: "low", vatSplits: [] });
  });
});
