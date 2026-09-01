import { describe, expect, it } from "vitest";
import { isHrDeadline, isHrDocument, isHrEmployee, isHrPayrollMonth, isHrVariable } from "../services/hrService.js";

describe("hrService", () => {
  it("valide un dossier RH minimal", () => {
    expect(isHrEmployee({ id: "e1", firstName: "Alice", lastName: "Martin", contractType: "apprenticeship", startDate: "2026-09-01", endDate: "2027-08-31", trialEndDate: "2026-10-31", grossMonthly: 1200, netMonthly: 1150, employerCostMonthly: 1350, includeInForecast: true, active: true })).toBe(true);
  });
  it("refuse les montants négatifs et dates invalides", () => {
    expect(isHrEmployee({ id: "e1", firstName: "Alice", lastName: "Martin", contractType: "cdi", startDate: "demain", grossMonthly: -1, netMonthly: 0, employerCostMonthly: 0, includeInForecast: true, active: true })).toBe(false);
  });
  it("valide les variables mensuelles, échéances et bulletins", () => {
    expect(isHrVariable({ id: "v1", employeeId: "e1", month: "2026-09", type: "overtime", label: "4 heures", amount: 120, quantity: 4 })).toBe(true);
    expect(isHrDeadline({ id: "d1", label: "Visite médicale", date: "2026-10-12", completed: false, kind: "medical" })).toBe(true);
    expect(isHrDocument({ id: "p1", employeeId: "e1", type: "payslip", month: "2026-09", originalName: "bulletin.pdf", storedName: "p1.pdf", uploadedAt: "2026-09-30T10:00:00.000Z" })).toBe(true);
    expect(isHrPayrollMonth({ month: "2026-09", status: "ready", updatedAt: "2026-09-25T10:00:00.000Z" })).toBe(true);
  });
  it("refuse un mois ou un type de variable invalide", () => {
    expect(isHrVariable({ id: "v1", employeeId: "e1", month: "septembre", type: "bonus", label: "Prime", amount: 10 })).toBe(false);
    expect(isHrVariable({ id: "v1", employeeId: "e1", month: "2026-09", type: "inconnu", label: "Prime", amount: 10 })).toBe(false);
  });
});
