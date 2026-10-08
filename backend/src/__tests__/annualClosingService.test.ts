import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { buildAnnualClosingSnapshot, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, validateOpeningBalance, type FiscalPeriod } from "../services/annualClosingService.js";
import { createFiscalAdjustment, saveFiscalReview, validateFiscalAdjustment } from "../services/annualFiscalService.js";

const period: FiscalPeriod = { id: "fy_2026", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" };
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({ id: "txn_1", date: "2026-08-12", label: "Logiciel", amount_ht: -10, vat: -2, amount_ttc: -12, currency: "EUR", category: "software", account: "512", status: "validated", reconciled: true, justified: true, ...overrides });

describe("clôture annuelle par période datée", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-annual-closing-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("rejette une balance d’ouverture déséquilibrée", () => {
    expect(() => validateOpeningBalance([{ id: "1", accountNumber: "512000", accountLabel: "Banque", debit: 100, credit: 0 }])).toThrow("déséquilibrée");
  });

  it("utilise les bornes exactes et conserve un verrou fiscal final", () => {
    saveAnnualSetup(period, "simplified");
    saveOpeningBalance(period, [
      { id: "1", accountNumber: "512000", accountLabel: "Banque", debit: 900, credit: 0 },
      { id: "2", accountNumber: "101000", accountLabel: "Capital", debit: 0, credit: 900 },
    ]);
    saveAnnualReview(period, { bankBalance: true, customersAndSuppliers: true, fixedAssets: true, vat: true, accruals: true, equityLoansAndShareholders: true });
    const snapshot = buildAnnualClosingSnapshot(period, [transaction(), transaction({ id: "outside", date: "2026-10-01" })]);
    expect(snapshot.transactionSummary.total).toBe(1);
    expect(snapshot.deadlines).toEqual({ resultDeclaration: "2026-12-31", corporateTaxBalance: "2027-01-15" });
    expect(snapshot.dataReady).toBe(false);
    expect(snapshot.filingReady).toBe(false);
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "fiscal-adjustments", status: "blocked" }));
    expect(snapshot.steps.at(-1)).toMatchObject({ id: "statutory-output", status: "blocked" });
  });

  it("calcule le résultat comptable puis le résultat fiscal explicable", () => {
    const adjustment = createFiscalAdjustment(period.id, { type: "reintegration", kind: "non_deductible_expense", label: "Charge non déductible", amount: 5, accountNumber: "625000" });
    validateFiscalAdjustment(period.id, adjustment.id); saveFiscalReview(period.id, true, "Contrôle effectué");
    const snapshot = buildAnnualClosingSnapshot(period, [
      transaction(),
      transaction({ id: "income", label: "Mission client", category: "service_revenue", amount_ht: 100, vat: 20, amount_ttc: 120 }),
    ]);
    expect(snapshot.fiscalSummary).toMatchObject({ charges: 10, products: 100, accountingResult: 90, reintegrations: 5, deductions: 0, fiscalResult: 95, taxableProfit: 95, taxLoss: 0 });
    expect(snapshot.fiscalReview.confirmed).toBe(true);
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "fiscal-result", status: "done" }));
    expect(snapshot.filingReady).toBe(false);
  });
});
