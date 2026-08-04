import { existsSync } from "fs";
import { basename, join } from "path";
import { Transaction } from "../types/index.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { AccountingAccount, AccountingConfig, loadCompanyProfile } from "./settingsService.js";

export interface AccountingLine {
  journalCode: string; journalLabel: string; entryNumber: string; entryDate: string;
  accountNumber: string; accountLabel: string; pieceRef: string; pieceDate: string;
  label: string; debit: number; credit: number; transactionId: string;
}
export interface AccountingAnomaly {
  severity: "blocking" | "warning"; code: string; message: string; transactionId?: string;
}
export interface AccountBalance { accountNumber: string; accountLabel: string; debit: number; credit: number; balance: number; }
export interface AccountingPreview {
  year: string; eligibleCount: number; excludedCount: number; lines: AccountingLine[];
  balances: AccountBalance[]; anomalies: AccountingAnomaly[]; totalDebit: number; totalCredit: number; balanced: boolean;
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validAccount = (account: AccountingAccount) => /^\d{3,}$/.test(account.number.trim()) && account.label.trim().length > 0;
const line = (base: Omit<AccountingLine, "accountNumber" | "accountLabel" | "debit" | "credit" | "label">, account: AccountingAccount, labelText: string, debit = 0, credit = 0): AccountingLine => ({ ...base, accountNumber: account.number, accountLabel: account.label, label: labelText, debit: round(debit), credit: round(credit) });

function vatParts(transaction: Transaction, expectedVat: number): Array<{ rate?: number; amount: number }> {
  if (!transaction.vat_splits?.length || expectedVat === 0) return expectedVat ? [{ rate: transaction.vat_rate, amount: expectedVat }] : [];
  const parts = transaction.vat_splits.map((split) => ({
    rate: split.rate,
    amount: round(Math.abs(split.amount_ttc) - Math.abs(split.amount_ttc) / (1 + split.rate / 100)),
  }));
  const delta = round(expectedVat - parts.reduce((sum, part) => sum + part.amount, 0));
  if (parts.length) parts[parts.length - 1].amount = round(parts[parts.length - 1].amount + delta);
  return parts.filter((part) => part.amount !== 0);
}

export function buildAccountingPreview(transactions: Transaction[], config: AccountingConfig, year: string): AccountingPreview {
  const inYear = transactions.filter((transaction) => transaction.date.startsWith(year) && transaction.status !== "rejected");
  const eligible = inYear.filter((transaction) => transaction.status === "validated" && transaction.reconciled === true);
  const anomalies: AccountingAnomaly[] = [];
  const accounts = [config.bank, config.revenue, config.vatDeductible, config.vatCollected, ...Object.values(config.categories)];
  for (const account of accounts) if (!validAccount(account)) anomalies.push({ severity: "blocking", code: "INVALID_ACCOUNT", message: `Compte PCG invalide : ${account.number || "non renseigné"} (${account.label || "sans libellé"}).` });
  const profile = loadCompanyProfile();
  if (!/^\d{9}$/.test((profile.siren ?? "").replace(/\s/g, ""))) anomalies.push({ severity: "blocking", code: "MISSING_SIREN", message: "Le SIREN à 9 chiffres est obligatoire pour nommer un FEC officiel." });
  if (inYear.length > eligible.length) anomalies.push({ severity: "warning", code: "EXCLUDED_TRANSACTIONS", message: `${inYear.length - eligible.length} opération(s) non validée(s) ou non rapprochée(s) seront exclues.` });

  const lines: AccountingLine[] = [];
  eligible.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).forEach((transaction, index) => {
    if (transaction.category === "misc") anomalies.push({ severity: "blocking", code: "UNCATEGORIZED", message: "La catégorie doit être précisée.", transactionId: transaction.id });
    if (!Number.isFinite(transaction.amount_ht) || !Number.isFinite(transaction.vat) || !Number.isFinite(transaction.amount_ttc)) anomalies.push({ severity: "blocking", code: "INVALID_AMOUNT", message: "Un montant comptable est invalide.", transactionId: transaction.id });
    if (Math.abs(round(transaction.amount_ht + transaction.vat - transaction.amount_ttc)) > 0.01) anomalies.push({ severity: "blocking", code: "VAT_MISMATCH", message: "HT + TVA ne correspond pas au TTC.", transactionId: transaction.id });
    if (transaction.attachment && !existsSync(join(getWorkspaceRoot(), "attachments", basename(transaction.attachment)))) anomalies.push({ severity: "blocking", code: "MISSING_ATTACHMENT", message: `Le justificatif ${transaction.attachment} est introuvable.`, transactionId: transaction.id });
    if (transaction.amount_ttc < 0 && !transaction.attachment && !transaction.invoiceRef && !transaction.justified) anomalies.push({ severity: "blocking", code: "MISSING_EVIDENCE", message: "La dépense n'a aucun justificatif ni référence.", transactionId: transaction.id });
    const base = { journalCode: "BQ", journalLabel: "Banque", entryNumber: `${year}-${String(index + 1).padStart(6, "0")}`, entryDate: transaction.date, pieceRef: transaction.invoiceRef || transaction.id, pieceDate: transaction.date, transactionId: transaction.id };
    const ht = Math.abs(round(transaction.amount_ht)); const vat = Math.abs(round(transaction.vat)); const ttc = Math.abs(round(transaction.amount_ttc));
    if (transaction.amount_ttc < 0) {
      lines.push(line(base, config.categories[transaction.category], `${transaction.label} - HT`, ht, 0));
      for (const part of vatParts(transaction, vat)) lines.push(line(base, config.vatDeductible, `${transaction.label} - TVA${part.rate === undefined ? "" : ` ${part.rate} %`}`, part.amount, 0));
      lines.push(line(base, config.bank, `${transaction.label} - TTC`, 0, ttc));
    } else {
      lines.push(line(base, config.bank, `${transaction.label} - TTC`, ttc, 0));
      lines.push(line(base, config.revenue, `${transaction.label} - HT`, 0, ht));
      for (const part of vatParts(transaction, vat)) lines.push(line(base, config.vatCollected, `${transaction.label} - TVA${part.rate === undefined ? "" : ` ${part.rate} %`}`, 0, part.amount));
    }
    const entryLines = lines.filter((item) => item.transactionId === transaction.id);
    const debit = round(entryLines.reduce((sum, item) => sum + item.debit, 0)); const credit = round(entryLines.reduce((sum, item) => sum + item.credit, 0));
    if (debit !== credit) anomalies.push({ severity: "blocking", code: "UNBALANCED_ENTRY", message: `Écriture déséquilibrée : débit ${debit.toFixed(2)} €, crédit ${credit.toFixed(2)} €.`, transactionId: transaction.id });
  });
  const balanceMap = new Map<string, AccountBalance>();
  for (const item of lines) { const current = balanceMap.get(item.accountNumber) ?? { accountNumber: item.accountNumber, accountLabel: item.accountLabel, debit: 0, credit: 0, balance: 0 }; current.debit = round(current.debit + item.debit); current.credit = round(current.credit + item.credit); current.balance = round(current.debit - current.credit); balanceMap.set(item.accountNumber, current); }
  const totalDebit = round(lines.reduce((sum, item) => sum + item.debit, 0)); const totalCredit = round(lines.reduce((sum, item) => sum + item.credit, 0));
  if (totalDebit !== totalCredit) anomalies.push({ severity: "blocking", code: "UNBALANCED_LEDGER", message: "Le journal global n'est pas équilibré." });
  return { year, eligibleCount: eligible.length, excludedCount: inYear.length - eligible.length, lines, balances: [...balanceMap.values()].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber)), anomalies, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

