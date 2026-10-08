import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { buildAnnualClosingSnapshot, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, validateOpeningBalance, type FiscalPeriod } from "../services/annualClosingService.js";

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
    expect(snapshot.dataReady).toBe(true);
    expect(snapshot.filingReady).toBe(false);
    expect(snapshot.steps.at(-1)).toMatchObject({ id: "statutory-output", status: "blocked" });
  });
});
