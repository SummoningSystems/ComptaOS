import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getActiveCompanyPath, loadCompanies, resolveCompanyPath, type Company } from "./companiesService.js";
import type { AccountingLine as ExportLine } from "./accountingExportService.js";
import type { PlatformState } from "./platformService.js";

export interface PostedPortfolioLine { transferId: string; scopeId: string; date: string; label: string; accountCode: string; debit: number; credit: number; postedAt: string; reversedAt?: string; reversal?: boolean }
const filename = "portfolio_journal.json";
function read(root: string): PostedPortfolioLine[] { const file = join(root, "settings", filename); try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) as PostedPortfolioLine[] : []; } catch { return []; } }
function write(root: string, rows: PostedPortfolioLine[]): void { atomicWriteFileSync(join(root, "settings", filename), JSON.stringify(rows, null, 2)); }
function workspaceForScope(state: PlatformState, scopeId: string) { const entity = state.entities.find((item) => item.id === scopeId); return loadCompanies().find((company) => company.id === entity?.workspaceId || company.scopeId === scopeId); }

export function postPortfolioLines(state: PlatformState, transferId: string, date: string, rows: Array<{ scopeId: string; accountCode: string; label: string; debit: number; credit: number }>, postedAt: string): void {
  const resolved = rows.map((row) => ({ row, company: workspaceForScope(state, row.scopeId) }));
  const missing = resolved.find((item) => !item.company);
  if (missing) throw new Error(`Aucun dossier comptable actif pour ${missing.row.scopeId}.`);
  const grouped = new Map<string, { company: Company; rows: typeof rows }>();
  for (const item of resolved) {
    const company = item.company!;
    const group = grouped.get(company.id) ?? { company, rows: [] };
    group.rows.push(item.row);
    grouped.set(company.id, group);
  }
  for (const { company } of grouped.values()) {
    if (read(resolveCompanyPath(company)).some((row) => row.transferId === transferId && !row.reversedAt && !row.reversal)) throw new Error("Ce transfert est déjà comptabilisé.");
  }
  for (const { company, rows: scoped } of grouped.values()) {
    const root = resolveCompanyPath(company), existing = read(root);
    existing.push(...scoped.map((row) => ({ ...row, transferId, date, postedAt })));
    write(root, existing);
  }
}

export function reversePortfolioLines(state: PlatformState, transferId: string, reversedAt: string): void {
  for (const company of loadCompanies()) { const root = resolveCompanyPath(company), existing = read(root), active = existing.filter((row) => row.transferId === transferId && !row.reversedAt && !row.reversal); if (!active.length) continue; for (const row of active) row.reversedAt = reversedAt; existing.push(...active.map((row) => ({ ...row, date: reversedAt.slice(0, 10), label: `Contrepassation - ${row.label}`, debit: row.credit, credit: row.debit, postedAt: reversedAt, reversedAt: undefined, reversal: true }))); write(root, existing); }
}

export function loadPortfolioAccountingLines(): ExportLine[] {
  return read(getActiveCompanyPath()).map((row, index) => ({ journalCode: "OD", journalLabel: "Opérations diverses", entryNumber: `TR-${row.transferId.slice(-8)}-${String(index + 1).padStart(3, "0")}`, entryDate: row.date, accountNumber: row.accountCode, accountLabel: row.label, pieceRef: row.transferId, pieceDate: row.date, label: row.label, debit: row.debit, credit: row.credit, transactionId: row.transferId }));
}
