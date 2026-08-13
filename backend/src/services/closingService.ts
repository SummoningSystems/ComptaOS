import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Transaction } from "../types/index.js";
import { atomicWriteFile } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";

export interface MonthlyClosing {
  month: string;
  status: "closed" | "reopened";
  closedAt: string;
  closedBy: string;
  fingerprint: string;
  transactionCount: number;
  reopenedAt?: string;
  reopenedBy?: string;
  reopenReason?: string;
}

const filePath = () => path.join(getWorkspaceRoot(), "settings", "monthly-closings.json");
const validMonth = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
const stableTransactions = (transactions: Transaction[], month: string) => transactions
  .filter((item) => item.date.startsWith(month))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(({ id, date, label, amount_ht, vat, amount_ttc, category, account, status, reconciled, justified, invoiceRef, vat_splits, attachment, attachments }) => ({ id, date, label, amount_ht, vat, amount_ttc, category, account, status, reconciled, justified, invoiceRef, vat_splits, attachment, attachments }));

export function closingFingerprint(transactions: Transaction[], month: string): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableTransactions(transactions, month))).digest("hex");
}

export async function loadClosings(): Promise<MonthlyClosing[]> {
  try { const value = JSON.parse(await fs.readFile(filePath(), "utf8")); return Array.isArray(value) ? value : []; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}

async function saveClosings(items: MonthlyClosing[]): Promise<void> {
  await fs.mkdir(path.dirname(filePath()), { recursive: true });
  await atomicWriteFile(filePath(), JSON.stringify(items, null, 2));
}

export async function activeClosing(month: string): Promise<MonthlyClosing | undefined> {
  return (await loadClosings()).find((item) => item.month === month && item.status === "closed");
}

export async function assertMonthOpen(date: string): Promise<void> {
  const month = date.slice(0, 7); const closing = validMonth(month) ? await activeClosing(month) : undefined;
  if (closing) { const error = new Error(`Le mois ${month} est clôturé. Réouvre-le avec un motif avant toute modification.`) as Error & { statusCode?: number }; error.statusCode = 409; throw error; }
}

export async function closeMonth(month: string, transactions: Transaction[], closedBy = "utilisateur"): Promise<MonthlyClosing> {
  if (!validMonth(month)) throw new Error("Mois invalide");
  const items = await loadClosings();
  if (items.some((item) => item.month === month && item.status === "closed")) throw new Error(`Le mois ${month} est déjà clôturé`);
  const transactionCount = transactions.filter((item) => item.date.startsWith(month)).length;
  const record: MonthlyClosing = { month, status: "closed", closedAt: new Date().toISOString(), closedBy, fingerprint: closingFingerprint(transactions, month), transactionCount };
  await saveClosings([record, ...items]); return record;
}

export async function reopenMonth(month: string, reason: string, reopenedBy = "utilisateur"): Promise<MonthlyClosing> {
  if (!reason.trim()) throw new Error("Un motif de réouverture est obligatoire");
  const items = await loadClosings(); const index = items.findIndex((item) => item.month === month && item.status === "closed");
  if (index < 0) throw new Error(`Le mois ${month} n'est pas clôturé`);
  items[index] = { ...items[index], status: "reopened", reopenedAt: new Date().toISOString(), reopenedBy, reopenReason: reason.trim() };
  await saveClosings(items); return items[index];
}
