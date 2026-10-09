import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import type { AccountBalance, AccountingLine } from "./accountingExportService.js";
import type { FiscalAdjustment } from "./annualFiscalService.js";

export interface AnnualTaxConfig {
  turnoverOverride: number | null; belongsToGroup: boolean | null; groupTurnover: number | null;
  capitalFullyPaid: boolean | null; naturalPersonOwnershipPercent: number | null; hasSpecialTaxRegime: boolean | null;
  taxCredits: number; prepayments: number; reviewed: boolean; note: string; reviewedFingerprint?: string; updatedAt: string;
}
export interface AnnualTaxConfigInput extends Omit<AnnualTaxConfig, "reviewedFingerprint" | "updatedAt"> {}
export interface TaxPeriod { id: string; startDate: string; endDate: string }
export interface StatementField { code: string; label: string; value: number; sourceAccounts: string[] }

const storePath = () => join(getWorkspaceRoot(), "settings", "annual-tax.json");
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const empty = (): AnnualTaxConfig => ({ turnoverOverride: null, belongsToGroup: null, groupTurnover: null, capitalFullyPaid: null, naturalPersonOwnershipPercent: null, hasSpecialTaxRegime: null, taxCredits: 0, prepayments: 0, reviewed: false, note: "", updatedAt: new Date(0).toISOString() });

