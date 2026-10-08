import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";

export type FiscalAdjustmentType = "reintegration" | "deduction";
export type FiscalAdjustmentKind = "corporate_tax" | "fines_penalties" | "non_deductible_expense" | "excess_depreciation" | "vehicle_adjustment" | "loss_carryforward" | "other_reintegration" | "other_deduction";
export type FiscalAdjustmentStatus = "draft" | "validated" | "cancelled";
export interface FiscalAdjustment {
  id: string; periodId: string; type: FiscalAdjustmentType; kind: FiscalAdjustmentKind; label: string;
  amount: number; accountNumber: string; reference: string; status: FiscalAdjustmentStatus;
  createdAt: string; updatedAt: string; validatedAt?: string; cancelledAt?: string; cancellationReason?: string;
}
export interface FiscalAdjustmentInput { type: FiscalAdjustmentType; kind: FiscalAdjustmentKind; label: string; amount: number; accountNumber?: string; reference?: string }
interface FiscalStore { adjustments: FiscalAdjustment[]; reviews: Record<string, { confirmed: boolean; note: string; updatedAt: string }> }

const storePath = () => join(getWorkspaceRoot(), "settings", "annual-fiscal.json");
const kinds: FiscalAdjustmentKind[] = ["corporate_tax", "fines_penalties", "non_deductible_expense", "excess_depreciation", "vehicle_adjustment", "loss_carryforward", "other_reintegration", "other_deduction"];
const expectedType: Record<FiscalAdjustmentKind, FiscalAdjustmentType> = { corporate_tax: "reintegration", fines_penalties: "reintegration", non_deductible_expense: "reintegration", excess_depreciation: "reintegration", vehicle_adjustment: "reintegration", loss_carryforward: "deduction", other_reintegration: "reintegration", other_deduction: "deduction" };
const emptyStore = (): FiscalStore => ({ adjustments: [], reviews: {} });
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function loadStore(): FiscalStore {
  if (!existsSync(storePath())) return emptyStore();
  try { const value = JSON.parse(readFileSync(storePath(), "utf8")); return { adjustments: Array.isArray(value?.adjustments) ? value.adjustments : [], reviews: value?.reviews && typeof value.reviews === "object" ? value.reviews : {} }; }
  catch { return emptyStore(); }
}
function saveStore(store: FiscalStore) { atomicWriteFileSync(storePath(), JSON.stringify(store, null, 2)); }
function clean(input: FiscalAdjustmentInput): FiscalAdjustmentInput & { accountNumber: string; reference: string } {
  const type = input.type; const kind = input.kind; const label = String(input.label ?? "").trim(); const amount = round(Number(input.amount)); const accountNumber = String(input.accountNumber ?? "").trim(); const reference = String(input.reference ?? "").trim();
  if (!(type === "reintegration" || type === "deduction")) throw new Error("Sens de correction fiscale invalide.");
  if (!kinds.includes(kind)) throw new Error("Nature de correction fiscale invalide.");
  if (expectedType[kind] !== type) throw new Error("Le sens de la correction ne correspond pas à sa nature.");
  if (!label) throw new Error("Le libellé de la correction fiscale est obligatoire.");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Le montant doit être strictement positif.");
  if (accountNumber && !/^\d{3,}$/.test(accountNumber)) throw new Error("Le compte associé doit comporter au moins trois chiffres.");
  return { type, kind, label, amount, accountNumber, reference };
}

export function listFiscalAdjustments(periodId: string) { return loadStore().adjustments.filter((item) => item.periodId === periodId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function getFiscalReview(periodId: string) { return loadStore().reviews[periodId] ?? { confirmed: false, note: "", updatedAt: new Date(0).toISOString() }; }

export function createFiscalAdjustment(periodId: string, input: FiscalAdjustmentInput) {
  const store = loadStore(); const now = new Date().toISOString(); const adjustment: FiscalAdjustment = { id: randomUUID(), periodId, ...clean(input), status: "draft", createdAt: now, updatedAt: now };
  store.adjustments.push(adjustment); store.reviews[periodId] = { confirmed: false, note: store.reviews[periodId]?.note ?? "", updatedAt: now }; saveStore(store); return adjustment;
}
export function updateFiscalAdjustment(periodId: string, id: string, input: FiscalAdjustmentInput) {
  const store = loadStore(); const index = store.adjustments.findIndex((item) => item.periodId === periodId && item.id === id);
  if (index < 0) throw new Error("Correction fiscale introuvable.");
  if (store.adjustments[index].status !== "draft") throw new Error("Seul un brouillon peut être modifié.");
  store.adjustments[index] = { ...store.adjustments[index], ...clean(input), updatedAt: new Date().toISOString() }; store.reviews[periodId] = { confirmed: false, note: store.reviews[periodId]?.note ?? "", updatedAt: new Date().toISOString() }; saveStore(store); return store.adjustments[index];
}
export function validateFiscalAdjustment(periodId: string, id: string) {
  const store = loadStore(); const index = store.adjustments.findIndex((item) => item.periodId === periodId && item.id === id);
  if (index < 0) throw new Error("Correction fiscale introuvable.");
  if (store.adjustments[index].status !== "draft") throw new Error("Cette correction n’est plus en brouillon.");
  const now = new Date().toISOString(); store.adjustments[index] = { ...store.adjustments[index], status: "validated", validatedAt: now, updatedAt: now }; store.reviews[periodId] = { confirmed: false, note: store.reviews[periodId]?.note ?? "", updatedAt: now }; saveStore(store); return store.adjustments[index];
}
export function cancelFiscalAdjustment(periodId: string, id: string, reason: string) {
  const store = loadStore(); const index = store.adjustments.findIndex((item) => item.periodId === periodId && item.id === id); const cancellationReason = String(reason ?? "").trim();
  if (index < 0) throw new Error("Correction fiscale introuvable.");
  if (store.adjustments[index].status !== "validated") throw new Error("Seule une correction validée peut être annulée.");
  if (!cancellationReason) throw new Error("Le motif d’annulation est obligatoire.");
  const now = new Date().toISOString(); store.adjustments[index] = { ...store.adjustments[index], status: "cancelled", cancellationReason, cancelledAt: now, updatedAt: now }; store.reviews[periodId] = { confirmed: false, note: store.reviews[periodId]?.note ?? "", updatedAt: now }; saveStore(store); return store.adjustments[index];
}
export function deleteFiscalDraft(periodId: string, id: string) {
  const store = loadStore(); const target = store.adjustments.find((item) => item.periodId === periodId && item.id === id);
  if (!target) throw new Error("Correction fiscale introuvable.");
  if (target.status !== "draft") throw new Error("Seul un brouillon peut être supprimé.");
  store.adjustments = store.adjustments.filter((item) => item.id !== id); store.reviews[periodId] = { confirmed: false, note: store.reviews[periodId]?.note ?? "", updatedAt: new Date().toISOString() }; saveStore(store);
}
export function saveFiscalReview(periodId: string, confirmed: boolean, note: string) {
  const store = loadStore();
  if (confirmed && store.adjustments.some((item) => item.periodId === periodId && item.status === "draft")) throw new Error("Valide ou supprime les corrections fiscales en brouillon avant de confirmer la revue.");
  store.reviews[periodId] = { confirmed: confirmed === true, note: String(note ?? "").trim(), updatedAt: new Date().toISOString() }; saveStore(store); return store.reviews[periodId];
}
