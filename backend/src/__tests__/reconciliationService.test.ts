import { describe, expect, it } from "vitest";
import type { Transaction } from "../types/index.js";
import { getReconciliationIssues } from "../services/reconciliationService.js";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_reconcile",
    date: "2026-08-04",
    label: "Repas",
    amount_ht: -20,
    vat: -2,
    vat_rate: 10,
    amount_ttc: -22,
    currency: "EUR",
    category: "restaurant",
    account: "PSD2",
    status: "validated",
    justified: true,
    ...overrides,
  };
}

describe("getReconciliationIssues", () => {
  it("considere une depense validee, categorisee et justifiee comme prete", () => {
    expect(getReconciliationIssues(transaction())).toEqual([]);
  });

  it("explique tous les elements manquants", () => {
    expect(getReconciliationIssues(transaction({ status: "pending", category: "misc", justified: false })))
      .toEqual(["status", "category", "justification"]);
  });

  it("accepte une piece jointe ou une reference de facture comme justification", () => {
    expect(getReconciliationIssues(transaction({ justified: false, attachment: "ticket.pdf" }))).toEqual([]);
    expect(getReconciliationIssues(transaction({ justified: false, invoiceRef: "FAC-2026-01" }))).toEqual([]);
  });

  it("ne demande pas de justificatif pour une recette", () => {
    expect(getReconciliationIssues(transaction({ amount_ttc: 100, amount_ht: 83.33, vat: 16.67, justified: false }))).toEqual([]);
  });
});
