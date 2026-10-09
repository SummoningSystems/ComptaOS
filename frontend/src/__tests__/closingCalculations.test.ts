import { describe, expect, it } from "vitest";
import { customerReceivableAmounts, depreciationSuggestion } from "../components/AnnualClosing/closingCalculations";

describe("assistants de clôture", () => {
  it("ventile une facture client HT, TVA et TTC", () => {
    expect(customerReceivableAmounts(4000, 20)).toEqual({ ht: 4000, vat: 800, ttc: 4800 });
  });

  it("calcule une annuité complète sans dépasser la valeur brute", () => {
    expect(depreciationSuggestion({ grossValue: 883, usefulLifeYears: 3, openingAccumulatedDepreciation: 194, inServiceDate: "2025-02-01", periodStart: "2025-10-01", periodEnd: "2026-09-30" })).toEqual({ annual: 294.33, months: 12, amount: 294.33, closingAccumulated: 488.33, netBookValue: 394.67 });
    expect(depreciationSuggestion({ grossValue: 100, usefulLifeYears: 3, openingAccumulatedDepreciation: 90, inServiceDate: "2020-01-01", periodStart: "2025-10-01", periodEnd: "2026-09-30" }).amount).toBe(10);
  });
});
