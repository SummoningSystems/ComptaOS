import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { getActiveCompanyPath } from "./companiesService.js";
import { atomicWriteFileSync } from "./atomicFile.js";

function getManualFile(): string {
  return join(getActiveCompanyPath(), "settings", "manual_recurring.json");
}

export interface ManualRecurring {
  id: string;
  label: string;
  category: string;
  amount: number; // montant positif (dépense)
  frequency: "mensuel" | "trimestriel" | "annuel";
  nextPayment: string; // ISO YYYY-MM-DD
  active: boolean;
}

export function loadManualRecurring(): ManualRecurring[] {
  const file = getManualFile();
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as ManualRecurring[];
  } catch {
    return [];
  }
}

export function saveManualRecurring(entries: ManualRecurring[]): void {
  const file = getManualFile();
  atomicWriteFileSync(file, JSON.stringify(entries, null, 2));
}
