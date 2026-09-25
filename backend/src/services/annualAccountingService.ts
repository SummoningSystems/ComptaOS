import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import type { AccountingAnomaly, AccountingLine, AccountingPreview } from "./accountingExportService.js";
import type { Transaction } from "../types/index.js";

export type ThirdPartyKind = "supplier" | "client";
export type AdjustmentType = "opening" | "accrual" | "prepaid" | "invoice_not_received" | "invoice_to_issue" | "provision" | "inventory" | "tax" | "other";

export interface ThirdPartyAccount {
  id: string; kind: ThirdPartyKind; name: string; accountNumber: string; notes?: string;
}
export interface ThirdPartyDocument {
  id: string; kind: "purchase" | "sale"; thirdPartyId: string; date: string; invoiceRef: string; label: string;
  amountHt: number; amountVat: number; amountTtc: number; operatingAccount: string; vatAccount: string;
  thirdPartyAccount: string; paymentTransactionIds: string[]; advanceTransactionIds: string[]; advanceAccount: string;
  attachment?: string; status: "draft" | "validated";
}

export interface SettlementInvoice {
  date: string; invoiceRef: string; amountHt: number; amountVat: number; amountTtc: number;
  supplierAccount: string; expenseAccount: string; vatAccount: string; attachment?: string;
  status: "draft" | "validated";
}

export interface RecurringEvidenceSchedule {
  id: string; supplier: string; label: string; reference: string; startDate: string; endDate: string;
  advanceAccount: string; transactionIds: string[]; attachment?: string; createdAt: string;
  settlement?: SettlementInvoice;
}

export interface AdjustmentEntry {
  id: string; year: string; date: string; type: AdjustmentType; label: string; debitAccount: string;
  debitLabel: string; creditAccount: string; creditLabel: string; amount: number; justification?: string;
  attachment?: string; status: "draft" | "validated";
}

export interface FixedAsset {
  id: string; label: string; acquisitionDate: string; cost: number; residualValue: number; durationYears: number;
  assetAccount: string; depreciationAccount: string; expenseAccount: string; attachment?: string;
  disposedDate?: string;
}

export interface FiscalAdjustment {
  id: string; year: string; kind: "reinstatement" | "deduction"; label: string; amount: number; notes?: string;
}

export type AnnualCheckId = "documents" | "bank" | "third_parties" | "inventory" | "assets" | "vat" | "payroll" | "tax" | "review";
export interface AnnualConfirmation { year: string; checks: Partial<Record<AnnualCheckId, boolean>>; notes?: string; }
export interface AnnualClosingRecord { year: string; status: "closed" | "reopened"; closedAt: string; fingerprint: string; reopenedAt?: string; reopenReason?: string; }

export interface AnnualWorkspace {
  version: 1; thirdParties: ThirdPartyAccount[]; documents: ThirdPartyDocument[]; schedules: RecurringEvidenceSchedule[];
  adjustments: AdjustmentEntry[]; assets: FixedAsset[]; fiscalAdjustments: FiscalAdjustment[];
  confirmations: AnnualConfirmation[]; closings: AnnualClosingRecord[];
}

const EMPTY: AnnualWorkspace = { version: 1, thirdParties: [], documents: [], schedules: [], adjustments: [], assets: [], fiscalAdjustments: [], confirmations: [], closings: [] };
const file = () => join(getWorkspaceRoot(), "accounting", "annual-workspace.json");
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validYear = (year: string) => /^20\d{2}$/.test(year);
const validAccount = (account: string) => /^\d{3,}$/.test(account.trim());

export function loadAnnualWorkspace(): AnnualWorkspace {
  if (!existsSync(file())) return structuredClone(EMPTY);
  try {
    const value = JSON.parse(readFileSync(file(), "utf8")) as Partial<AnnualWorkspace>;
    return { ...structuredClone(EMPTY), ...value, version: 1 };
  } catch { return structuredClone(EMPTY); }
}

