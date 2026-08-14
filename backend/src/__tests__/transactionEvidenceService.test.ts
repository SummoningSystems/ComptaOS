import { describe, expect, it } from "vitest";
import { hasTransactionEvidence, needsTransactionEvidence } from "../services/transactionEvidenceService.js";
import type { Transaction } from "../types/index.js";

const transaction = (patch: Partial<Transaction> = {}): Transaction => ({ id: "txn", date: "2026-08-14", label: "Prestataire", amount_ht: -100, vat: -20, amount_ttc: -120, currency: "EUR", category: "external_services", account: "512", status: "validated", ...patch });

describe("transaction evidence", () => {
  it("inclut une dépense PSD2 dont le champ justified est absent", () => expect(needsTransactionEvidence(transaction())).toBe(true));
  it("accepte une pièce jointe même avec un ancien flag false", () => expect(hasTransactionEvidence(transaction({ justified: false, attachment: "facture.pdf" }))).toBe(true));
  it("accepte une référence ou une validation manuelle", () => {
    expect(needsTransactionEvidence(transaction({ invoiceRef: "FAC-42" }))).toBe(false);
    expect(needsTransactionEvidence(transaction({ justified: true }))).toBe(false);
  });
  it("n'exige pas de justificatif pour une recette ou un rejet", () => {
    expect(needsTransactionEvidence(transaction({ amount_ttc: 120 }))).toBe(false);
    expect(needsTransactionEvidence(transaction({ status: "rejected" }))).toBe(false);
  });
});
