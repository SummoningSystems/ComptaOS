import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot } from "./companiesService.js";

function file(): string { return join(getCompaniesRoot(), "_user_contexts.json"); }
function read(): Record<string, string> {
  if (!existsSync(file())) return {};
  try { const value = JSON.parse(readFileSync(file(), "utf-8")); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
export function getSelectedCompany(userId: string): string | undefined { return read()[userId]; }
export function setSelectedCompany(userId: string, companyId: string): void { atomicWriteFileSync(file(), JSON.stringify({ ...read(), [userId]: companyId }, null, 2)); }
