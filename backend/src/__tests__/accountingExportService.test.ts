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

  it("respecte les bornes d’un exercice décalé au lieu de l’année civile", () => {
    const preview = buildAccountingPreview([
      transaction({ id: "before", date: "2025-09-30" }),
      transaction({ id: "start", date: "2025-10-01" }),
      transaction({ id: "end", date: "2026-09-30" }),
      transaction({ id: "after", date: "2026-10-01" }),
    ], defaultAccountingConfig(), { startDate: "2025-10-01", endDate: "2026-09-30", label: "fy_2026" });
    expect(preview.eligibleCount).toBe(2);
    expect(new Set(preview.lines.map((line) => line.transactionId))).toEqual(new Set(["start", "end"]));
  });

  it("génère un FEC de 18 colonnes accepté par le validateur interne", () => {
    const preview = buildAccountingPreview([transaction()], defaultAccountingConfig(), "2026");
    const fec = generateFec(preview);
    expect(fec.split("\r\n")[0].split("|")).toEqual(FEC_HEADERS);
    expect(fec.trim().split("\r\n").every((row) => row.split("|").length === 18)).toBe(true);
    expect(validateFec(fec)).toEqual([]);
  });

  it("inclut les écritures de transfert validées dans l'export", () => {
    const extraLine = { journalCode: "OD", journalLabel: "Opérations diverses", entryNumber: "TR-0001", entryDate: "2026-08-20", accountNumber: "455100", accountLabel: "Compte courant d'associé", pieceRef: "transfer_1", pieceDate: "2026-08-20", label: "Avance associée", debit: 100, credit: 0, transactionId: "transfer_1" };
    const balancingLine = { ...extraLine, entryNumber: "TR-0002", accountNumber: "512100", accountLabel: "Banque", debit: 0, credit: 100 };
    const preview = buildAccountingPreview([], defaultAccountingConfig(), "2026", { extraLines: [extraLine, balancingLine] });
    expect(preview.lines).toEqual([extraLine, balancingLine]);
    expect(preview.balanced).toBe(true);
    expect(validateFec(generateFec(preview))).toEqual([]);
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

  it("comptabilise directement un acompte fournisseur débité au 4091 sans charge ni TVA", () => {
    const preview = buildAccountingPreview([transaction({ id: "engie-category", label: "ENGIE", category: "supplier_advance_payment", amount_ht: -60, vat: 0, vat_rate: 0, amount_ttc: -60 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "409100", debit: 60 }), expect.objectContaining({ accountNumber: "512100", credit: 60 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("6") || item.accountNumber.startsWith("445"))).toBe(false);
  });

  it("comptabilise un dépôt de garantie au 275 sans charge", () => {
    const preview = buildAccountingPreview([transaction({ id: "deposit", label: "Dépôt local", category: "security_deposit", amount_ht: -700, vat: 0, vat_rate: 0, amount_ttc: -700 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "275000", debit: 700 }), expect.objectContaining({ accountNumber: "512100", credit: 700 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("6"))).toBe(false);
  });

  it("solde l'impôt sur les sociétés antérieur au compte 444 sans nouvelle charge ni TVA", () => {
    const preview = buildAccountingPreview([transaction({ id: "is-payment", label: "SIE - IS 2025", category: "corporate_tax_payment", amount_ht: -548, vat: 0, vat_rate: 0, amount_ttc: -548 })], defaultAccountingConfig(), "2026");
    expect(preview.lines.filter((line) => line.transactionId === "is-payment")).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountNumber: "444000", debit: 548, credit: 0 }),
      expect.objectContaining({ accountNumber: "512100", debit: 0, credit: 548 }),
    ]));
    expect(preview.lines.some((line) => line.accountNumber.startsWith("6") || line.accountNumber === "445660")).toBe(false);
    expect(preview.anomalies).not.toContainEqual(expect.objectContaining({ code: "VAT_ON_BALANCE_SHEET_MOVEMENT" }));
  });


  it("place une opération inconnue au 471 et bloque la clôture", () => {
    const preview = buildAccountingPreview([transaction({ id: "unknown", label: "COMMANDE", category: "unidentified_transaction", amount_ht: -4.76, vat: 0, vat_rate: 0, amount_ttc: -4.76 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "471000", debit: 4.76 }), expect.objectContaining({ accountNumber: "512100", credit: 4.76 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("6") || item.accountNumber.startsWith("445"))).toBe(false);
    expect(preview.anomalies).toContainEqual(expect.objectContaining({ code: "UNIDENTIFIED_TRANSACTION", severity: "blocking", transactionId: "unknown" }));
  });

  it("comptabilise une dépense personnelle d'associé au 455 sans charge", () => {
    const preview = buildAccountingPreview([transaction({ id: "personal", label: "Achat personnel", category: "shareholder_personal_expense", amount_ht: -25, vat: 0, vat_rate: 0, amount_ttc: -25 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "455100", debit: 25 }), expect.objectContaining({ accountNumber: "512100", credit: 25 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("6") || item.accountNumber.startsWith("445"))).toBe(false);
    expect(preview.anomalies.some((item) => item.code === "UNIDENTIFIED_TRANSACTION")).toBe(false);
  });

  it("comptabilise un apport en compte courant d'associé au crédit du 455 sans produit ni TVA", () => {
    const preview = buildAccountingPreview([transaction({ id: "shareholder-contribution", label: "Avance en compte courant associé", category: "shareholder_current_account_contribution", amount_ht: 2000, vat: 0, vat_rate: 0, amount_ttc: 2000 })], defaultAccountingConfig(), "2026");
    expect(preview.lines).toEqual(expect.arrayContaining([expect.objectContaining({ accountNumber: "512100", debit: 2000 }), expect.objectContaining({ accountNumber: "455100", credit: 2000 })]));
    expect(preview.lines.some((item) => item.accountNumber.startsWith("7") || item.accountNumber.startsWith("445"))).toBe(false);
  });

  it("signale les catégories imprécises et les écritures incohérentes", () => {
    const preview = buildAccountingPreview([transaction({ category: "misc", amount_ht: -25 })], defaultAccountingConfig(), "2026");
    expect(preview.anomalies).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNCATEGORIZED" }), expect.objectContaining({ code: "VAT_MISMATCH" }), expect.objectContaining({ code: "UNBALANCED_ENTRY" })]));
  });
});
