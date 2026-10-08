import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { buildSimplifiedStatements, calculateCorporateTax, getAnnualTaxConfig, periodMonths, saveAnnualTaxConfig } from "../services/annualTaxService.js";

const period = { id: "fy", startDate: "2025-10-01", endDate: "2026-09-30" };
const config = { turnoverOverride: null, belongsToGroup: false, groupTurnover: null, capitalFullyPaid: true, naturalPersonOwnershipPercent: 100, hasSpecialTaxRegime: false, taxCredits: 100, prepayments: 1000, reviewed: true, note: "Contrôlé" };

describe("calcul annuel de l’IS et pré-remplissage 2033", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-tax-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("proratise le plafond réduit selon la durée officielle de l’exercice", () => {
    expect(periodMonths(period)).toBe(12);
    expect(periodMonths({ id: "long", startDate: "2026-10-01", endDate: "2027-12-31" })).toBe(15);
    const result = calculateCorporateTax({ id: "short", startDate: "2026-01-01", endDate: "2026-09-15" }, 40_000, 100_000, { ...getAnnualTaxConfig("short"), ...config, reviewedFingerprint: undefined });
    expect(result.months).toBe(8.5); expect(result.reducedThreshold).toBe(30_104);
  });

  it("calcule 15 % puis 25 % et ne valide que l’empreinte confirmée", () => {
    saveAnnualTaxConfig(period, 50_000, 200_000, config);
    const result = calculateCorporateTax(period, 50_000, 200_000, getAnnualTaxConfig(period.id));
    expect(result).toMatchObject({ reducedRateEligible: true, reducedBase: 42_500, normalBase: 7_500, grossTax: 8_250, netTax: 8_150, balance: 7_150, ready: true });
    expect(calculateCorporateTax(period, 51_000, 200_000, getAnnualTaxConfig(period.id)).ready).toBe(false);
  });

  it("produit un bilan simplifié équilibré et mappe le compte de résultat", () => {
    const balances = [
      { accountNumber: "512000", accountLabel: "Banque", debit: 1120, credit: 0, balance: 1120 },
      { accountNumber: "101000", accountLabel: "Capital", debit: 0, credit: 1000, balance: -1000 },
      { accountNumber: "706000", accountLabel: "Services", debit: 0, credit: 200, balance: -200 },
      { accountNumber: "606000", accountLabel: "Achats", debit: 80, credit: 0, balance: 80 },
    ];
    const lines = [
      { journalCode: "BQ", journalLabel: "Banque", entryNumber: "1", entryDate: "2026-01-01", accountNumber: "706000", accountLabel: "Services", pieceRef: "1", pieceDate: "2026-01-01", label: "Vente", debit: 0, credit: 200, transactionId: "1" },
      { journalCode: "BQ", journalLabel: "Banque", entryNumber: "2", entryDate: "2026-01-02", accountNumber: "606000", accountLabel: "Achats", pieceRef: "2", pieceDate: "2026-01-02", label: "Achat", debit: 80, credit: 0, transactionId: "2" },
    ];
    const statements = buildSimplifiedStatements(balances, lines, 120, []);
    expect(statements.balanceSheet).toMatchObject({ totalAssets: 1120, totalLiabilities: 1120, difference: 0 });
    expect(statements.profitAndLoss.fields).toEqual(expect.arrayContaining([expect.objectContaining({ code: "218", value: 200 }), expect.objectContaining({ code: "310", value: 120 })]));
  });
});