const fecDate = (date: string) => date.replaceAll("-", "");
const fecAmount = (amount: number) => amount.toFixed(2);
const fecCell = (value: string) => value.replace(/[|\r\n\t]/g, " ").trim().slice(0, 200);
export const FEC_HEADERS = ["JournalCode", "JournalLib", "EcritureNum", "EcritureDate", "CompteNum", "CompteLib", "CompAuxNum", "CompAuxLib", "PieceRef", "PieceDate", "EcritureLib", "Debit", "Credit", "EcritureLet", "DateLet", "ValidDate", "Montantdevise", "Idevise"];
export function generateFec(preview: AccountingPreview): string {
  const rows = preview.lines.map((item) => [item.journalCode, item.journalLabel, item.entryNumber, fecDate(item.entryDate), item.accountNumber, item.accountLabel, "", "", item.pieceRef, fecDate(item.pieceDate), item.label, fecAmount(item.debit), fecAmount(item.credit), "", "", fecDate(item.entryDate), "", ""].map((value) => fecCell(value)).join("|"));
  return [FEC_HEADERS.join("|"), ...rows].join("\r\n") + "\r\n";
}

export function validateFec(content: string): string[] {
  const rows = content.trimEnd().split(/\r?\n/); const errors: string[] = [];
  if (rows[0] !== FEC_HEADERS.join("|")) errors.push("En-tête FEC non conforme.");
  rows.slice(1).forEach((row, index) => { const fields = row.split("|"); if (fields.length !== 18) errors.push(`Ligne ${index + 2}: 18 champs attendus.`); if (!/^\d{8}$/.test(fields[3] ?? "")) errors.push(`Ligne ${index + 2}: date invalide.`); if (!/^\d{3,}$/.test(fields[4] ?? "")) errors.push(`Ligne ${index + 2}: compte invalide.`); if (!/^\d+\.\d{2}$/.test(fields[11] ?? "") || !/^\d+\.\d{2}$/.test(fields[12] ?? "")) errors.push(`Ligne ${index + 2}: montant invalide.`); });
  return errors;
}

const csvCell = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
export function generateJournalCsv(preview: AccountingPreview): string { return "\uFEFF" + [["N° écriture", "Date", "Compte", "Libellé compte", "Libellé", "Débit", "Crédit", "Pièce"].map(csvCell).join(";"), ...preview.lines.map((item) => [item.entryNumber, item.entryDate, item.accountNumber, item.accountLabel, item.label, fecAmount(item.debit), fecAmount(item.credit), item.pieceRef].map(csvCell).join(";"))].join("\r\n"); }
export function generateBalanceCsv(preview: AccountingPreview): string { return "\uFEFF" + [["Compte", "Libellé", "Débit", "Crédit", "Solde"].map(csvCell).join(";"), ...preview.balances.map((item) => [item.accountNumber, item.accountLabel, fecAmount(item.debit), fecAmount(item.credit), fecAmount(item.balance)].map(csvCell).join(";"))].join("\r\n"); }
