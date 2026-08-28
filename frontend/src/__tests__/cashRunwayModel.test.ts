import { describe, expect, it } from "vitest";
import type { ManualRecurring, Transaction } from "../types";
import { buildCashRunwayProjection } from "../components/Treasury/cashRunwayModel";

const recurring: ManualRecurring[] = [{ id: "rent", label: "Loyer", category: "rent", amount: 500, frequency: "mensuel", nextPayment: "2026-08-05", active: true, decision: "keep" }];
const income = (id: string, date: string): Transaction => ({ id, date, label: "Client", amount_ht: 1_000, vat: 200, amount_ttc: 1_200, currency: "EUR", category: "sales", account: "main", status: "validated" });

describe("simulateur d'autonomie de trésorerie", () => {
  it("compare revenus moyens et absence totale de nouvel encaissement", () => {
    const result = buildCashRunwayProjection({ recurring, transactions: [income("june", "2026-06-10"), income("july", "2026-07-10")], startBalance: 2_000, monthsAhead: 3, investment: 0, safetyReserve: 0, today: "2026-08-01" });
    expect(result.averageRevenue).toBe(800);
    expect(result.totalCommittedExpenses).toBe(1_500);
    expect(result.months.at(-1)).toMatchObject({ realisticBalance: 2_900, zeroRevenueBalance: 500 });
    expect(result.investmentCapacity).toBe(500);
    expect(result.zeroRevenueRunwayMonths).toBeNull();
  });

  it("mesure l'impact d'un investissement et d'une réserve de sécurité", () => {
    const result = buildCashRunwayProjection({ recurring, transactions: [], startBalance: 2_000, monthsAhead: 4, investment: 600, safetyReserve: 300, today: "2026-08-01" });
    expect(result.investmentCapacity).toBe(0);
    expect(result.zeroRevenueRunwayMonths).toBe(2);
    expect(result.months.at(-1)?.zeroRevenueBalance).toBe(-600);
  });
});