function loadStore(): Record<string, AnnualTaxConfig> { if (!existsSync(storePath())) return {}; try { const value = JSON.parse(readFileSync(storePath(), "utf8")); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
function saveStore(store: Record<string, AnnualTaxConfig>) { atomicWriteFileSync(storePath(), JSON.stringify(store, null, 2)); }
export function getAnnualTaxConfig(periodId: string): AnnualTaxConfig { return { ...empty(), ...loadStore()[periodId] }; }

function nullableAmount(value: unknown, label: string) { if (value === null || value === undefined || value === "") return null; const amount = round(Number(value)); if (!Number.isFinite(amount) || amount < 0) throw new Error(`${label} doit être positif.`); return amount; }
function nullableBoolean(value: unknown) { return value === true ? true : value === false ? false : null; }
function clean(input: AnnualTaxConfigInput): Omit<AnnualTaxConfig, "reviewedFingerprint" | "updatedAt"> {
  const ownership = nullableAmount(input.naturalPersonOwnershipPercent, "Le pourcentage de détention"); if (ownership !== null && ownership > 100) throw new Error("Le pourcentage de détention ne peut pas dépasser 100 %.");
  return { turnoverOverride: nullableAmount(input.turnoverOverride, "Le chiffre d’affaires"), belongsToGroup: nullableBoolean(input.belongsToGroup), groupTurnover: nullableAmount(input.groupTurnover, "Le chiffre d’affaires du groupe"), capitalFullyPaid: nullableBoolean(input.capitalFullyPaid), naturalPersonOwnershipPercent: ownership, hasSpecialTaxRegime: nullableBoolean(input.hasSpecialTaxRegime), taxCredits: nullableAmount(input.taxCredits, "Les crédits d’impôt") ?? 0, prepayments: nullableAmount(input.prepayments, "Les acomptes d’IS") ?? 0, reviewed: input.reviewed === true, note: String(input.note ?? "").trim() };
}

export function periodMonths(period: TaxPeriod) {
  const [sy, sm, sd] = period.startDate.split("-").map(Number), [ey, em, rawEndDay] = period.endDate.split("-").map(Number); const ed = Math.min(rawEndDay, 30); const startDay = Math.min(sd, 30);
  return Math.max(0, (ey - sy) * 12 + em - sm + (ed - startDay + 1) / 30);
}
function fingerprint(period: TaxPeriod, fiscalResult: number, automaticTurnover: number, config: Omit<AnnualTaxConfig, "reviewedFingerprint" | "updatedAt">) { return createHash("sha256").update(JSON.stringify({ period, fiscalResult: round(fiscalResult), automaticTurnover: round(automaticTurnover), ...config, reviewed: undefined, note: undefined })).digest("hex"); }

export function calculateCorporateTax(period: TaxPeriod, fiscalResult: number, automaticTurnover: number, source: AnnualTaxConfig) {
  const config = clean(source); const months = periodMonths(period); const reducedThreshold = Math.round(42_500 * months / 12); const turnover = config.turnoverOverride ?? round(automaticTurnover); const eligibilityTurnover = config.belongsToGroup === true ? config.groupTurnover : turnover;
  const conditionsComplete = config.belongsToGroup !== null && config.capitalFullyPaid !== null && config.naturalPersonOwnershipPercent !== null && config.hasSpecialTaxRegime !== null && (config.belongsToGroup !== true || config.groupTurnover !== null);
  const reducedRateEligible = conditionsComplete && config.hasSpecialTaxRegime === false && eligibilityTurnover !== null && eligibilityTurnover <= 10_000_000 && config.capitalFullyPaid === true && config.naturalPersonOwnershipPercent! >= 75;
  const taxableBase = Math.max(0, round(fiscalResult)); const reducedBase = reducedRateEligible ? Math.min(taxableBase, reducedThreshold) : 0; const normalBase = round(taxableBase - reducedBase);
  const reducedTax = round(reducedBase * .15); const normalTax = round(normalBase * .25); const grossTax = round(reducedTax + normalTax); const netTax = Math.max(0, round(grossTax - config.taxCredits)); const balance = round(netTax - config.prepayments);
  const inputFingerprint = fingerprint(period, fiscalResult, automaticTurnover, config); const reviewed = source.reviewed === true && source.reviewedFingerprint === inputFingerprint;
  const warnings: string[] = [];
  if (!conditionsComplete && taxableBase > 0) warnings.push("Les conditions du taux réduit ne sont pas toutes renseignées.");
  if (config.hasSpecialTaxRegime === true) warnings.push("Un régime spécial ou un revenu à taux distinct est signalé : ce calcul standard ne peut pas être validé.");
  if (config.belongsToGroup === true) warnings.push("Le seuil de chiffre d’affaires est apprécié au niveau du groupe déclaré.");
  if (grossTax > 763_000 || turnover >= 7_630_000) warnings.push("Vérifie l’éventuelle contribution sociale de 3,3 %, non calculée ici.");
  return { months, reducedThreshold, automaticTurnover: round(automaticTurnover), turnover, eligibilityTurnover, conditionsComplete, reducedRateEligible, taxableBase, reducedBase, normalBase, reducedTax, normalTax, grossTax, taxCredits: config.taxCredits, netTax, prepayments: config.prepayments, balance, inputFingerprint, reviewed, ready: reviewed && config.hasSpecialTaxRegime === false && (taxableBase === 0 || conditionsComplete), warnings };
}

export function saveAnnualTaxConfig(period: TaxPeriod, fiscalResult: number, automaticTurnover: number, input: AnnualTaxConfigInput) {
  const cleanConfig = clean(input); const now = new Date().toISOString(); const reviewedFingerprint = cleanConfig.reviewed ? fingerprint(period, fiscalResult, automaticTurnover, cleanConfig) : undefined;
  const value: AnnualTaxConfig = { ...cleanConfig, reviewedFingerprint, updatedAt: now }; const store = loadStore(); store[period.id] = value; saveStore(store); return value;
}

const accountValue = (balances: AccountBalance[], prefixes: string[], side: "debit" | "credit" = "debit", exclude: string[] = []) => {
  const rows = balances.filter((item) => prefixes.some((prefix) => item.accountNumber.startsWith(prefix)) && !exclude.some((prefix) => item.accountNumber.startsWith(prefix))); const value = round(rows.reduce((sum, item) => sum + (side === "debit" ? Math.max(0, item.balance) : Math.max(0, -item.balance)), 0)); return { value, accounts: rows.filter((item) => item.balance !== 0).map((item) => item.accountNumber) };
};
const signedCreditValue = (balances: AccountBalance[], prefixes: string[], exclude: string[] = []) => { const rows = balances.filter((item) => prefixes.some((prefix) => item.accountNumber.startsWith(prefix)) && !exclude.some((prefix) => item.accountNumber.startsWith(prefix))); return { value: round(rows.reduce((sum, item) => sum - item.balance, 0)), accounts: rows.filter((item) => item.balance !== 0).map((item) => item.accountNumber) }; };
const field = (code: string, label: string, item: { value: number; accounts: string[] }): StatementField => ({ code, label, value: item.value, sourceAccounts: item.accounts });
const netAsset = (balances: AccountBalance[], grossPrefixes: string[], depreciationPrefixes: string[], exclude: string[] = [], depreciationExclude: string[] = []) => { const gross = accountValue(balances, grossPrefixes, "debit", exclude), depreciation = accountValue(balances, depreciationPrefixes, "credit", depreciationExclude); return { value: round(gross.value - depreciation.value), accounts: [...new Set([...gross.accounts, ...depreciation.accounts])] }; };
const sumFields = (code: string, label: string, fields: StatementField[]) => ({ code, label, value: round(fields.reduce((sum, item) => sum + item.value, 0)), sourceAccounts: [...new Set(fields.flatMap((item) => item.sourceAccounts))] });
const lineValue = (lines: AccountingLine[], prefixes: string[], orientation: "product" | "charge", exclude: string[] = []) => { const rows = lines.filter((item) => prefixes.some((prefix) => item.accountNumber.startsWith(prefix)) && !exclude.some((prefix) => item.accountNumber.startsWith(prefix))); return { value: round(rows.reduce((sum, item) => sum + (orientation === "product" ? item.credit - item.debit : item.debit - item.credit), 0)), accounts: [...new Set(rows.map((item) => item.accountNumber))] }; };

export function buildSimplifiedStatements(balances: AccountBalance[], allLines: AccountingLine[], accountingResult: number, adjustments: FiscalAdjustment[]) {
  const lines = allLines.filter((item) => item.journalCode !== "AN");
  const assets = [
    field("010/012", "Fonds commercial — net", netAsset(balances, ["207"], ["2807"])), field("014/016", "Autres immobilisations incorporelles — net", netAsset(balances, ["20"], ["280", "290"], ["207"], ["2807"])),
    field("028/030", "Immobilisations corporelles — net", netAsset(balances, ["21", "22", "23"], ["281", "282", "283", "291", "292", "293"])), field("040/042", "Immobilisations financières — net", netAsset(balances, ["26", "27"], ["296", "297"])),
    field("050/052", "Matières, approvisionnements et en-cours", accountValue(balances, ["31", "32", "33", "34", "35"])), field("060/062", "Marchandises", accountValue(balances, ["37"])),
    field("064/066", "Avances et acomptes versés", accountValue(balances, ["4091"])), field("068/070", "Clients et comptes rattachés", accountValue(balances, ["411", "413", "416", "418"])),
    field("072/074", "Autres créances", accountValue(balances, ["40", "42", "43", "44", "45", "46", "47"], "debit", ["4091", "411", "413", "416", "418"])), field("092/094", "Charges constatées d’avance", accountValue(balances, ["486"])),
    field("080/082", "Valeurs mobilières de placement", accountValue(balances, ["50"])), field("084/086", "Disponibilités", accountValue(balances, ["51", "52", "53"])),
  ];
  const fixedAssets = assets.slice(0, 4), currentAssets = assets.slice(4); const totalAssets = round(assets.reduce((sum, item) => sum + item.value, 0));
  const liabilities = [
    field("120", "Capital social", signedCreditValue(balances, ["101"])), field("126", "Réserve légale", signedCreditValue(balances, ["1061"])), field("130/132", "Autres réserves", signedCreditValue(balances, ["106"], ["1061"])), field("134", "Report à nouveau et résultat antérieur en attente d’affectation", signedCreditValue(balances, ["11", "120", "129"])),
    { code: "136", label: "Résultat de l’exercice", value: round(accountingResult), sourceAccounts: [...new Set(lines.filter((item) => /^[67]/.test(item.accountNumber)).map((item) => item.accountNumber))] }, field("137", "Subventions d’investissement", accountValue(balances, ["13"], "credit")), field("140", "Provisions réglementées", accountValue(balances, ["14"], "credit")),
    field("156", "Emprunts et dettes assimilées", accountValue(balances, ["16", "51"], "credit")), field("164", "Avances et acomptes reçus", accountValue(balances, ["4191"], "credit")), field("166", "Fournisseurs et comptes rattachés", accountValue(balances, ["401", "403", "408"], "credit")),
    field("172", "Dettes fiscales et sociales", accountValue(balances, ["42", "43", "44"], "credit")), field("173", "Comptes courants d’associés", accountValue(balances, ["455"], "credit")), field("175", "Autres dettes", accountValue(balances, ["40", "41", "45", "46", "47"], "credit", ["401", "403", "408", "4191", "455"])), field("174", "Produits constatés d’avance", accountValue(balances, ["487"], "credit")),
  ];
  const equity = liabilities.slice(0, 7), debts = liabilities.slice(7); const totalLiabilities = round(liabilities.reduce((sum, item) => sum + item.value, 0));
  const pnlBase = [
    field("210", "Ventes de marchandises", lineValue(lines, ["707"], "product")), field("214", "Production vendue — biens", lineValue(lines, ["701", "702", "703", "704", "705"], "product")), field("218", "Production vendue — services", lineValue(lines, ["706"], "product")), field("222", "Production stockée", lineValue(lines, ["71"], "product")), field("224", "Production immobilisée", lineValue(lines, ["72"], "product")), field("226", "Subventions d’exploitation", lineValue(lines, ["74"], "product")), field("230", "Autres produits", lineValue(lines, ["75"], "product")),
    field("234", "Achats de marchandises", lineValue(lines, ["607"], "charge")), field("236", "Variation de stocks marchandises", lineValue(lines, ["6037"], "charge")), field("238", "Matières premières et approvisionnements", lineValue(lines, ["601", "602"], "charge")), field("240", "Variation de stocks matières", lineValue(lines, ["6031", "6032"], "charge")), field("242", "Autres charges externes", lineValue(lines, ["60", "61", "62"], "charge", ["601", "602", "6031", "6032", "6037", "607"])), field("244", "Impôts et taxes", lineValue(lines, ["63"], "charge")), field("250", "Rémunérations", lineValue(lines, ["641"], "charge")), field("252", "Cotisations sociales", lineValue(lines, ["645"], "charge")), field("254", "Dotations aux amortissements", lineValue(lines, ["6811"], "charge")), field("256", "Dotations aux dépréciations", lineValue(lines, ["6816", "6817"], "charge")), field("262", "Autres charges", lineValue(lines, ["65", "681"], "charge", ["6811", "6816", "6817"])),
    field("280", "Produits financiers", lineValue(lines, ["76"], "product")), field("294", "Charges financières", lineValue(lines, ["66"], "charge")), field("290", "Produits exceptionnels", lineValue(lines, ["77"], "product")), field("300", "Charges exceptionnelles", lineValue(lines, ["67"], "charge")), field("306", "Impôt sur les bénéfices", lineValue(lines, ["695"], "charge")),
  ];
  const productOps = sumFields("232", "Total produits d’exploitation", pnlBase.slice(0, 7)); const chargeOps = sumFields("264", "Total charges d’exploitation", pnlBase.slice(7, 18));
  const operatingResult: StatementField = { code: "270", label: "Résultat d’exploitation", value: round(productOps.value - chargeOps.value), sourceAccounts: [...new Set([...productOps.sourceAccounts, ...chargeOps.sourceAccounts])] };
  const reintegrations = adjustments.filter((item) => item.status === "validated" && item.type === "reintegration"), ordinaryDeductions = adjustments.filter((item) => item.status === "validated" && item.type === "deduction" && item.kind !== "loss_carryforward"), losses = adjustments.filter((item) => item.status === "validated" && item.kind === "loss_carryforward");
  const reintegrationTotal = round(reintegrations.reduce((sum, item) => sum + item.amount, 0)), deductionTotal = round(ordinaryDeductions.reduce((sum, item) => sum + item.amount, 0)), lossesApplied = round(losses.reduce((sum, item) => sum + item.amount, 0)); const beforeLoss = round(accountingResult + reintegrationTotal - deductionTotal); const afterLoss = round(beforeLoss - lossesApplied);
  return { balanceSheet: { assets, fixedAssetsTotal: round(fixedAssets.reduce((sum, item) => sum + item.value, 0)), currentAssetsTotal: round(currentAssets.reduce((sum, item) => sum + item.value, 0)), totalAssets, liabilities, equityTotal: round(equity.reduce((sum, item) => sum + item.value, 0)), debtsTotal: round(debts.reduce((sum, item) => sum + item.value, 0)), totalLiabilities, difference: round(totalAssets - totalLiabilities) }, profitAndLoss: { fields: [...pnlBase, productOps, chargeOps, operatingResult, { code: "310", label: "Bénéfice ou perte comptable", value: round(accountingResult), sourceAccounts: [] }] }, fiscalTable: { accountingResult: round(accountingResult), reintegrations, deductions: ordinaryDeductions, lossCarryforwards: losses, reintegrationTotal, deductionTotal, beforeLoss, lossesApplied, afterLoss, fields: [{ code: accountingResult >= 0 ? "312" : "314", label: accountingResult >= 0 ? "Bénéfice comptable" : "Déficit comptable", value: Math.abs(round(accountingResult)) }, { code: "330", label: "Total réintégrations", value: reintegrationTotal }, { code: "344", label: "Total déductions hors déficits antérieurs", value: deductionTotal }, { code: beforeLoss >= 0 ? "352" : "354", label: "Résultat fiscal avant déficits antérieurs", value: Math.abs(beforeLoss) }, { code: "360", label: "Déficits antérieurs imputés", value: lossesApplied }, { code: afterLoss >= 0 ? "370" : "372", label: "Résultat fiscal après déficits", value: Math.abs(afterLoss) }] } };
}