export function saveAnnualWorkspace(value: AnnualWorkspace): AnnualWorkspace {
  atomicWriteFileSync(file(), JSON.stringify({ ...value, version: 1 }, null, 2));
  return value;
}

export function recurringEvidenceTransactionIds(workspace = loadAnnualWorkspace()): Set<string> {
  return new Set([
    ...workspace.schedules.filter((item) => Boolean(item.attachment)).flatMap((item) => item.transactionIds),
    ...workspace.documents.filter((item) => Boolean(item.attachment)).flatMap((item) => [...item.paymentTransactionIds, ...item.advanceTransactionIds]),
  ]);
}

export function annualYearLocked(workspace: AnnualWorkspace, year: string): boolean {
  return workspace.closings.some((item) => item.year === year && item.status === "closed");
}

export function assertAnnualYearOpen(workspace: AnnualWorkspace, year: string): void {
  if (annualYearLocked(workspace, year)) throw Object.assign(new Error(`L'exercice ${year} est clôturé. Réouvre-le avec un motif avant modification.`), { statusCode: 409 });
}

export function validateSchedule(input: Omit<RecurringEvidenceSchedule, "id" | "createdAt">): string[] {
  const errors: string[] = [];
  if (!input.supplier?.trim()) errors.push("Le fournisseur est obligatoire.");
  if (!input.label?.trim()) errors.push("Le libellé est obligatoire.");
  if (!/^\d{3,}$/.test(input.advanceAccount ?? "")) errors.push("Le compte d'acomptes doit être un compte PCG valide (4091 conseillé).");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate ?? "")) errors.push("Les dates de début et de fin sont obligatoires.");
  if (input.endDate < input.startDate) errors.push("La date de fin doit suivre la date de début.");
  return errors;
}

export function validateSettlement(input: SettlementInvoice): string[] {
  const errors: string[] = [];
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(input.date ?? "")) errors.push("La date de facture est obligatoire.");
  if (!input.invoiceRef?.trim()) errors.push("La référence de facture est obligatoire.");
  if (input.amountTtc <= 0 || input.amountHt < 0 || input.amountVat < 0) errors.push("Les montants doivent être positifs.");
  if (Math.abs(round(input.amountHt + input.amountVat - input.amountTtc)) > 0.01) errors.push("HT + TVA doit être égal au TTC.");
  for (const account of [input.supplierAccount, input.expenseAccount, input.vatAccount]) if (!validAccount(account)) errors.push(`Compte PCG invalide : ${account || "non renseigné"}.`);
  return [...new Set(errors)];
}

export function validateThirdPartyDocument(input: Omit<ThirdPartyDocument, "id">): string[] {
  const errors = validateSettlement({ date: input.date, invoiceRef: input.invoiceRef, amountHt: input.amountHt, amountVat: input.amountVat, amountTtc: input.amountTtc, supplierAccount: input.thirdPartyAccount, expenseAccount: input.operatingAccount, vatAccount: input.vatAccount, attachment: input.attachment, status: input.status });
  if (!input.thirdPartyId?.trim()) errors.push("Le tiers est obligatoire.");
  if (!["purchase", "sale"].includes(input.kind)) errors.push("Le type de facture est invalide.");
  if (!validAccount(input.advanceAccount)) errors.push("Le compte d'acompte est invalide.");
  return [...new Set(errors)];
}

export function annualDepreciation(asset: FixedAsset, year: string): number {
  if (!validYear(year) || asset.cost <= asset.residualValue || asset.durationYears <= 0 || asset.acquisitionDate.slice(0, 4) > year) return 0;
  if (asset.disposedDate && asset.disposedDate.slice(0, 4) < year) return 0;
  const annual = (asset.cost - asset.residualValue) / asset.durationYears;
  const acquisitionYear = Number(asset.acquisitionDate.slice(0, 4));
  const elapsedBefore = Math.max(0, Number(year) - acquisitionYear);
  const remaining = Math.max(0, asset.cost - asset.residualValue - annual * elapsedBefore);
  if (!remaining) return 0;
  if (Number(year) === acquisitionYear) {
    const start = new Date(`${asset.acquisitionDate}T00:00:00Z`);
    const end = new Date(`${year}-12-31T00:00:00Z`);
    const days = Math.max(1, Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1);
    return round(Math.min(remaining, annual * days / 365));
  }
  return round(Math.min(remaining, annual));
}

