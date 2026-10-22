import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { assertAnnualDateOpen, buildAnnualClosingSnapshot, buildCarryForwardBalance, saveAnnualLock, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, validateOpeningBalance, type FiscalPeriod } from "../services/annualClosingService.js";
import { createFiscalAdjustment, saveFiscalReview, validateFiscalAdjustment } from "../services/annualFiscalService.js";
import { createInventoryEntry, validateInventoryEntry } from "../services/annualInventoryService.js";

const period: FiscalPeriod = { id: "fy_2026", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" };
const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({ id: "txn_1", date: "2026-08-12", label: "Logiciel", amount_ht: -10, vat: -2, amount_ttc: -12, currency: "EUR", category: "software", account: "512", status: "validated", reconciled: true, justified: true, ...overrides });

describe("clôture annuelle par période datée", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-annual-closing-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("rejette une balance d’ouverture déséquilibrée", () => {
    expect(() => validateOpeningBalance([{ id: "1", accountNumber: "512000", accountLabel: "Banque", debit: 100, credit: 0 }])).toThrow("déséquilibrée");
  });

  it("reporte uniquement les comptes de bilan, affecte le résultat puis verrouille la période", () => {
    const lines = buildCarryForwardBalance({ accountingSummary: { balances: [
      { accountNumber: "101000", accountLabel: "Capital", balance: -900 },
      { accountNumber: "512000", accountLabel: "Banque", balance: 1400 },
      { accountNumber: "706000", accountLabel: "Prestations", balance: -500 },
    ] }, fiscalSummary: { accountingResult: 500 } } as any);
    expect(lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "512000", debit: 1400 }), expect.objectContaining({ accountNumber: "101000", credit: 900 }), expect.objectContaining({ accountNumber: "120000", credit: 500 })]));
    expect(lines.some((line) => line.accountNumber === "706000")).toBe(false);
    saveAnnualLock(period, { lockHash: "abc", archiveFile: "archives/annual-closing/test.zip" });
    expect(() => assertAnnualDateOpen("2026-03-01")).toThrow("verrouillé");
    expect(() => assertAnnualDateOpen("2026-10-01")).not.toThrow();
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

  it("équilibre le 2033 avec le compte 120 mais bloque son affectation tant qu'elle n'est pas enregistrée", () => {
    saveAnnualSetup(period, "simplified");
    saveOpeningBalance(period, [
      { id: "1", accountNumber: "512000", accountLabel: "Banque", debit: 4006, credit: 0 },
      { id: "2", accountNumber: "101000", accountLabel: "Capital", debit: 0, credit: 900 },
      { id: "3", accountNumber: "120000", accountLabel: "Résultat exercice précédent", debit: 0, credit: 3106 },
    ]);
    const snapshot = buildAnnualClosingSnapshot(period, []);
    expect(snapshot.simplifiedStatements.balanceSheet).toMatchObject({ totalAssets: 4006, totalLiabilities: 4006, difference: 0 });
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "simplified-statements", status: "done" }));
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "prior-result-allocation", status: "blocked", count: 1 }));

    const allocation = createInventoryEntry(period, { date: "2026-03-31", kind: "other", label: "Affectation du résultat précédent", lines: [
      { id: "1", accountNumber: "120000", accountLabel: "Résultat exercice précédent", debit: 3106, credit: 0 },
      { id: "2", accountNumber: "106100", accountLabel: "Réserve légale", debit: 0, credit: 90 },
      { id: "3", accountNumber: "110000", accountLabel: "Report à nouveau", debit: 0, credit: 3016 },
    ] });
    validateInventoryEntry(period.id, allocation.id);
    const allocated = buildAnnualClosingSnapshot(period, []);
    expect(allocated.simplifiedStatements.balanceSheet).toMatchObject({ totalAssets: 4006, totalLiabilities: 4006, difference: 0 });
    expect(allocated.steps).toContainEqual(expect.objectContaining({ id: "prior-result-allocation", status: "done" }));
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

  it("bloque un IS comptabilisé au 695 mais non réintégré fiscalement", () => {
    const entry = createInventoryEntry(period, { date: period.endDate, kind: "corporate_tax", label: "IS à payer", lines: [
      { id: "1", accountNumber: "695000", accountLabel: "Impôt sur les bénéfices", debit: 100, credit: 0 },
      { id: "2", accountNumber: "444000", accountLabel: "État - IS", debit: 0, credit: 100 },
    ] }); validateInventoryEntry(period.id, entry.id);
    const snapshot = buildAnnualClosingSnapshot(period, [transaction({ id: "income", category: "service_revenue", amount_ht: 1000, vat: 200, amount_ttc: 1200 })]);
    expect(snapshot.fiscalSummary.issues[0]).toContain("n’est pas réintégré");
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "fiscal-adjustments", status: "blocked" }));
    expect(snapshot.taxCalculation.ready).toBe(false);
  });

  it("bloque les pénalités fiscales tant qu'elles ne sont pas réintégrées", () => {
    const snapshot = buildAnnualClosingSnapshot(period, [transaction({
      id: "vat-penalty", label: "ACOTVA/072026", category: "vat_advance_payment",
      amount_ht: -630, vat: 0, amount_ttc: -630,
      accounting_splits: [
        { category: "vat_advance_payment", amount: -609 },
        { category: "tax_penalty", amount: -21 },
      ],
    })]);
    expect(snapshot.fiscalSummary.issues[0]).toContain("pénalités fiscales");
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "fiscal-adjustments", status: "blocked" }));
  });

  it("bloque la clôture tant qu'une opération reste au compte d'attente 471", () => {
    const snapshot = buildAnnualClosingSnapshot(period, [transaction({ id: "unknown", label: "COMMANDE", category: "unidentified_transaction", amount_ht: -4.76, vat: 0, amount_ttc: -4.76, invoiceRef: "Carte du 03/03 à identifier" })]);
    expect(snapshot.transactionSummary.unidentified).toBe(1);
    expect(snapshot.steps).toContainEqual(expect.objectContaining({ id: "unidentified", status: "blocked", count: 1 }));
    expect(snapshot.accountingSummary.anomalies).toContainEqual(expect.objectContaining({ code: "UNIDENTIFIED_TRANSACTION", transactionId: "unknown" }));
    expect(snapshot.dataReady).toBe(false);
  });
  it("sépare la TVA de l’exercice des à-nouveaux et propose sa centralisation", () => {
    saveOpeningBalance(period, [
      { id: "1", accountNumber: "445660", accountLabel: "TVA déductible", debit: 248, credit: 0 },
      { id: "2", accountNumber: "512000", accountLabel: "Banque", debit: 932, credit: 0 },
      { id: "3", accountNumber: "445710", accountLabel: "TVA collectée", debit: 0, credit: 1180 },
    ]);
    const transactions = [
      transaction({ id: "sale", category: "service_revenue", amount_ht: 1000, vat: 200, amount_ttc: 1200 }),
      transaction({ id: "purchase", category: "software", amount_ht: -100, vat: -20, amount_ttc: -120 }),
      transaction({ id: "advance", category: "vat_advance_payment", amount_ht: -50, vat: 0, amount_ttc: -50 }),
    ];
    const before = buildAnnualClosingSnapshot(period, transactions);
    expect(before.filingPackage.form2033D).toMatchObject({ vatCollected: 200, vatDeductible: 20 });
    expect(before.vatClosing).toMatchObject({ required: true, annualCollected: 200, annualDeductible: 20 });
    expect(before.vatClosing.suggestedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountNumber: "445710", debit: 1380 }),
      expect.objectContaining({ accountNumber: "445660", credit: 268 }),
      expect.objectContaining({ accountNumber: "445810", credit: 50 }),
      expect.objectContaining({ accountNumber: "445510", credit: 1062 }),
    ]));
    const entry = createInventoryEntry(period, { date: period.endDate, kind: "vat_adjustment", label: "Centralisation TVA", lines: before.vatClosing.suggestedLines });
    validateInventoryEntry(period.id, entry.id);
    const after = buildAnnualClosingSnapshot(period, transactions);
    expect(after.filingPackage.form2033D).toMatchObject({ vatCollected: 200, vatDeductible: 20 });
    expect(after.vatClosing.required).toBe(false);
    expect(after.steps).toContainEqual(expect.objectContaining({ id: "vat-centralization", status: "done" }));
  });
});
