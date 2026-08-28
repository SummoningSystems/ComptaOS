import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transactions: [] as Array<Record<string, unknown>>,
  connections: [] as Array<Record<string, unknown>>,
  recurring: [] as Array<Record<string, unknown>>,
}));

vi.mock("../services/transactionService.js", () => ({
  loadAllTransactions: async () => state.transactions,
}));

vi.mock("../services/manualRecurringService.js", () => ({
  loadManualRecurring: () => state.recurring,
}));

vi.mock("../services/bankingService.js", () => ({
  getConnections: async () => state.connections,
}));

vi.mock("../services/settingsService.js", () => ({
  loadCompanyProfile: () => ({ name: "Test", vatRegime: "monthly_ca3" }),
}));

import { computeDashboard } from "../services/dashboardService.js";

describe("dashboard bank balance", () => {
  beforeEach(() => {
    state.transactions = [{
      id: "txn_1", date: "2026-08-01", label: "Achat", amount_ht: -50, amount_ttc: -50,
      vat: 0, category: "misc", status: "pending", account: "7",
    }];
    state.connections = [];
    state.recurring = [];
  });

  it("projette les échéances réelles et respecte les décisions", async () => {
    state.recurring = [
      { id: "monthly", label: "Abonnement", category: "subscription", amount: 100, frequency: "mensuel", nextPayment: "2026-09-05", active: true, decision: "reduce", simulatedAmount: 80 },
      { id: "annual", label: "Assurance", category: "insurance", amount: 600, frequency: "annuel", nextPayment: "2026-11-10", active: true },
      { id: "cancelled", label: "Ancien outil", category: "software", amount: 50, frequency: "mensuel", nextPayment: "2026-09-01", active: true, decision: "cancel" },
    ];

    const { buildDashboardForecast } = await import("../services/dashboardService.js");
    const forecast = buildDashboardForecast(state.recurring as never, [] as never, 2_000, "2026-08-28");

    expect(forecast.map((month) => month.expenses)).toEqual([80, 80, 680, 80, 80, 80]);
    expect(forecast[0].items.map((item) => item.label)).toEqual(["Abonnement"]);
    expect(forecast[2].items.map((item) => item.label)).toEqual(["Abonnement", "Assurance"]);
    expect(forecast.at(-1)?.balance).toBe(920);
  });

  it("nomme le cumul des transactions comme une variation en l'absence de banque", async () => {
    const dashboard = await computeDashboard();

    expect(dashboard.treasury).toBe(-50);
    expect(dashboard.transaction_flow).toBe(-50);
    expect(dashboard.accounting_result).toBe(-50);
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
