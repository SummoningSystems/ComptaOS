import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import type { AccountingLine } from "./accountingExportService.js";

export type InventoryKind =
  | "customer_receivable" | "supplier_payable" | "depreciation"
  | "prepaid_expense" | "deferred_revenue" | "accrued_expense"
  | "accrued_income" | "vat_adjustment" | "shareholder_current_account"
  | "loan" | "corporate_tax" | "other";
export type InventoryEntryStatus = "draft" | "validated" | "cancelled";
export interface InventoryEntryLine { id: string; accountNumber: string; accountLabel: string; debit: number; credit: number }
export interface InventoryEntry {
  id: string; periodId: string; date: string; kind: InventoryKind; label: string; reference: string;
  lines: InventoryEntryLine[]; status: InventoryEntryStatus; createdAt: string; updatedAt: string;
  validatedAt?: string; cancelledAt?: string; cancellationReason?: string; reversalOf?: string;
}
export interface InventoryEntryInput { date: string; kind: InventoryKind; label: string; reference?: string; lines: InventoryEntryLine[] }
export interface InventoryPeriod { id: string; startDate: string; endDate: string }

const kinds: InventoryKind[] = ["customer_receivable", "supplier_payable", "depreciation", "prepaid_expense", "deferred_revenue", "accrued_expense", "accrued_income", "vat_adjustment", "shareholder_current_account", "loan", "corporate_tax", "other"];
const storePath = () => join(getWorkspaceRoot(), "settings", "annual-inventory.json");
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function loadStore(): InventoryEntry[] {
  if (!existsSync(storePath())) return [];
  try { const parsed = JSON.parse(readFileSync(storePath(), "utf8")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function saveStore(entries: InventoryEntry[]) { atomicWriteFileSync(storePath(), JSON.stringify(entries, null, 2)); }

export function validateInventoryInput(period: InventoryPeriod, input: InventoryEntryInput): InventoryEntryInput {
  const date = String(input.date ?? "").trim(); const label = String(input.label ?? "").trim(); const reference = String(input.reference ?? "").trim();
  if (date < period.startDate || date > period.endDate) throw new Error(`La date doit être comprise entre le ${period.startDate} et le ${period.endDate}.`);
  if (!kinds.includes(input.kind)) throw new Error("Type d’écriture d’inventaire invalide.");
  if (!label) throw new Error("Le libellé de l’écriture est obligatoire.");
  if (!Array.isArray(input.lines) || input.lines.length < 2) throw new Error("Une écriture doit comporter au moins deux lignes.");
  const lines = input.lines.map((item, index) => {
    const accountNumber = String(item.accountNumber ?? "").trim(); const accountLabel = String(item.accountLabel ?? "").trim();
    const debit = round(Number(item.debit) || 0); const credit = round(Number(item.credit) || 0);
    if (!/^\d{3,}$/.test(accountNumber)) throw new Error(`Ligne ${index + 1} : numéro de compte invalide.`);
    if (!accountLabel) throw new Error(`Ligne ${index + 1} : libellé de compte obligatoire.`);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw new Error(`Ligne ${index + 1} : renseigne un débit ou un crédit positif, pas les deux.`);
    if (debit === 0 && credit === 0) throw new Error(`Ligne ${index + 1} : montant nul.`);
    return { id: item.id || randomUUID(), accountNumber, accountLabel, debit, credit };
  });
  const debit = round(lines.reduce((sum, line) => sum + line.debit, 0)); const credit = round(lines.reduce((sum, line) => sum + line.credit, 0));
  if (debit !== credit) throw new Error(`Écriture déséquilibrée : ${debit.toFixed(2)} € au débit et ${credit.toFixed(2)} € au crédit.`);
  return { date, kind: input.kind, label, reference, lines };
}

export function listInventoryEntries(periodId: string) { return loadStore().filter((entry) => entry.periodId === periodId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)); }

export function createInventoryEntry(period: InventoryPeriod, input: InventoryEntryInput) {
  const clean = validateInventoryInput(period, input); const now = new Date().toISOString();
  const entry: InventoryEntry = { id: randomUUID(), periodId: period.id, ...clean, reference: clean.reference ?? "", status: "draft", createdAt: now, updatedAt: now };
  const entries = loadStore(); entries.push(entry); saveStore(entries); return entry;
}

export function updateInventoryEntry(period: InventoryPeriod, id: string, input: InventoryEntryInput) {
  const entries = loadStore(); const index = entries.findIndex((entry) => entry.id === id && entry.periodId === period.id);
  if (index < 0) throw new Error("Écriture d’inventaire introuvable.");
  if (entries[index].status !== "draft") throw new Error("Seule une écriture en brouillon peut être modifiée.");
  const clean = validateInventoryInput(period, input); entries[index] = { ...entries[index], ...clean, reference: clean.reference ?? "", updatedAt: new Date().toISOString() }; saveStore(entries); return entries[index];
}

export function validateInventoryEntry(periodId: string, id: string) {
  const entries = loadStore(); const index = entries.findIndex((entry) => entry.id === id && entry.periodId === periodId);
  if (index < 0) throw new Error("Écriture d’inventaire introuvable.");
  if (entries[index].status !== "draft") throw new Error("Cette écriture n’est plus en brouillon.");
  const now = new Date().toISOString(); entries[index] = { ...entries[index], status: "validated", validatedAt: now, updatedAt: now }; saveStore(entries); return entries[index];
}

export function cancelInventoryEntry(periodId: string, id: string, reason: string) {
  const entries = loadStore(); const index = entries.findIndex((entry) => entry.id === id && entry.periodId === periodId); const cancellationReason = String(reason ?? "").trim();
  if (index < 0) throw new Error("Écriture d’inventaire introuvable.");
  if (entries[index].status !== "validated" || entries[index].reversalOf) throw new Error("Seule une écriture validée peut être annulée.");
  if (!cancellationReason) throw new Error("Le motif d’annulation est obligatoire.");
  const now = new Date().toISOString(); const original = entries[index];
  entries[index] = { ...original, status: "cancelled", cancellationReason, cancelledAt: now, updatedAt: now };
  const reversal: InventoryEntry = { ...original, id: randomUUID(), label: `Contrepassation — ${original.label}`, reference: original.reference || original.id, lines: original.lines.map((line) => ({ ...line, id: randomUUID(), debit: line.credit, credit: line.debit })), status: "validated", createdAt: now, updatedAt: now, validatedAt: now, reversalOf: original.id, cancelledAt: undefined, cancellationReason: undefined };
  entries.push(reversal); saveStore(entries); return { original: entries[index], reversal };
}

export function deleteInventoryDraft(periodId: string, id: string) {
  const entries = loadStore(); const target = entries.find((entry) => entry.id === id && entry.periodId === periodId);
  if (!target) throw new Error("Écriture d’inventaire introuvable.");
  if (target.status !== "draft") throw new Error("Seul un brouillon peut être supprimé.");
  saveStore(entries.filter((entry) => entry.id !== id));
}

export function inventoryAccountingLines(periodId: string): AccountingLine[] {
  return listInventoryEntries(periodId).filter((entry) => entry.status !== "draft").flatMap((entry) => entry.lines.map((line) => ({
    journalCode: "OD", journalLabel: "Opérations diverses", entryNumber: `INV-${entry.id.slice(0, 8)}`, entryDate: entry.date,
    accountNumber: line.accountNumber, accountLabel: line.accountLabel, pieceRef: entry.reference || entry.id, pieceDate: entry.date,
    label: entry.label, debit: line.debit, credit: line.credit, transactionId: `inventory:${entry.id}`,
  })));
}
