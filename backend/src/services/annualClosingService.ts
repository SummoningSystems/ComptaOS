import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { needsTransactionEvidence } from "./transactionEvidenceService.js";
import { inventoryAccountingLines, listInventoryEntries } from "./annualInventoryService.js";
import { buildAccountingPreview, type AccountingLine } from "./accountingExportService.js";
import { loadAccountingConfig } from "./settingsService.js";
import { loadPortfolioAccountingLines } from "./portfolioJournalService.js";
import { getFiscalReview, listFiscalAdjustments } from "./annualFiscalService.js";
import { buildSimplifiedStatements, calculateCorporateTax, getAnnualTaxConfig } from "./annualTaxService.js";
import type { Transaction } from "../types/index.js";

export type ProfitTaxRegime = "simplified" | "normal" | "unknown";
export interface FiscalPeriod { id: string; startDate: string; endDate: string; label?: string }
export interface OpeningBalanceLine { id: string; accountNumber: string; accountLabel: string; debit: number; credit: number }
export interface AnnualReview {
  bankBalance: boolean;
  customersAndSuppliers: boolean;
  fixedAssets: boolean;
  vat: boolean;
  accruals: boolean;
  equityLoansAndShareholders: boolean;
}
export interface AnnualClosingRecord {
  periodId: string;
  startDate: string;
  endDate: string;
  label: string;
  profitTaxRegime: ProfitTaxRegime;
  openingBalance: OpeningBalanceLine[];
  review: AnnualReview;
  updatedAt: string;
}
export interface AnnualClosingStep { id: string; label: string; status: "done" | "warning" | "blocked"; detail: string; count?: number }

