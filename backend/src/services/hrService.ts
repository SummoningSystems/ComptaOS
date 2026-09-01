import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getActiveCompanyPath } from "./companiesService.js";

export type HrContractType = "cdi" | "cdd" | "apprenticeship" | "professionalization" | "internship";

export interface HrEmployee {
  id: string;
  firstName: string;
  lastName: string;
  contractType: HrContractType;
  jobTitle?: string;
  startDate: string;
  endDate?: string;
  grossMonthly: number;
  netMonthly: number;
  employerCostMonthly: number;
  includeInForecast: boolean;
  active: boolean;
  notes?: string;
}

const file = () => join(getActiveCompanyPath(), "hr", "employees.json");
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function isHrEmployee(value: unknown): value is HrEmployee {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<HrEmployee>;
  return typeof item.id === "string" && item.id.length > 0
    && typeof item.firstName === "string" && item.firstName.trim().length > 0
    && typeof item.lastName === "string" && item.lastName.trim().length > 0
    && ["cdi", "cdd", "apprenticeship", "professionalization", "internship"].includes(item.contractType ?? "")
    && validDate(item.startDate) && (item.endDate === undefined || item.endDate === "" || validDate(item.endDate))
    && [item.grossMonthly, item.netMonthly, item.employerCostMonthly].every((amount) => typeof amount === "number" && Number.isFinite(amount) && amount >= 0)
    && typeof item.includeInForecast === "boolean" && typeof item.active === "boolean";
}

export function loadHrEmployees(): HrEmployee[] {
  if (!existsSync(file())) return [];
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf-8")) as unknown;
    return Array.isArray(parsed) && parsed.every(isHrEmployee) ? parsed : [];
  } catch { return []; }
}

export function saveHrEmployees(employees: HrEmployee[]): void {
  mkdirSync(join(getActiveCompanyPath(), "hr"), { recursive: true });
  atomicWriteFileSync(file(), JSON.stringify(employees, null, 2));
}
