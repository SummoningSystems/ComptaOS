import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PortfolioView } from "../components/Platform/PortfolioView";

const api = vi.hoisted(() => ({ platform: vi.fn(), portfolio: vi.fn(), create: vi.fn(), remove: vi.fn(), createCommitment: vi.fn(), removeCommitment: vi.fn(), assumptions: vi.fn(), advance: vi.fn(), correct: vi.fn() }));
vi.mock("../api/client", () => ({ fetchPlatformState: api.platform, fetchPortfolio: api.portfolio, createPortfolioTransfer: api.create, deletePortfolioTransfer: api.remove, createPortfolioCommitment: api.createCommitment, deletePortfolioCommitment: api.removeCommitment, savePortfolioAssumptions: api.assumptions, advancePortfolioTransfer: api.advance, correctPortfolioTransfer: api.correct }));

describe("PortfolioView", () => {
  beforeEach(() => {
    api.platform.mockResolvedValue({ people: [{ id: "person_1", kind: "person", name: "Alice" }], households: [{ id: "house_1", kind: "household", name: "Foyer Alice" }], entities: [{ id: "entity_1", kind: "entity", name: "Holding" }], accounts: [], relations: [], grants: [], revision: 1, schemaVersion: 1, updatedAt: "2026-10-01" });
    const forecast = [{ month: "2026-10", openingBalance: 10000, income: 3000, expenses: 1500, transfersIn: 0, transfersOut: 0, closingBalance: 11500, items: [] }];
    api.portfolio.mockResolvedValue({ rootScopeId: "person_1", scopes: [{ id: "person_1", kind: "person", name: "Alice" }, { id: "house_1", kind: "household", name: "Foyer Alice" }, { id: "entity_1", kind: "entity", name: "Holding" }], suggestedScopeIds: ["person_1", "house_1", "entity_1"], selectedScopeIds: ["person_1", "house_1", "entity_1"], balance: 10000, averageIncome: 3000, averageExpenses: 1200, transfers: [], commitments: [], transferCandidates: [], forecast, forecasts: { prudent: forecast, probable: forecast, optimistic: forecast }, assumptions: { prudent: { revenueMultiplier: .7, expenseMultiplier: 1.1, safetyBuffer: 0 }, probable: { revenueMultiplier: 1, expenseMultiplier: 1, safetyBuffer: 0 }, optimistic: { revenueMultiplier: 1.2, expenseMultiplier: .95, safetyBuffer: 0 } }, positions: [{ scopeId: "person_1", name: "Alice", balance: 10000, vatReserve: 0, commitments90Days: 0, available: 10000 }], timeline: [], ownership: [{ scopeId: "person_1", name: "Alice", ownershipPercent: 100, minorityPercent: 0, balance: 10000, groupShare: 10000, minorityShare: 0 }], consolidation: { grossBalance: 10000, groupShareBalance: 10000, minorityShareBalance: 0, eliminatedTransfers: 0, eliminatedAmount: 0, reciprocalAccounts: [] }, explanations: [{ id: "consolidation:balance", label: "Trésorerie consolidée", total: 10000, lines: [] }] });
  });

  it("affiche les périmètres, les transferts et la prévision consolidée", async () => {
    render(<PortfolioView />);
    expect(await screen.findByText("Transferts et prévision consolidée")).toBeInTheDocument();
    expect(await screen.findByText("Trésorerie consolidée")).toBeInTheDocument();
    expect(screen.getAllByText("Foyer Alice").length).toBeGreaterThan(0);
    expect(screen.getByText("Aucun transfert explicite.")).toBeInTheDocument();
    expect(api.portfolio).toHaveBeenCalledWith("person_1", [], 12, expect.any(String));
    fireEvent.click(screen.getByRole("button", { name: /trésorerie consolidée/i }));
    expect(screen.getAllByText("Trésorerie consolidée")).toHaveLength(2);
  });

  it("corrige et annule un transfert avec des formulaires accessibles", async () => {
    const base = await api.portfolio();
    const transfer = { id: "transfer_1", kind: "confirmed", sourceScopeId: "person_1", destinationScopeId: "entity_1", amount: 100, fee: 2, date: "2026-10-02", label: "Avance", treatment: "shareholder_current_account", accountingLines: [], workflowStatus: "proposed", workflowHistory: [], createdAt: "2026-10-02T10:00:00Z" };
    api.portfolio.mockResolvedValue({ ...base, transfers: [transfer] });
    api.correct.mockResolvedValue({ ...transfer, amount: 120 });
    api.advance.mockResolvedValue({ ...transfer, workflowStatus: "cancelled" });
    render(<PortfolioView />);
    await screen.findByText("Avance");
    fireEvent.click(screen.getByRole("button", { name: "Corriger" }));
    const correction = screen.getByRole("dialog", { name: "Corriger le transfert" });
    fireEvent.change(screen.getByLabelText("Motif obligatoire"), { target: { value: "Montant confirmé sur le relevé" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la correction" }));
    expect(api.correct).toHaveBeenCalledWith("transfer_1", expect.objectContaining({ note: "Montant confirmé sur le relevé", amount: 100, fee: 2 }));
    expect(correction).toBeInTheDocument();
  });
});
