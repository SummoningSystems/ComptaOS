import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspaceRoot = vi.hoisted(() => ({ value: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspaceRoot.value }));
import { annualAccountingOptions, annualDepreciation, annualFingerprint, buildAnnualStatements, loadAnnualWorkspace, saveAnnualWorkspace, validateSettlement, type AnnualWorkspace } from "../services/annualAccountingService.js";
import type { AccountingPreview } from "../services/accountingExportService.js";

const transaction: Transaction = { id: "bank_powens_1", date: "2026-03-05", label: "ENGIE", amount_ht: -100, vat: 0, amount_ttc: -100, currency: "EUR", category: "utilities", account: "512000", status: "validated", reconciled: true };
const empty = (): AnnualWorkspace => ({ version: 1, thirdParties: [], documents: [], schedules: [], adjustments: [], assets: [], fiscalAdjustments: [], confirmations: [], closings: [] });

describe("comptabilité annuelle", () => {
  beforeEach(async () => { workspaceRoot.value = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-annual-")); });
  afterEach(async () => { await fs.rm(workspaceRoot.value, { recursive: true, force: true }); });

  it("persiste l'espace annuel sans migration destructive", () => {
    const value = empty(); value.thirdParties.push({ id: "tiers_1", kind: "supplier", name: "ENGIE", accountNumber: "401100" });
    saveAnnualWorkspace(value); expect(loadAnnualWorkspace().thirdParties[0]).toMatchObject({ name: "ENGIE", accountNumber: "401100" });
  });

  it("affecte les prélèvements au 4091 et solde la facture annuelle", () => {
    const value = empty(); value.schedules.push({ id: "ech_1", supplier: "ENGIE", label: "Électricité", reference: "2026", startDate: "2026-01-01", endDate: "2026-12-31", advanceAccount: "409100", transactionIds: [transaction.id], attachment: "echeancier.pdf", createdAt: "2026-01-01T00:00:00Z", settlement: { date: "2026-12-20", invoiceRef: "FACT-1", amountHt: 100, amountVat: 20, amountTtc: 120, supplierAccount: "401100", expenseAccount: "606100", vatAccount: "445660", attachment: "facture.pdf", status: "validated" } });
    const options = annualAccountingOptions(value, "2026", [transaction]);
    expect(options.advanceAccounts[transaction.id].number).toBe("409100"); expect(options.evidenceTransactionIds).toContain(transaction.id);
    expect(options.extraLines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "606100", debit: 100 }), expect.objectContaining({ accountNumber: "409100", credit: 100 })]));
  });

  it("bloque la déduction si la facture de régularisation n'est pas jointe", () => {
    const value = empty(); value.schedules.push({ id: "ech_1", supplier: "ENGIE", label: "Électricité", reference: "", startDate: "2026-01-01", endDate: "2026-12-31", advanceAccount: "409100", transactionIds: [], createdAt: "", settlement: { date: "2026-12-20", invoiceRef: "FACT-1", amountHt: 100, amountVat: 20, amountTtc: 120, supplierAccount: "401100", expenseAccount: "606100", vatAccount: "445660", status: "validated" } });
    expect(annualAccountingOptions(value, "2026").extraAnomalies).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_SETTLEMENT_INVOICE", severity: "blocking" })]));
  });

  it("ne remonte pas sur un exercice les anomalies portées uniquement par un autre exercice", () => {
    const value = empty(); value.schedules.push({ id: "ech_1", supplier: "ENGIE", label: "Ancien échéancier", reference: "2025", startDate: "2025-01-01", endDate: "2025-12-31", advanceAccount: "409100", transactionIds: ["bank_2025"], createdAt: "2025-01-01T00:00:00Z" });
    const oldTransaction = { ...transaction, id: "bank_2025", date: "2025-03-05" };
    expect(annualAccountingOptions(value, "2026", [oldTransaction]).extraAnomalies).toEqual([]);
  });

  it("sépare une facture fournisseur de son paiement et de son acompte", () => {
    const value = empty(); value.documents.push({ id: "fact_1", kind: "purchase", thirdPartyId: "tiers_1", date: "2026-06-01", invoiceRef: "F-1", label: "Matériel", amountHt: 100, amountVat: 20, amountTtc: 120, operatingAccount: "606300", vatAccount: "445660", thirdPartyAccount: "401100", paymentTransactionIds: [], advanceTransactionIds: [transaction.id], advanceAccount: "409100", attachment: "facture.pdf", status: "validated" });
    const options = annualAccountingOptions(value, "2026", [transaction]);
    expect(options.advanceAccounts[transaction.id].number).toBe("409100");
    expect(options.extraLines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "401100", credit: 120 }), expect.objectContaining({ accountNumber: "401100", debit: 100 }), expect.objectContaining({ accountNumber: "409100", credit: 100 })]));
  });

  it("calcule un amortissement linéaire prorata temporis la première année", () => {
    const amount = annualDepreciation({ id: "a", label: "PC", acquisitionDate: "2026-07-01", cost: 1200, residualValue: 0, durationYears: 3, assetAccount: "218300", depreciationAccount: "281830", expenseAccount: "681120" }, "2026");
    expect(amount).toBeGreaterThan(200); expect(amount).toBeLessThan(205);
  });

  it("sépare résultat comptable et résultat fiscal", () => {
    const value = empty(); value.fiscalAdjustments = [{ id: "f1", year: "2026", kind: "reinstatement", label: "Amende", amount: 100 }];
    const preview = { year: "2026", eligibleCount: 1, excludedCount: 0, lines: [], anomalies: [], totalDebit: 1000, totalCredit: 1000, balanced: true, balances: [{ accountNumber: "706000", accountLabel: "Ventes", debit: 0, credit: 1000, balance: -1000 }, { accountNumber: "606000", accountLabel: "Achats", debit: 400, credit: 0, balance: 400 }] } satisfies AccountingPreview;
    expect(buildAnnualStatements(preview, value, "2026").fiscal).toMatchObject({ accountingResult: 600, reinstatements: 100, taxableResult: 700 });
  });

  it("garde l'empreinte stable quand une donnée sans rapport avec l'exercice est ajoutée", () => {
    const value = empty();
    const preview = { year: "2026", eligibleCount: 0, excludedCount: 0, lines: [], anomalies: [], totalDebit: 0, totalCredit: 0, balanced: true, balances: [] } satisfies AccountingPreview;
    const initial = annualFingerprint(value, preview, "2026");
    value.thirdParties.push({ id: "tiers_futur", kind: "client", name: "Client futur", accountNumber: "411900" });
    value.assets.push({ id: "immo_futur", label: "Machine future", acquisitionDate: "2027-01-01", cost: 1000, residualValue: 0, durationYears: 3, assetAccount: "215000", depreciationAccount: "281500", expenseAccount: "681120" });
    expect(annualFingerprint(value, preview, "2026")).toBe(initial);
  });

  it("refuse une TVA incohérente", () => {
    expect(validateSettlement({ date: "2026-12-20", invoiceRef: "F", amountHt: 100, amountVat: 20, amountTtc: 130, supplierAccount: "401", expenseAccount: "606", vatAccount: "44566", status: "validated" })).toContain("HT + TVA doit être égal au TTC.");
  });
});
