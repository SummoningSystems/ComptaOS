import { describe, expect, it } from "vitest";
import { needsTransactionEvidence } from "../utils/transactionEvidence";
import type { Transaction } from "../types";

const transaction = (patch: Partial<Transaction> = {}): Transaction => ({ id: "txn", date: "2026-08-14", label: "Prestataire", amount_ht: -100, vat: -20, amount_ttc: -120, currency: "EUR", category: "external_services", account: "512", status: "validated", ...patch });

describe("transaction evidence", () => {
  it("affiche une dépense PSD2 sans champ justified", () => expect(needsTransactionEvidence(transaction())).toBe(true));
  it("masque une dépense avec pièce, référence ou validation", () => {
    expect(needsTransactionEvidence(transaction({ attachment: "facture.pdf" }))).toBe(false);
    expect(needsTransactionEvidence(transaction({ invoiceRef: "FAC-42" }))).toBe(false);
    expect(needsTransactionEvidence(transaction({ justified: true }))).toBe(false);
  });
  it("n'exige rien pour une recette", () => expect(needsTransactionEvidence(transaction({ amount_ttc: 120 }))).toBe(false));
});
