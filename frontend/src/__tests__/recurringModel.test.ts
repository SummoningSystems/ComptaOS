import { describe, expect, it } from "vitest";
import type { ManualRecurring, Transaction } from "../types";
import { addCalendarMonths, annualEquivalent, buildForecast, detectRecurring, monthlyEquivalent, removeManualDuplicates, scenarioAmount } from "../components/Recurring/recurringModel";

const transaction = (id: string, date: string, label: string, amount: number): Transaction => ({ id, date, label, amount_ht: amount, vat: 0, amount_ttc: amount, currency: "EUR", category: "software", account: "main", status: "validated" });
const manual = (overrides: Partial<ManualRecurring> = {}): ManualRecurring => ({ id: "manual_1", label: "Adobe", category: "software", amount: 120, frequency: "annuel", nextPayment: "2026-12-31", active: true, decision: "keep", ...overrides });

describe("pilotage des frais récurrents", () => {
  it("regroupe les variantes de libellé PSD2 d'un même fournisseur", () => {
    const patterns = detectRecurring([transaction("1", "2026-05-05", "CB ADOBE 1234", -19.99), transaction("2", "2026-06-05", "PAIEMENT ADOBE 9876", -19.99), transaction("3", "2026-07-05", "ADOBE", -21.99)], "2026-07-10");
    expect(patterns).toHaveLength(1); expect(patterns[0]).toMatchObject({ key: "adobe", frequency: "mensuel", occurrences: 3, nextPayment: "2026-08-05" });
  });
  it("mensualise correctement les frais trimestriels et annuels", () => {
    expect(monthlyEquivalent(300, "trimestriel")).toBe(100); expect(monthlyEquivalent(1200, "annuel")).toBe(100); expect(annualEquivalent(300, "trimestriel")).toBe(1200);
  });
  it("conserve le jour de fin de mois sans dérive", () => { expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28"); });
  it("évite le doublon entre une récurrence confirmée et la détection bancaire", () => {
    const patterns = detectRecurring([transaction("1", "2026-05-05", "ADOBE", -20), transaction("2", "2026-06-05", "CB ADOBE 999", -20)], "2026-06-10");
    expect(removeManualDuplicates(patterns, [manual({ label: "Adobe abonnement", frequency: "mensuel" })])).toEqual([]);
  });
  it("applique les décisions de réduction ou suppression", () => {
    expect(scenarioAmount(manual({ decision: "reduce", simulatedAmount: 80 }))).toBe(80); expect(scenarioAmount(manual({ decision: "cancel" }))).toBe(0);
  });
  it("projette les échéances par mois calendaire et intègre les recettes moyennes", () => {
    const forecast = buildForecast([{ id: "rent", label: "Loyer", amount: 500, frequency: "mensuel", nextPayment: "2026-08-31", active: true }], [transaction("r1", "2026-06-10", "Client", 1000), transaction("r2", "2026-07-10", "Client", 1000)], 2, 2000, "2026-08-04");
    expect(forecast.map((month) => ({ month: month.month, expenses: month.expenses, balance: month.balance }))).toEqual([{ month: "2026-08", expenses: 500, balance: 2500 }, { month: "2026-09", expenses: 500, balance: 3000 }]);
  });
});
