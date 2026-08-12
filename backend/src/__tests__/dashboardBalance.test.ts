import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transactions: [] as Array<Record<string, unknown>>,
  connections: [] as Array<Record<string, unknown>>,
}));

vi.mock("../services/transactionService.js", () => ({
  loadAllTransactions: async () => state.transactions,
}));

vi.mock("../services/manualRecurringService.js", () => ({
  loadManualRecurring: () => [],
}));

vi.mock("../services/bankingService.js", () => ({
  getConnections: async () => state.connections,
}));

import { computeDashboard } from "../services/dashboardService.js";

describe("dashboard bank balance", () => {
  beforeEach(() => {
    state.transactions = [{
      id: "txn_1", date: "2026-08-01", label: "Achat", amount_ttc: -50,
      vat: 0, category: "misc", status: "pending", account: "7",
    }];
    state.connections = [];
  });

  it("nomme le cumul des transactions comme une variation en l'absence de banque", async () => {
    const dashboard = await computeDashboard();

    expect(dashboard.treasury).toBe(-50);
    expect(dashboard.transaction_flow).toBe(-50);
    expect(dashboard.bank_balance).toBeUndefined();
    expect(dashboard.monthly_balance.at(-1)?.amount).toBe(-50);
  });

  it("utilise le solde bancaire comme référence et conserve la variation séparément", async () => {
    state.connections = [{
      connectionId: 1, connectorName: "Banque", createdAt: "2026-08-01", status: "active",
      accounts: [{ id: 7, name: "Compte pro", currency: "EUR", balance: 1072.13, balanceUpdatedAt: "2026-08-12T08:00:00.000Z" }],
    }];

    const dashboard = await computeDashboard();

    expect(dashboard.treasury).toBe(1072.13);
    expect(dashboard.bank_balance).toBe(1072.13);
    expect(dashboard.transaction_flow).toBe(-50);
    expect(dashboard.balance_difference).toBe(1122.13);
    expect(dashboard.monthly_balance.at(-1)?.amount).toBe(1072.13);
    expect(dashboard.forecast[0]?.balance).toBeGreaterThan(1000);
  });
});
