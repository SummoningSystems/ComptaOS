import { describe, expect, it } from "vitest";
import { isHrEmployee } from "../services/hrService.js";

describe("hrService", () => {
  it("valide un dossier RH minimal sans donnée personnelle sensible", () => {
    expect(isHrEmployee({ id: "e1", firstName: "Alice", lastName: "Martin", contractType: "apprenticeship", startDate: "2026-09-01", endDate: "2027-08-31", grossMonthly: 1200, netMonthly: 1150, employerCostMonthly: 1350, includeInForecast: true, active: true })).toBe(true);
  });
  it("refuse les montants négatifs et dates invalides", () => {
    expect(isHrEmployee({ id: "e1", firstName: "Alice", lastName: "Martin", contractType: "cdi", startDate: "demain", grossMonthly: -1, netMonthly: 0, employerCostMonthly: 0, includeInForecast: true, active: true })).toBe(false);
  });
});