const emptyReview = (): AnnualReview => ({ bankBalance: false, customersAndSuppliers: false, fixedAssets: false, vat: false, accruals: false, equityLoansAndShareholders: false });
const storePath = () => join(getWorkspaceRoot(), "settings", "annual-closing.json");
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function loadStore(): AnnualClosingRecord[] {
  if (!existsSync(storePath())) return [];
  try { const value = JSON.parse(readFileSync(storePath(), "utf8")); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

function saveStore(records: AnnualClosingRecord[]) {
  atomicWriteFileSync(storePath(), JSON.stringify(records, null, 2));
}

export function getAnnualClosingRecord(period: FiscalPeriod): AnnualClosingRecord {
  const existing = loadStore().find((record) => record.periodId === period.id);
  return existing ?? { periodId: period.id, startDate: period.startDate, endDate: period.endDate, label: period.label?.trim() || `Exercice ${period.startDate} au ${period.endDate}`, profitTaxRegime: "unknown", openingBalance: [], review: emptyReview(), updatedAt: new Date(0).toISOString() };
}

function persist(period: FiscalPeriod, update: (record: AnnualClosingRecord) => void) {
  const records = loadStore(); const index = records.findIndex((record) => record.periodId === period.id); const record = index >= 0 ? records[index] : getAnnualClosingRecord(period);
  record.startDate = period.startDate; record.endDate = period.endDate; record.label = period.label?.trim() || record.label; update(record); record.updatedAt = new Date().toISOString();
  if (index >= 0) records[index] = record; else records.push(record); saveStore(records); return record;
}

export function saveAnnualSetup(period: FiscalPeriod, profitTaxRegime: ProfitTaxRegime) {
  if (!(["simplified", "normal", "unknown"] as string[]).includes(profitTaxRegime)) throw new Error("Régime d’imposition des bénéfices invalide.");
  return persist(period, (record) => { record.profitTaxRegime = profitTaxRegime; });
}

export function validateOpeningBalance(lines: OpeningBalanceLine[]) {
  if (!Array.isArray(lines)) throw new Error("Balance d’ouverture invalide.");
  const clean = lines.map((item, index) => {
    const accountNumber = String(item.accountNumber ?? "").trim(); const accountLabel = String(item.accountLabel ?? "").trim(); const debit = round(Number(item.debit) || 0); const credit = round(Number(item.credit) || 0);
    if (!/^\d{3,}$/.test(accountNumber)) throw new Error(`Ligne ${index + 1} : numéro de compte invalide.`);
    if (!accountLabel) throw new Error(`Ligne ${index + 1} : libellé de compte obligatoire.`);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw new Error(`Ligne ${index + 1} : renseigne un débit ou un crédit positif, pas les deux.`);
    if (debit === 0 && credit === 0) throw new Error(`Ligne ${index + 1} : montant nul.`);
    return { id: item.id || `opening_${index + 1}`, accountNumber, accountLabel, debit, credit };
  });
  const debit = round(clean.reduce((sum, item) => sum + item.debit, 0)); const credit = round(clean.reduce((sum, item) => sum + item.credit, 0));
  if (clean.length && debit !== credit) throw new Error(`Balance déséquilibrée : ${debit.toFixed(2)} € au débit et ${credit.toFixed(2)} € au crédit.`);
  return clean;
}

export function saveOpeningBalance(period: FiscalPeriod, lines: OpeningBalanceLine[]) {
  const clean = validateOpeningBalance(lines);
  return persist(period, (record) => { record.openingBalance = clean; });
}

export function saveAnnualReview(period: FiscalPeriod, review: Partial<AnnualReview>) {
  return persist(period, (record) => { record.review = { ...emptyReview(), ...record.review, ...Object.fromEntries(Object.entries(review).map(([key, value]) => [key, value === true])) }; });
}

function addMonths(dateValue: string, months: number) {
  const [year, month, day] = dateValue.split("-").map(Number); const date = new Date(Date.UTC(year, month - 1 + months, day)); return date.toISOString().slice(0, 10);
}
function endOfMonth(dateValue: string) { const [year, month] = dateValue.split("-").map(Number); return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10); }

export function buildAnnualClosingSnapshot(period: FiscalPeriod, transactions: Transaction[]) {
  const record = getAnnualClosingRecord(period);
  const inventoryEntries = listInventoryEntries(period.id);
  const inventoryDrafts = inventoryEntries.filter((entry) => entry.status === "draft");
  const inventoryPosted = inventoryEntries.filter((entry) => entry.status !== "draft");
  const inventoryDebit = round(inventoryPosted.flatMap((entry) => entry.lines).reduce((sum, line) => sum + line.debit, 0));
  const inventoryCredit = round(inventoryPosted.flatMap((entry) => entry.lines).reduce((sum, line) => sum + line.credit, 0));
  const openingLines: AccountingLine[] = record.openingBalance.map((line, index) => ({ journalCode: "AN", journalLabel: "À nouveaux", entryNumber: `${period.id}-AN-000001`, entryDate: period.startDate, accountNumber: line.accountNumber, accountLabel: line.accountLabel, pieceRef: "BALANCE-OUVERTURE", pieceDate: period.startDate, label: `À nouveau - ${line.accountLabel}`, debit: line.debit, credit: line.credit, transactionId: `opening:${index + 1}` }));
  const accounting = buildAccountingPreview(transactions, loadAccountingConfig(), { startDate: period.startDate, endDate: period.endDate, label: period.id }, { extraLines: [...openingLines, ...loadPortfolioAccountingLines(), ...inventoryAccountingLines(period.id)] });
  const accountingBlockers = accounting.anomalies.filter((item) => item.severity === "blocking");
  const currentPeriodLines = accounting.lines.filter((line) => line.journalCode !== "AN");
  const charges = round(currentPeriodLines.filter((line) => line.accountNumber.startsWith("6")).reduce((sum, line) => sum + line.debit - line.credit, 0));
  const products = round(currentPeriodLines.filter((line) => line.accountNumber.startsWith("7")).reduce((sum, line) => sum + line.credit - line.debit, 0));
  const accountingResult = round(products - charges);
  const fiscalAdjustments = listFiscalAdjustments(period.id); const fiscalReview = getFiscalReview(period.id);
  const fiscalDrafts = fiscalAdjustments.filter((item) => item.status === "draft"); const fiscalValidated = fiscalAdjustments.filter((item) => item.status === "validated");
  const reintegrations = round(fiscalValidated.filter((item) => item.type === "reintegration").reduce((sum, item) => sum + item.amount, 0));
  const deductions = round(fiscalValidated.filter((item) => item.type === "deduction").reduce((sum, item) => sum + item.amount, 0));
  const fiscalResult = round(accountingResult + reintegrations - deductions);
  const corporateTaxExpense = round(currentPeriodLines.filter((line) => line.accountNumber.startsWith("695")).reduce((sum, line) => sum + line.debit - line.credit, 0));
  const corporateTaxReintegration = round(fiscalValidated.filter((item) => item.kind === "corporate_tax" && item.type === "reintegration").reduce((sum, item) => sum + item.amount, 0));
  const lossesApplied = round(fiscalValidated.filter((item) => item.kind === "loss_carryforward").reduce((sum, item) => sum + item.amount, 0)); const fiscalBeforeLoss = round(fiscalResult + lossesApplied);
  const fiscalIssues: string[] = [];
  if (corporateTaxExpense > 0 && Math.abs(corporateTaxExpense - corporateTaxReintegration) > .01) fiscalIssues.push(`L’IS comptabilisé au 695 (${corporateTaxExpense.toFixed(2)} €) n’est pas réintégré pour le même montant.`);
  if (lossesApplied > Math.max(0, fiscalBeforeLoss)) fiscalIssues.push(`Les déficits antérieurs imputés (${lossesApplied.toFixed(2)} €) dépassent le bénéfice fiscal avant imputation (${Math.max(0, fiscalBeforeLoss).toFixed(2)} €).`);
  const automaticTurnover = round(currentPeriodLines.filter((line) => line.accountNumber.startsWith("70")).reduce((sum, line) => sum + line.credit - line.debit, 0));
  const taxConfig = getAnnualTaxConfig(period.id); const rawTaxCalculation = calculateCorporateTax(period, fiscalResult, automaticTurnover, taxConfig); const taxCalculation = { ...rawTaxCalculation, ready: rawTaxCalculation.ready && !fiscalIssues.length, warnings: [...rawTaxCalculation.warnings, ...fiscalIssues] };
  const simplifiedStatements = buildSimplifiedStatements(accounting.balances, accounting.lines, accountingResult, fiscalAdjustments);
  const active = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date >= period.startDate && transaction.date <= period.endDate);
  const pending = active.filter((transaction) => transaction.status !== "validated");
  const unreconciled = active.filter((transaction) => transaction.reconciled !== true);
  const misc = active.filter((transaction) => transaction.category === "misc");
  const unidentified = active.filter((transaction) => transaction.category === "unidentified_transaction");
  const missingEvidence = active.filter((transaction) => transaction.amount_ttc < 0 && needsTransactionEvidence(transaction));
  const missingFiles = active.filter((transaction) => [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])])].some((file) => !existsSync(join(getWorkspaceRoot(), "attachments", basename(file)))));
  const openingDebit = round(record.openingBalance.reduce((sum, line) => sum + line.debit, 0)); const openingCredit = round(record.openingBalance.reduce((sum, line) => sum + line.credit, 0));
  const priorResultLines = accounting.balances.filter((line) => (line.accountNumber.startsWith("120") || line.accountNumber.startsWith("129")) && Math.abs(line.balance) > .01);
  const unallocatedPriorResult = round(priorResultLines.reduce((sum, line) => sum - line.balance, 0));
  const steps: AnnualClosingStep[] = [
    { id: "transactions", label: "Opérations validées", status: pending.length ? "blocked" : "done", detail: pending.length ? `${pending.length} opération(s) encore en attente` : `${active.length} opération(s) validées sur la période`, count: pending.length },
    { id: "reconciliation", label: "Rapprochement bancaire", status: unreconciled.length ? "blocked" : "done", detail: unreconciled.length ? `${unreconciled.length} opération(s) non rapprochée(s)` : "Toutes les opérations sont rapprochées", count: unreconciled.length },
    { id: "categories", label: "Imputation comptable", status: misc.length ? "blocked" : "done", detail: misc.length ? `${misc.length} opération(s) classée(s) en Divers` : "Toutes les opérations ont une catégorie explicite", count: misc.length },
    { id: "unidentified", label: "Comptes d’attente", status: unidentified.length ? "blocked" : "done", detail: unidentified.length ? `${unidentified.length} opération(s) au compte 471 doivent être identifiées et reclassées` : "Aucune opération ne reste au compte d’attente 471", count: unidentified.length },
    { id: "evidence", label: "Pièces justificatives", status: missingFiles.length ? "blocked" : missingEvidence.length ? "warning" : "done", detail: missingFiles.length ? `${missingFiles.length} fichier(s) référencé(s) introuvable(s)` : missingEvidence.length ? `${missingEvidence.length} dépense(s) à documenter ou expliquer` : "Les dépenses ont une pièce ou une référence", count: missingFiles.length || missingEvidence.length },
    { id: "opening", label: "Balance d’ouverture", status: record.openingBalance.length && openingDebit === openingCredit ? "done" : "blocked", detail: record.openingBalance.length ? `${record.openingBalance.length} compte(s), total ${openingDebit.toFixed(2)} €` : "Importe la balance définitive de l’exercice précédent" },
    { id: "prior-result-allocation", label: "Affectation du résultat antérieur", status: Math.abs(unallocatedPriorResult) > .01 ? "blocked" : "done", detail: Math.abs(unallocatedPriorResult) > .01 ? `${Math.abs(unallocatedPriorResult).toFixed(2)} € restent au compte ${unallocatedPriorResult >= 0 ? "120" : "129"} : enregistre l’affectation décidée (réserve légale, report à nouveau ou distribution)` : "Aucun résultat antérieur ne reste en attente d’affectation", count: priorResultLines.length || undefined },
    { id: "tax-regime", label: "Régime de la liasse", status: record.profitTaxRegime === "unknown" ? "blocked" : "done", detail: record.profitTaxRegime === "simplified" ? "Réel simplifié : 2065 + 2033-A à 2033-G" : record.profitTaxRegime === "normal" ? "Réel normal : 2065 + 2050 à 2059-G" : "À confirmer : réel simplifié ou réel normal" },
    { id: "inventory-journal", label: "Journal d’inventaire", status: inventoryDrafts.length ? "blocked" : inventoryPosted.length ? "done" : "warning", detail: inventoryDrafts.length ? `${inventoryDrafts.length} écriture(s) en brouillon à contrôler ou supprimer` : inventoryPosted.length ? `${inventoryPosted.length} écriture(s) comptabilisée(s), total ${inventoryDebit.toFixed(2)} €` : "Aucune écriture saisie : confirme le cut-off même si aucun ajustement n’est nécessaire", count: inventoryDrafts.length || undefined },
    { id: "accounting-ledger", label: "Journal comptable de l’exercice", status: accounting.balanced ? accountingBlockers.length ? "warning" : "done" : "blocked", detail: accounting.balanced ? accountingBlockers.length ? `Journal équilibré, mais ${accountingBlockers.length} anomalie(s) restent à corriger` : `${accounting.lines.length} ligne(s), débit = crédit = ${accounting.totalDebit.toFixed(2)} €` : `Journal déséquilibré : débit ${accounting.totalDebit.toFixed(2)} €, crédit ${accounting.totalCredit.toFixed(2)} €`, count: accountingBlockers.length || undefined },
    { id: "fiscal-adjustments", label: "Réintégrations et déductions fiscales", status: fiscalDrafts.length || fiscalIssues.length ? "blocked" : fiscalReview.confirmed ? "done" : "blocked", detail: fiscalDrafts.length ? `${fiscalDrafts.length} correction(s) fiscale(s) en brouillon` : fiscalIssues.length ? fiscalIssues[0] : fiscalReview.confirmed ? `Revue confirmée : +${reintegrations.toFixed(2)} € / -${deductions.toFixed(2)} €` : "Examine les charges non déductibles, déficits reportables et autres corrections, puis confirme la revue", count: fiscalDrafts.length || fiscalIssues.length || undefined },
    { id: "fiscal-result", label: "Résultat fiscal provisoire", status: fiscalReview.confirmed && !fiscalDrafts.length && !fiscalIssues.length && accounting.balanced ? "done" : "blocked", detail: fiscalIssues.length ? "Corrige les incohérences fiscales avant de valider le résultat" : fiscalReview.confirmed ? `Résultat fiscal provisoire : ${fiscalResult.toFixed(2)} €` : "Le résultat fiscal ne sera contrôlé qu’après confirmation des corrections" },
    { id: "corporate-tax", label: "Calcul de l’impôt sur les sociétés", status: taxCalculation.ready ? "done" : "blocked", detail: taxCalculation.ready ? `IS net provisoire : ${taxCalculation.netTax.toFixed(2)} € ; solde après acomptes : ${taxCalculation.balance.toFixed(2)} €` : "Renseigne et confirme les conditions du taux réduit, les crédits d’impôt et les acomptes" },
    { id: "simplified-statements", label: "Bilan et compte de résultat 2033", status: record.profitTaxRegime !== "simplified" ? "warning" : Math.abs(simplifiedStatements.balanceSheet.difference) <= .01 ? "done" : "blocked", detail: record.profitTaxRegime !== "simplified" ? "Le mapping 2033 concerne le réel simplifié ; le mapping 2050 reste à construire pour le réel normal" : Math.abs(simplifiedStatements.balanceSheet.difference) <= .01 ? "Bilan simplifié équilibré et compte de résultat mappé" : `Écart actif/passif à expliquer : ${simplifiedStatements.balanceSheet.difference.toFixed(2)} €` },
    ...Object.entries({ bankBalance: "Solde bancaire au dernier jour", customersAndSuppliers: "Créances et dettes clients/fournisseurs", fixedAssets: "Immobilisations et amortissements", vat: "TVA et acomptes", accruals: "Écritures d’inventaire et cut-off", equityLoansAndShareholders: "Capital, emprunts et comptes courants" }).map(([id, label]) => ({ id, label, status: record.review[id as keyof AnnualReview] ? "done" as const : "blocked" as const, detail: record.review[id as keyof AnnualReview] ? "Contrôle confirmé" : "Contrôle à effectuer et documenter" })),
    { id: "statutory-output", label: "Comptes annuels et liasse", status: "blocked", detail: "La génération reste verrouillée : les tableaux 2033-C à 2033-G, la 2065, les contrôles finaux et l’EDI-TDFC ne sont pas encore finalisés." },
  ];
  const blocking = steps.filter((step) => step.status === "blocked").length;
  return {
    period, record, inventoryEntries, inventorySummary: { total: inventoryEntries.length, draft: inventoryDrafts.length, posted: inventoryPosted.length, cancelled: inventoryEntries.filter((entry) => entry.status === "cancelled").length, debit: inventoryDebit, credit: inventoryCredit, balanced: inventoryDebit === inventoryCredit }, accountingSummary: { eligibleTransactions: accounting.eligibleCount, excludedTransactions: accounting.excludedCount, lines: accounting.lines.length, debit: accounting.totalDebit, credit: accounting.totalCredit, balanced: accounting.balanced, anomalies: accounting.anomalies, balances: accounting.balances }, fiscalAdjustments, fiscalReview, fiscalSummary: { charges, products, accountingResult, reintegrations, deductions, fiscalResult, taxableProfit: Math.max(0, fiscalResult), taxLoss: Math.max(0, -fiscalResult), draft: fiscalDrafts.length, validated: fiscalValidated.length, fiscalBeforeLoss, lossesApplied, corporateTaxExpense, corporateTaxReintegration, issues: fiscalIssues }, taxConfig, taxCalculation, simplifiedStatements, transactionSummary: { total: active.length, pending: pending.length, unreconciled: unreconciled.length, misc: misc.length, unidentified: unidentified.length, missingEvidence: missingEvidence.length, missingFiles: missingFiles.length },
    openingBalanceSummary: { lines: record.openingBalance.length, debit: openingDebit, credit: openingCredit, balanced: openingDebit === openingCredit },
    deadlines: { resultDeclaration: endOfMonth(addMonths(period.endDate, 3)), corporateTaxBalance: `${addMonths(period.endDate, 4).slice(0, 8)}15` },
    steps, completed: steps.filter((step) => step.status === "done").length, total: steps.length, dataReady: blocking === 1 && steps.at(-1)?.id === "statutory-output", filingReady: false,
  };
}
