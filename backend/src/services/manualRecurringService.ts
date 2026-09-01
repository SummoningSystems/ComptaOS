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
  endPayment?: string;
  active: boolean;
  decision?: "keep" | "reduce" | "cancel" | "planned";
  simulatedAmount?: number;
  notes?: string;
}

export function isManualRecurring(value: unknown): value is ManualRecurring {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ManualRecurring>;
  return typeof item.id === "string" && item.id.length > 0 && typeof item.label === "string" && item.label.trim().length > 0 && typeof item.category === "string" && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount > 0 && ["mensuel", "trimestriel", "annuel"].includes(item.frequency ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(item.nextPayment ?? "") && (item.endPayment === undefined || /^\d{4}-\d{2}-\d{2}$/.test(item.endPayment)) && typeof item.active === "boolean" && (item.decision === undefined || ["keep", "reduce", "cancel", "planned"].includes(item.decision)) && (item.simulatedAmount === undefined || (Number.isFinite(item.simulatedAmount) && item.simulatedAmount >= 0));
}

export function loadManualRecurring(): ManualRecurring[] {
  const file = getManualFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as unknown;
    if (!Array.isArray(parsed) || !parsed.every(isManualRecurring)) throw new Error("Le fichier des frais récurrents contient une entrée invalide.");
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.includes("entrée invalide")) throw error;
    return [];
  }
}

export function saveManualRecurring(entries: ManualRecurring[]): void {
  const file = getManualFile();
  atomicWriteFileSync(file, JSON.stringify(entries, null, 2));
}
