import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getActiveCompanyPath } from "./companiesService.js";

export type HrContractType = "cdi" | "cdd" | "apprenticeship" | "professionalization" | "internship";
export type HrVariableType = "bonus" | "absence" | "leave" | "overtime" | "benefit" | "expense" | "advance" | "other";
export type HrDocumentType = "contract" | "amendment" | "identity" | "medical" | "expense" | "payslip" | "other";
export interface HrEmployee { id: string; firstName: string; lastName: string; contractType: HrContractType; jobTitle?: string; startDate: string; endDate?: string; trialEndDate?: string; medicalVisitDate?: string; grossMonthly: number; netMonthly: number; employerCostMonthly: number; includeInForecast: boolean; active: boolean; notes?: string; }
export interface HrVariable { id: string; employeeId: string; month: string; type: HrVariableType; label: string; amount: number; quantity?: number; notes?: string; }
export interface HrDocument { id: string; employeeId: string; type: HrDocumentType; month?: string; originalName: string; storedName: string; uploadedAt: string; transactionId?: string; }
export interface HrDeadline { id: string; employeeId?: string; label: string; date: string; completed: boolean; kind: "contract" | "trial" | "medical" | "document" | "payroll" | "custom"; }
export interface HrPayrollMonth { month: string; status: "draft" | "ready" | "sent"; updatedAt: string; }
export interface HrStore { employees: HrEmployee[]; variables: HrVariable[]; documents: HrDocument[]; deadlines: HrDeadline[]; payrollMonths: HrPayrollMonth[]; }

const root = () => join(getActiveCompanyPath(), "hr");
const file = () => join(root(), "data.json");
export const hrDocumentsPath = () => join(root(), "documents");
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const validMonth = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
const finite = (value: unknown, positive = false) => typeof value === "number" && Number.isFinite(value) && (!positive || value >= 0);

export function isHrEmployee(value: unknown): value is HrEmployee {
  if (!value || typeof value !== "object") return false; const item = value as Partial<HrEmployee>;
  return typeof item.id === "string" && !!item.id && typeof item.firstName === "string" && !!item.firstName.trim() && typeof item.lastName === "string" && !!item.lastName.trim()
    && ["cdi", "cdd", "apprenticeship", "professionalization", "internship"].includes(item.contractType ?? "") && validDate(item.startDate)
    && [item.endDate, item.trialEndDate, item.medicalVisitDate].every((date) => date === undefined || date === "" || validDate(date))
    && [item.grossMonthly, item.netMonthly, item.employerCostMonthly].every((amount) => finite(amount, true)) && typeof item.includeInForecast === "boolean" && typeof item.active === "boolean";
}
export function isHrVariable(value: unknown): value is HrVariable {
  if (!value || typeof value !== "object") return false; const item = value as Partial<HrVariable>;
  return typeof item.id === "string" && typeof item.employeeId === "string" && validMonth(item.month) && ["bonus", "absence", "leave", "overtime", "benefit", "expense", "advance", "other"].includes(item.type ?? "") && typeof item.label === "string" && finite(item.amount);
}
export function isHrDeadline(value: unknown): value is HrDeadline {
  if (!value || typeof value !== "object") return false; const item = value as Partial<HrDeadline>;
  return typeof item.id === "string" && typeof item.label === "string" && validDate(item.date) && typeof item.completed === "boolean" && ["contract", "trial", "medical", "document", "payroll", "custom"].includes(item.kind ?? "");
}
export function isHrDocument(value: unknown): value is HrDocument {
  if (!value || typeof value !== "object") return false; const item = value as Partial<HrDocument>;
  return typeof item.id === "string" && typeof item.employeeId === "string" && typeof item.originalName === "string" && typeof item.storedName === "string" && typeof item.uploadedAt === "string" && ["contract", "amendment", "identity", "medical", "expense", "payslip", "other"].includes(item.type ?? "") && (item.month === undefined || validMonth(item.month));
}
export function isHrPayrollMonth(value: unknown): value is HrPayrollMonth { if (!value || typeof value !== "object") return false; const item = value as Partial<HrPayrollMonth>; return validMonth(item.month) && ["draft", "ready", "sent"].includes(item.status ?? "") && typeof item.updatedAt === "string"; }
const emptyStore = (): HrStore => ({ employees: [], variables: [], documents: [], deadlines: [], payrollMonths: [] });
export function loadHrStore(): HrStore {
  const legacy = join(root(), "employees.json"); const target = existsSync(file()) ? file() : legacy; if (!existsSync(target)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(target, "utf-8")) as unknown;
    if (Array.isArray(parsed)) return parsed.every(isHrEmployee) ? { ...emptyStore(), employees: parsed } : emptyStore();
    if (!parsed || typeof parsed !== "object") return emptyStore(); const data = parsed as Partial<HrStore>;
    return { employees: Array.isArray(data.employees) && data.employees.every(isHrEmployee) ? data.employees : [], variables: Array.isArray(data.variables) && data.variables.every(isHrVariable) ? data.variables : [], documents: Array.isArray(data.documents) && data.documents.every(isHrDocument) ? data.documents : [], deadlines: Array.isArray(data.deadlines) && data.deadlines.every(isHrDeadline) ? data.deadlines : [], payrollMonths: Array.isArray(data.payrollMonths) ? data.payrollMonths.filter(isHrPayrollMonth) : [] };
  } catch { return emptyStore(); }
}
export function saveHrStore(store: HrStore): void { mkdirSync(root(), { recursive: true }); atomicWriteFileSync(file(), JSON.stringify(store, null, 2)); }
export function loadHrEmployees(): HrEmployee[] { return loadHrStore().employees; }
export function saveHrEmployees(employees: HrEmployee[]): void { saveHrStore({ ...loadHrStore(), employees }); }
