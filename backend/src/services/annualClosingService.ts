import { existsSync, readFileSync } from "fs";
import { basename, join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { needsTransactionEvidence } from "./transactionEvidenceService.js";
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
  const active = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date >= period.startDate && transaction.date <= period.endDate);
  const pending = active.filter((transaction) => transaction.status !== "validated");
  const unreconciled = active.filter((transaction) => transaction.reconciled !== true);
  const misc = active.filter((transaction) => transaction.category === "misc");
  const missingEvidence = active.filter((transaction) => transaction.amount_ttc < 0 && needsTransactionEvidence(transaction));
  const missingFiles = active.filter((transaction) => [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])])].some((file) => !existsSync(join(getWorkspaceRoot(), "attachments", basename(file)))));
  const openingDebit = round(record.openingBalance.reduce((sum, line) => sum + line.debit, 0)); const openingCredit = round(record.openingBalance.reduce((sum, line) => sum + line.credit, 0));
  const steps: AnnualClosingStep[] = [
    { id: "transactions", label: "Opérations validées", status: pending.length ? "blocked" : "done", detail: pending.length ? `${pending.length} opération(s) encore en attente` : `${active.length} opération(s) validées sur la période`, count: pending.length },
    { id: "reconciliation", label: "Rapprochement bancaire", status: unreconciled.length ? "blocked" : "done", detail: unreconciled.length ? `${unreconciled.length} opération(s) non rapprochée(s)` : "Toutes les opérations sont rapprochées", count: unreconciled.length },
    { id: "categories", label: "Imputation comptable", status: misc.length ? "blocked" : "done", detail: misc.length ? `${misc.length} opération(s) classée(s) en Divers` : "Toutes les opérations ont une catégorie explicite", count: misc.length },
    { id: "evidence", label: "Pièces justificatives", status: missingFiles.length ? "blocked" : missingEvidence.length ? "warning" : "done", detail: missingFiles.length ? `${missingFiles.length} fichier(s) référencé(s) introuvable(s)` : missingEvidence.length ? `${missingEvidence.length} dépense(s) à documenter ou expliquer` : "Les dépenses ont une pièce ou une référence", count: missingFiles.length || missingEvidence.length },
    { id: "opening", label: "Balance d’ouverture", status: record.openingBalance.length && openingDebit === openingCredit ? "done" : "blocked", detail: record.openingBalance.length ? `${record.openingBalance.length} compte(s), total ${openingDebit.toFixed(2)} €` : "Importe la balance définitive de l’exercice précédent" },
    { id: "tax-regime", label: "Régime de la liasse", status: record.profitTaxRegime === "unknown" ? "blocked" : "done", detail: record.profitTaxRegime === "simplified" ? "Réel simplifié : 2065 + 2033-A à 2033-G" : record.profitTaxRegime === "normal" ? "Réel normal : 2065 + 2050 à 2059-G" : "À confirmer : réel simplifié ou réel normal" },
    ...Object.entries({ bankBalance: "Solde bancaire au dernier jour", customersAndSuppliers: "Créances et dettes clients/fournisseurs", fixedAssets: "Immobilisations et amortissements", vat: "TVA et acomptes", accruals: "Écritures d’inventaire et cut-off", equityLoansAndShareholders: "Capital, emprunts et comptes courants" }).map(([id, label]) => ({ id, label, status: record.review[id as keyof AnnualReview] ? "done" as const : "blocked" as const, detail: record.review[id as keyof AnnualReview] ? "Contrôle confirmé" : "Contrôle à effectuer et documenter" })),
    { id: "statutory-output", label: "Comptes annuels et liasse", status: "blocked", detail: "La génération restera verrouillée jusqu’à l’intégration des écritures d’inventaire et au calcul fiscal." },
  ];
  const blocking = steps.filter((step) => step.status === "blocked").length;
  return {
    period, record, transactionSummary: { total: active.length, pending: pending.length, unreconciled: unreconciled.length, misc: misc.length, missingEvidence: missingEvidence.length, missingFiles: missingFiles.length },
    openingBalanceSummary: { lines: record.openingBalance.length, debit: openingDebit, credit: openingCredit, balanced: openingDebit === openingCredit },
    deadlines: { resultDeclaration: endOfMonth(addMonths(period.endDate, 3)), corporateTaxBalance: `${addMonths(period.endDate, 4).slice(0, 8)}15` },
    steps, completed: steps.filter((step) => step.status === "done").length, total: steps.length, dataReady: blocking === 1 && steps.at(-1)?.id === "statutory-output", filingReady: false,
  };
}
