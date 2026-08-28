import { describe, expect, it } from "vitest";
import type { Transaction } from "../types/index.js";
import { computeVatPosition, isVatPayment } from "../services/vatPositionService.js";

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
});
