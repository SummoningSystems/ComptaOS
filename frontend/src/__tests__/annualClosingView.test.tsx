import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnualClosingView } from "../components/AnnualClosing/AnnualClosingView";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("../api/client", () => ({ api: mocks }));

const snapshot = {
  availablePeriods: [{ id: "fy", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" }], period: { id: "fy", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" },
  record: { profitTaxRegime: "unknown", openingBalance: [], review: { bankBalance: false, customersAndSuppliers: false, fixedAssets: false, vat: false, accruals: false, equityLoansAndShareholders: false }, updatedAt: "2026-10-08" },
  transactionSummary: { total: 122, pending: 12, unreconciled: 35, misc: 19, missingEvidence: 49, missingFiles: 0 }, openingBalanceSummary: { lines: 0, debit: 0, credit: 0, balanced: true },
  inventoryEntries: [], inventorySummary: { total: 0, draft: 0, posted: 0, cancelled: 0, debit: 0, credit: 0, balanced: true },
  accountingSummary: { eligibleTransactions: 87, excludedTransactions: 35, lines: 174, debit: 1000, credit: 1000, balanced: true, anomalies: [], balances: [{ accountNumber: "706000", accountLabel: "Prestations", debit: 0, credit: 1000, balance: -1000 }] },
  fiscalAdjustments: [], fiscalReview: { confirmed: false, note: "", updatedAt: "2026-10-08" }, fiscalSummary: { charges: 500, products: 1000, accountingResult: 500, reintegrations: 0, deductions: 0, fiscalResult: 500, taxableProfit: 500, taxLoss: 0, draft: 0, validated: 0 },
  taxConfig: { turnoverOverride: null, belongsToGroup: null, groupTurnover: null, capitalFullyPaid: null, naturalPersonOwnershipPercent: null, hasSpecialTaxRegime: null, taxCredits: 0, prepayments: 0, reviewed: false, note: "", updatedAt: "2026-10-08" },
  taxCalculation: { months: 12, reducedThreshold: 42500, automaticTurnover: 1000, turnover: 1000, eligibilityTurnover: 1000, conditionsComplete: false, reducedRateEligible: false, taxableBase: 500, reducedBase: 0, normalBase: 500, reducedTax: 0, normalTax: 125, grossTax: 125, taxCredits: 0, netTax: 125, prepayments: 0, balance: 125, reviewed: false, ready: false, warnings: ["Conditions incomplètes"] },
  simplifiedStatements: { balanceSheet: { assets: [], fixedAssetsTotal: 0, currentAssetsTotal: 1000, totalAssets: 1000, liabilities: [], equityTotal: 1000, debtsTotal: 0, totalLiabilities: 1000, difference: 0 }, profitAndLoss: { fields: [] }, fiscalTable: { fields: [] } },
  deadlines: { resultDeclaration: "2026-12-31", corporateTaxBalance: "2027-01-15" }, completed: 0, total: 13, dataReady: false, filingReady: false,
  steps: [{ id: "transactions", label: "Opérations validées", status: "blocked", detail: "12 opération(s) encore en attente", count: 12 }, { id: "statutory-output", label: "Comptes annuels et liasse", status: "blocked", detail: "Génération verrouillée" }],
};

describe("AnnualClosingView", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ data: snapshot }); mocks.put.mockResolvedValue({ data: snapshot }); });
  it("affiche la période réelle et distingue préparation et dépôt", async () => {
    render(<AnnualClosingView />);
    expect(await screen.findByText("Clôture annuelle guidée")).toBeInTheDocument();
    expect(screen.getByText("Déclaration non encore déposable.")).toBeInTheDocument();
    expect(screen.getByText("12 opération(s) encore en attente")).toBeInTheDocument();
    expect(screen.getByText("Journal d’inventaire")).toBeInTheDocument();
    expect(screen.getByText("Balance après inventaire et résultat fiscal")).toBeInTheDocument();
    expect(screen.getByText("Impôt sur les sociétés et pré-remplissage 2033")).toBeInTheDocument();
    expect(screen.getAllByText("01/10/2025", { exact: false })).toHaveLength(2);
  });
  it("enregistre explicitement la confirmation de la revue fiscale", async () => {
    render(<AnnualClosingView />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmer la revue fiscale" }));
    await waitFor(() => expect(mocks.put).toHaveBeenCalledWith("/annual-closing/fy/fiscal-review", { confirmed: true, note: "" }));
  });
});
