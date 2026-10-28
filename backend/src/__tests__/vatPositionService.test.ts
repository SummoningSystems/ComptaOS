import { describe, expect, it } from "vitest";
import type { Transaction } from "../types/index.js";
import { computeVatDeclaration, computeVatPosition, isVatPayment, vatPaymentAmount } from "../services/vatPositionService.js";

const transaction = (patch: Partial<Transaction>): Transaction => ({ id: "txn", date: "2026-08-01", label: "Opération", amount_ht: 0, vat: 0, amount_ttc: 0, currency: "EUR", category: "misc", account: "main", status: "validated", ...patch });

describe("position de TVA et trésorerie disponible", () => {
  it("déduit la TVA sur achats et les règlements CA3 déjà payés", () => {
    const result = computeVatPosition([
      transaction({ id: "sale", amount_ht: 100, vat: 20, amount_ttc: 120 }),
      transaction({ id: "purchase", amount_ht: -50, vat: -10, amount_ttc: -60 }),
      transaction({ id: "payment", label: "DGFIP TVA CA3", amount_ht: -5, amount_ttc: -5 }),
    ], { name: "Entreprise", vatRegime: "monthly_ca3" }, new Date("2026-08-28T12:00:00Z"));

    expect(result).toMatchObject({ collected: 20, deductible: 10, payments: 5, netLiability: 5, reserve: 5 });
  });

  it("provisionne au minimum le prochain acompte du régime simplifié", () => {
    const result = computeVatPosition([
      transaction({ id: "sale", amount_ht: 500, vat: 100, amount_ttc: 600 }),
    ], { name: "SAS", vatRegime: "simplified_ca12", vatReferenceYear: 2025, vatReferenceAmount: 1_000 }, new Date("2026-08-28T12:00:00Z"));

    expect(result.netLiability).toBe(100);
    expect(result.reserve).toBe(400);
    expect(result.nextDue).toMatchObject({ period: "2026-12", estimatedAmount: 400 });
  });

  it("reconnaît aussi un paiement marqué explicitement", () => {
    expect(isVatPayment(transaction({ amount_ttc: -200, tags: ["vat_payment"] }))).toBe(true);
  });

  it("exclut la pénalité du montant de TVA payé dans un virement ventilé", () => {
    const payment = transaction({ amount_ttc: -630, category: "vat_advance_payment", accounting_splits: [
      { category: "vat_advance_payment", amount: -609 },
      { category: "tax_penalty", amount: -21 },
    ] });
    expect(isVatPayment(payment)).toBe(true);
    expect(vatPaymentAmount(payment)).toBe(609);
  });

  it("ne confond pas un avoir fournisseur avec de la TVA collectée", () => {
    const result = computeVatPosition([
      transaction({ id: "purchase", category: "utilities", amount_ht: -100, vat: -20, amount_ttc: -120 }),
      transaction({ id: "credit", category: "utilities", accountingTreatment: "expense_refund", amount_ht: 25, vat: 5, amount_ttc: 30 }),
      transaction({ id: "advance-refund", category: "supplier_advance_refund", amount_ht: 10, vat: 0, amount_ttc: 10 }),
    ], { name: "Entreprise", vatRegime: "monthly_ca3" }, new Date("2026-08-28T12:00:00Z"));

    expect(result).toMatchObject({ collected: 0, deductible: 15, netLiability: 0 });
  });

  it("calcule une CA12E sur un exercice décalé sans reprendre le solde de TVA antérieur ni la pénalité", () => {
    const result = computeVatDeclaration([
      transaction({ id: "sale-2025", date: "2025-12-01", category: "sales", amount_ht: 5_000, vat: 1_000, amount_ttc: 6_000 }),
      transaction({ id: "sale-2026", date: "2026-09-01", category: "sales", amount_ht: 6_295.1, vat: 1_259.02, amount_ttc: 7_554.12 }),
      transaction({ id: "purchase", date: "2026-04-01", category: "software", amount_ht: -3_565.05, vat: -713.01, amount_ttc: -4_278.06 }),
      transaction({ id: "advance", date: "2026-08-26", amount_ttc: -630, category: "vat_advance_payment", accounting_splits: [
        { category: "vat_advance_payment", amount: -609 },
        { category: "tax_penalty", amount: -21 },
      ] }),
      transaction({ id: "old-balance", date: "2026-06-02", amount_ttc: -931, category: "vat_balance_payment" }),
      transaction({ id: "outside", date: "2025-09-30", category: "sales", amount_ht: 100, vat: 20, amount_ttc: 120 }),
    ], "2025-10-01", "2026-09-30");

    expect(result).toEqual({ collected: 2259.02, deductible: 713.01, advances: 609, balancePayments: 931, netBeforeAdvances: 1546.01, netAfterAdvances: 937.01 });
  });
});
