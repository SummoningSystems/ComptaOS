import { describe, expect, it } from "vitest";
import { isManualRecurring } from "../services/manualRecurringService.js";

describe("manualRecurringService", () => {
  it("accepte un scénario de réduction valide", () => {
    expect(isManualRecurring({ id: "rent", label: "Loyer", category: "rent", amount: 1000, frequency: "mensuel", nextPayment: "2026-09-01", active: true, decision: "reduce", simulatedAmount: 800 })).toBe(true);
  });
  it("refuse les montants négatifs et les dates non ISO", () => {
    expect(isManualRecurring({ id: "bad", label: "Test", category: "misc", amount: -10, frequency: "mensuel", nextPayment: "demain", active: true })).toBe(false);
  });
});