const manualLine = (id: string, date: string, ref: string, label: string, accountNumber: string, accountLabel: string, debit = 0, credit = 0): AccountingLine => ({
  journalCode: "OD", journalLabel: "Opérations diverses", entryNumber: id, entryDate: date,
  accountNumber, accountLabel, pieceRef: ref, pieceDate: date, label, debit: round(debit), credit: round(credit), transactionId: id,
});

export function annualAccountingOptions(workspace: AnnualWorkspace, year: string, transactions: Transaction[] = []): { advanceAccounts: Record<string, { number: string; label: string }>; evidenceTransactionIds: string[]; extraLines: AccountingLine[]; extraAnomalies: AccountingAnomaly[] } {
  const advanceAccounts: Record<string, { number: string; label: string }> = {};
  const evidenceTransactionIds: string[] = [];
  const extraLines: AccountingLine[] = [];
  const extraAnomalies: AccountingAnomaly[] = [];
  const transactionIdsForYear = new Set(transactions.filter((item) => item.date.startsWith(year)).map((item) => item.id));
  const linkOwners = new Map<string, string[]>();
  const registerLink = (id: string, owner: string) => linkOwners.set(id, [...(linkOwners.get(id) ?? []), owner]);
  for (const schedule of workspace.schedules) {
    for (const id of schedule.transactionIds) {
      registerLink(id, schedule.label);
      advanceAccounts[id] = { number: schedule.advanceAccount || "409100", label: `Acomptes versés - ${schedule.supplier}` };
      if (schedule.attachment) evidenceTransactionIds.push(id);
      else if (transactionIdsForYear.has(id)) extraAnomalies.push({ severity: "blocking", code: "MISSING_RECURRING_EVIDENCE", message: `${schedule.label} : échéancier ou contrat justificatif manquant.`, transactionId: id });
    }
    const invoice = schedule.settlement;
    if (!invoice || invoice.status !== "validated" || !invoice.date.startsWith(year)) continue;
    if (!invoice.attachment) extraAnomalies.push({ severity: "blocking", code: "MISSING_SETTLEMENT_INVOICE", message: `${schedule.label} : fichier de la facture de régularisation manquant.` });
    const entry = `REG-${year}-${schedule.id}`; const ref = invoice.invoiceRef;
    extraLines.push(manualLine(entry, invoice.date, ref, `${schedule.supplier} - facture de régularisation HT`, invoice.expenseAccount, schedule.label, invoice.amountHt, 0));
    if (invoice.amountVat) extraLines.push(manualLine(entry, invoice.date, ref, `${schedule.supplier} - TVA déductible`, invoice.vatAccount, "TVA déductible", invoice.amountVat, 0));
    extraLines.push(manualLine(entry, invoice.date, ref, `${schedule.supplier} - dette fournisseur`, invoice.supplierAccount, schedule.supplier, 0, invoice.amountTtc));
    const advances = round(Math.min(invoice.amountTtc, transactions.filter((item) => schedule.transactionIds.includes(item.id)).reduce((sum, item) => sum + Math.abs(item.amount_ttc), 0)));
    if (advances) {
      extraLines.push(manualLine(`${entry}-SOLDE`, invoice.date, ref, `${schedule.supplier} - imputation des acomptes`, invoice.supplierAccount, schedule.supplier, advances, 0));
      extraLines.push(manualLine(`${entry}-SOLDE`, invoice.date, ref, `${schedule.supplier} - acomptes imputés`, schedule.advanceAccount, `Acomptes versés - ${schedule.supplier}`, 0, advances));
    }
  }
  for (const document of workspace.documents) {
    for (const id of document.paymentTransactionIds) {
      registerLink(id, document.label);
      advanceAccounts[id] = { number: document.thirdPartyAccount, label: document.kind === "purchase" ? "Fournisseur" : "Client" };
      if (document.attachment) evidenceTransactionIds.push(id);
    }
    for (const id of document.advanceTransactionIds) {
      registerLink(id, document.label);
      advanceAccounts[id] = { number: document.advanceAccount, label: document.kind === "purchase" ? "Acomptes versés" : "Acomptes reçus" };
      if (document.attachment) evidenceTransactionIds.push(id);
    }
    if (document.status !== "validated" || !document.date.startsWith(year)) continue;
    const id = `FAC-${year}-${document.id}`;
    if (!document.attachment) extraAnomalies.push({ severity: "blocking", code: "MISSING_THIRD_PARTY_INVOICE", message: `${document.label} : fichier de facture manquant.` });
    if (document.kind === "purchase") {
      extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - HT`, document.operatingAccount, document.label, document.amountHt, 0));
      if (document.amountVat) extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - TVA`, document.vatAccount, "TVA déductible", document.amountVat, 0));
      extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - fournisseur`, document.thirdPartyAccount, "Fournisseur", 0, document.amountTtc));
      const advances = round(Math.min(document.amountTtc, transactions.filter((item) => document.advanceTransactionIds.includes(item.id)).reduce((sum, item) => sum + Math.abs(item.amount_ttc), 0)));
      if (advances) {
        extraLines.push(manualLine(`${id}-AC`, document.date, document.invoiceRef, `${document.label} - imputation acompte`, document.thirdPartyAccount, "Fournisseur", advances, 0));
        extraLines.push(manualLine(`${id}-AC`, document.date, document.invoiceRef, `${document.label} - acompte imputé`, document.advanceAccount, "Acomptes versés", 0, advances));
      }
    } else {
      extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - client`, document.thirdPartyAccount, "Client", document.amountTtc, 0));
      extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - HT`, document.operatingAccount, document.label, 0, document.amountHt));
      if (document.amountVat) extraLines.push(manualLine(id, document.date, document.invoiceRef, `${document.label} - TVA`, document.vatAccount, "TVA collectée", 0, document.amountVat));
      const advances = round(Math.min(document.amountTtc, transactions.filter((item) => document.advanceTransactionIds.includes(item.id)).reduce((sum, item) => sum + Math.abs(item.amount_ttc), 0)));
      if (advances) {
        extraLines.push(manualLine(`${id}-AC`, document.date, document.invoiceRef, `${document.label} - acompte imputé`, document.advanceAccount, "Acomptes reçus", advances, 0));
        extraLines.push(manualLine(`${id}-AC`, document.date, document.invoiceRef, `${document.label} - imputation acompte`, document.thirdPartyAccount, "Client", 0, advances));
      }
    }
  }
  for (const item of workspace.adjustments.filter((entry) => entry.year === year && entry.status === "validated")) {
    extraLines.push(manualLine(`OD-${year}-${item.id}`, item.date, item.attachment || item.id, item.label, item.debitAccount, item.debitLabel, item.amount, 0));
    extraLines.push(manualLine(`OD-${year}-${item.id}`, item.date, item.attachment || item.id, item.label, item.creditAccount, item.creditLabel, 0, item.amount));
  }
  for (const asset of workspace.assets) {
    const amount = annualDepreciation(asset, year); if (!amount) continue;
    extraLines.push(manualLine(`AMO-${year}-${asset.id}`, `${year}-12-31`, asset.attachment || asset.id, `Dotation ${asset.label}`, asset.expenseAccount, "Dotations aux amortissements", amount, 0));
    extraLines.push(manualLine(`AMO-${year}-${asset.id}`, `${year}-12-31`, asset.attachment || asset.id, `Amortissement ${asset.label}`, asset.depreciationAccount, `Amortissement ${asset.label}`, 0, amount));
  }
  for (const [transactionId, owners] of linkOwners) if (owners.length > 1 && transactionIdsForYear.has(transactionId)) extraAnomalies.push({ severity: "blocking", code: "DUPLICATE_ACCOUNTING_LINK", message: `Le mouvement est lié plusieurs fois : ${owners.join(", ")}.`, transactionId });
  return { advanceAccounts, evidenceTransactionIds: [...new Set(evidenceTransactionIds)], extraLines, extraAnomalies };
}

export function buildAnnualStatements(preview: AccountingPreview, workspace: AnnualWorkspace, year: string) {
  const balances = preview.balances;
  const charges = round(balances.filter((item) => item.accountNumber.startsWith("6")).reduce((sum, item) => sum + item.debit - item.credit, 0));
  const revenue = round(balances.filter((item) => item.accountNumber.startsWith("7")).reduce((sum, item) => sum + item.credit - item.debit, 0));
  const accountingResult = round(revenue - charges);
  const fiscal = workspace.fiscalAdjustments.filter((item) => item.year === year);
  const reinstatements = round(fiscal.filter((item) => item.kind === "reinstatement").reduce((sum, item) => sum + item.amount, 0));
  const deductions = round(fiscal.filter((item) => item.kind === "deduction").reduce((sum, item) => sum + item.amount, 0));
  const taxableResult = round(accountingResult + reinstatements - deductions);
  const assets = balances.filter((item) => /^[2-5]/.test(item.accountNumber) && item.balance >= 0).map((item) => ({ account: item.accountNumber, label: item.accountLabel, amount: item.balance }));
  const liabilities = balances.filter((item) => /^[1-5]/.test(item.accountNumber) && item.balance < 0).map((item) => ({ account: item.accountNumber, label: item.accountLabel, amount: Math.abs(item.balance) }));
  const checks = workspace.confirmations.find((item) => item.year === year)?.checks ?? {};
  const required: AnnualCheckId[] = ["documents", "bank", "third_parties", "inventory", "assets", "vat", "payroll", "tax", "review"];
  const checklist = required.map((id) => ({ id, done: checks[id] === true }));
  return {
    year, profitAndLoss: { revenue, charges, accountingResult }, balanceSheet: { assets, liabilities, balanced: round(assets.reduce((s, i) => s + i.amount, 0) - liabilities.reduce((s, i) => s + i.amount, 0)) === 0 },
    fiscal: { accountingResult, reinstatements, deductions, taxableResult }, checklist,
    forms: {
      form2065: { status: "draft", taxableResult, warning: "Brouillon préparatoire : contrôle et télétransmission obligatoires hors ComptaOS." },
      simplified2033: { status: "draft", revenue, charges, accountingResult, assetsTotal: round(assets.reduce((s, i) => s + i.amount, 0)), liabilitiesTotal: round(liabilities.reduce((s, i) => s + i.amount, 0)) },
      normal2050: { status: "draft", sameSource: "balance générale détaillée", accountCount: balances.length },
      ediTdfc: { connected: false, exportable: false, message: "Aucun partenaire EDI-TDFC agréé n'est connecté." },
    },
  };
}

export function annualFingerprint(workspace: AnnualWorkspace, preview: AccountingPreview, year: string): string {
  const documents = workspace.documents.filter((item) => item.date.startsWith(year));
  const usedThirdPartyIds = new Set(documents.map((item) => item.thirdPartyId));
  const schedules = workspace.schedules
    .filter((item) => item.startDate.slice(0, 4) <= year && item.endDate.slice(0, 4) >= year || item.settlement?.date.startsWith(year))
    .map((item) => ({ ...item, settlement: item.settlement?.date.startsWith(year) ? item.settlement : undefined }));
  const payload = {
    year,
    balances: preview.balances,
    schedules,
    documents,
    thirdParties: workspace.thirdParties.filter((item) => usedThirdPartyIds.has(item.id)),
    adjustments: workspace.adjustments.filter((item) => item.year === year),
    assets: workspace.assets.filter((item) => item.acquisitionDate.slice(0, 4) <= year),
    fiscal: workspace.fiscalAdjustments.filter((item) => item.year === year),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
