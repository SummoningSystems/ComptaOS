import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

vi.mock("../services/settingsService.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/settingsService.js")>();
  return { ...original, loadCompanyProfile: () => ({ name: "Test", siren: "123456789" }) };
});
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => "C:/missing" }));

import { buildAccountingPreview, FEC_HEADERS, generateFec, validateFec } from "../services/accountingExportService.js";
import { defaultAccountingConfig } from "../services/settingsService.js";

const transaction = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: "txn_meal", date: "2026-08-03", label: "Repas client", amount_ht: -26.51,
  vat: -3.49, amount_ttc: -30, currency: "EUR", category: "restaurant", account: "main",
  status: "validated", reconciled: true, invoiceRef: "TICKET-42", ...overrides,
});

describe("dossier expert-comptable", () => {
  it("produit une écriture multi-TVA équilibrée avec HT, deux TVA et TTC", () => {
    const preview = buildAccountingPreview([transaction({ vat_splits: [{ rate: 10, amount_ttc: -20 }, { rate: 20, amount_ttc: -10 }] })], defaultAccountingConfig(), "2026");
    expect(preview.lines.map((item) => item.label)).toEqual(["Repas client - HT", "Repas client - TVA 10 %", "Repas client - TVA 20 %", "Repas client - TTC"]);
    expect(preview.totalDebit).toBe(30);
    expect(preview.totalCredit).toBe(30);
    expect(preview.anomalies.filter((item) => item.severity === "blocking")).toEqual([]);
  });

  it("exclut les opérations non validées ou non rapprochées", () => {
    const preview = buildAccountingPreview([transaction(), transaction({ id: "pending", status: "pending", reconciled: false })], defaultAccountingConfig(), "2026");
    expect(preview.eligibleCount).toBe(1);
    expect(preview.excludedCount).toBe(1);
    expect(preview.anomalies).toContainEqual(expect.objectContaining({ code: "EXCLUDED_TRANSACTIONS", severity: "warning" }));
  });

  it("génère un FEC de 18 colonnes accepté par le validateur interne", () => {
    const preview = buildAccountingPreview([transaction()], defaultAccountingConfig(), "2026");
    const fec = generateFec(preview);
    expect(fec.split("\r\n")[0].split("|")).toEqual(FEC_HEADERS);
    expect(fec.trim().split("\r\n").every((row) => row.split("|").length === 18)).toBe(true);
    expect(validateFec(fec)).toEqual([]);
  });

  it("utilise le compte de produit de la catégorie pour une recette client", () => {
    const preview = buildAccountingPreview([transaction({ id: "client", label: "Facture client", category: "goods_sales", amount_ht: 100, vat: 20, amount_ttc: 120 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "707000", credit: 100 })]));
  });

  it("comptabilise un remboursement d'acompte fournisseur au 4091 sans produit", () => {
    const preview = buildAccountingPreview([transaction({ id: "refund", label: "Remboursement ENGIE", category: "supplier_advance_refund", amount_ht: 25, vat: 0, amount_ttc: 25 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "512100", debit: 25 }), expect.objectContaining({ accountNumber: "409100", credit: 25 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("7"))).toBe(false);
  });

  it("comptabilise un avoir fournisseur comme diminution de charge et de TVA déductible", () => {
    const preview = buildAccountingPreview([transaction({ id: "credit", label: "Avoir ENGIE", category: "utilities", accountingTreatment: "expense_refund", amount_ht: 20, vat: 5, amount_ttc: 25 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "512100", debit: 25 }), expect.objectContaining({ accountNumber: "606100", credit: 20 }), expect.objectContaining({ accountNumber: "445660", credit: 5 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("7"))).toBe(false);
  });

  it("conserve une indemnité réelle dans un compte de produit", () => {
    const preview = buildAccountingPreview([transaction({ id: "compensation", label: "Indemnité fournisseur", category: "supplier_compensation", amount_ht: 25, vat: 0, amount_ttc: 25 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "758000", credit: 25 })]));
  });

  it("comptabilise un prélèvement lié à un échéancier comme acompte fournisseur", () => {
    const preview = buildAccountingPreview([transaction({ id: "engie", label: "ENGIE", amount_ht: -100, vat: 0, amount_ttc: -100, invoiceRef: undefined })], defaultAccountingConfig(), "2026", { advanceAccounts: { engie: { number: "409100", label: "Acomptes ENGIE" } }, evidenceTransactionIds: ["engie"] });
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "409100", debit: 100 }), expect.objectContaining({ accountNumber: "512100", credit: 100 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("6"))).toBe(false);
  });

  it("signale les catégories imprécises et les écritures incohérentes", () => {
    const preview = buildAccountingPreview([transaction({ category: "misc", amount_ht: -25 })], defaultAccountingConfig(), "2026");
    expect(preview.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNCATEGORIZED" }), expect.objectContaining({ code: "VAT_MISMATCH" }), expect.objectContaining({ code: "UNBALANCED_ENTRY" })]));
  });
});
