import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AnnualClosingView } from "../components/AnnualClosing/AnnualClosingView";

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../api/client", () => ({ api: mocks }));

const snapshot = {
  availablePeriods: [{ id: "fy", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" }], period: { id: "fy", startDate: "2025-10-01", endDate: "2026-09-30", label: "2e exercice" },
  record: { profitTaxRegime: "unknown", openingBalance: [], review: { bankBalance: false, customersAndSuppliers: false, fixedAssets: false, vat: false, accruals: false, equityLoansAndShareholders: false }, updatedAt: "2026-10-08" },
  transactionSummary: { total: 122, pending: 12, unreconciled: 35, misc: 19, missingEvidence: 49, missingFiles: 0 }, openingBalanceSummary: { lines: 0, debit: 0, credit: 0, balanced: true },
  deadlines: { resultDeclaration: "2026-12-31", corporateTaxBalance: "2027-01-15" }, completed: 0, total: 13, dataReady: false, filingReady: false,
  steps: [{ id: "transactions", label: "Opérations validées", status: "blocked", detail: "12 opération(s) encore en attente", count: 12 }, { id: "statutory-output", label: "Comptes annuels et liasse", status: "blocked", detail: "Génération verrouillée" }],
};

describe("AnnualClosingView", () => {
  beforeEach(() => { mocks.get.mockResolvedValue({ data: snapshot }); mocks.put.mockResolvedValue({ data: snapshot }); });
  it("affiche la période réelle et distingue préparation et dépôt", async () => {
    render(<AnnualClosingView />);
    expect(await screen.findByText("Clôture annuelle guidée")).toBeInTheDocument();
    expect(screen.getByText("Déclaration non encore déposable.")).toBeInTheDocument();
    expect(screen.getByText("12 opération(s) encore en attente")).toBeInTheDocument();
    expect(screen.getAllByText("01/10/2025", { exact: false })).toHaveLength(2);
  });
});
