import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import * as archiverNamespace from "archiver";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import type { AccountingPreview } from "./accountingExportService.js";
import { generateBalanceCsv, generateFec, generateJournalCsv } from "./accountingExportService.js";
import type { FiscalPeriod } from "./annualClosingService.js";
import type { Transaction } from "../types/index.js";

const ZipArchive: new (options: { zlib: { level: number } }) => any = (archiverNamespace as any).ZipArchive;

export interface EfiField {
  id: string; form: string; section: string; code: string; label: string;
  value: string | number; formattedValue: string; copyValue: string; exactFormattedValue?: string;
  column?: string; portalFieldId?: string; manualReview?: boolean; source: string;
}
export type TransmissionMode = "efi" | "edi";
export type TransmissionStatus = "draft" | "validated" | "sent" | "accepted" | "rejected" | "cancelled";
export interface TaxTransmission {
  id: string; periodId: string; mode: TransmissionMode; revision: number; status: TransmissionStatus;
  payloadHash: string; correctionOf?: string; createdAt: string; updatedAt: string;
  validatedAt?: string; sentAt?: string; completedAt?: string; note: string;
  receipt?: { fileName: string; storedName: string; sha256: string; receivedAt: string; outcome: "accepted" | "rejected" };
}
export interface GovernanceConfig {
  meetingDate: string; meetingTime: string; meetingPlace: string; chairName: string; chairRole: string;
  secretaryName: string; legalReserve: number; otherReserves: number; retainedEarnings: number;
  dividends: number; approvalVoteResult: string; allocationVoteResult: string; powersVoteResult: string; notes: string; updatedAt: string;
}
export interface EdiPartnerConfig { providerName: string; channel: "api" | "sftp" | "portal" | "unknown"; mandateReference: string; mandateSignedAt: string; contact: string; apiConfigured: boolean; updatedAt: string }

interface ComplianceSource {
  period: FiscalPeriod;
  filingPackage: any;
  simplifiedStatements: any;
  taxCalculation: any;
  fiscalSummary: { accountingResult: number };
  accountingSummary: { balances: Array<{ accountNumber: string; balance: number }> };
}

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const euro = (value: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const wholeEuro = (value: number) => value >= 0 ? Math.floor(value + .5) : Math.ceil(value - .5);
const wholeEuroDisplay = (value: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(wholeEuro(value));
const portalDate = (raw: string) => /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw.slice(8, 10)}/${raw.slice(5, 7)}/${raw.slice(0, 4)}` : raw;
const transmissionsPath = () => join(getWorkspaceRoot(), "settings", "annual-transmissions.json");
const governancePath = () => join(getWorkspaceRoot(), "settings", "annual-governance.json");
const ediPartnerPath = () => join(getWorkspaceRoot(), "settings", "annual-edi-partner.json");
const receiptDirectory = () => join(getWorkspaceRoot(), "tax-transmission-receipts");
const cleanFileName = (value: string) => basename(value || "accuse-reception").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);

function transmissionStore(): TaxTransmission[] {
  if (!existsSync(transmissionsPath())) return [];
  try { const parsed = JSON.parse(readFileSync(transmissionsPath(), "utf8")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function saveTransmissions(items: TaxTransmission[]) { atomicWriteFileSync(transmissionsPath(), JSON.stringify(items, null, 2)); }
function governanceStore(): Record<string, GovernanceConfig> {
  if (!existsSync(governancePath())) return {};
  try { const parsed = JSON.parse(readFileSync(governancePath(), "utf8")); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}
export function getEdiPartnerConfig(): EdiPartnerConfig {
  if (!existsSync(ediPartnerPath())) return { providerName: "", channel: "unknown", mandateReference: "", mandateSignedAt: "", contact: "", apiConfigured: false, updatedAt: new Date(0).toISOString() };
  try { const parsed = JSON.parse(readFileSync(ediPartnerPath(), "utf8")); return { providerName: String(parsed?.providerName ?? ""), channel: ["api", "sftp", "portal", "unknown"].includes(parsed?.channel) ? parsed.channel : "unknown", mandateReference: String(parsed?.mandateReference ?? ""), mandateSignedAt: String(parsed?.mandateSignedAt ?? ""), contact: String(parsed?.contact ?? ""), apiConfigured: false, updatedAt: String(parsed?.updatedAt ?? new Date(0).toISOString()) }; }
  catch { return { providerName: "", channel: "unknown", mandateReference: "", mandateSignedAt: "", contact: "", apiConfigured: false, updatedAt: new Date(0).toISOString() }; }
}
export function saveEdiPartnerConfig(input: Omit<EdiPartnerConfig, "apiConfigured" | "updatedAt">) {
  const channel = input.channel; if (!["api", "sftp", "portal", "unknown"].includes(channel)) throw new Error("Canal du partenaire EDI invalide.");
  const value: EdiPartnerConfig = { providerName: String(input.providerName ?? "").trim(), channel, mandateReference: String(input.mandateReference ?? "").trim(), mandateSignedAt: String(input.mandateSignedAt ?? ""), contact: String(input.contact ?? "").trim(), apiConfigured: false, updatedAt: new Date().toISOString() };
  if (value.mandateSignedAt && !/^\d{4}-\d{2}-\d{2}$/.test(value.mandateSignedAt)) throw new Error("Date de mandat invalide.");
  atomicWriteFileSync(ediPartnerPath(), JSON.stringify(value, null, 2)); return value;
}

const value = (form: string, section: string, code: string, label: string, raw: string | number, source: string, options: { monetary?: boolean; column?: string; portalFieldId?: string } = {}): EfiField => {
  const monetary = typeof raw === "number" && options.monetary !== false;
  const rounded = monetary ? wholeEuro(raw) : raw;
  return {
    id: `${form}:${code}:${label}`, form, section, code, label, value: raw,
    formattedValue: monetary ? wholeEuroDisplay(raw) : String(raw ?? "").replace(".", ","),
    copyValue: String(rounded ?? "").replace(".", ","),
    ...(monetary && round(raw) !== rounded ? { exactFormattedValue: euro(raw) } : {}),
    ...(options.column ? { column: options.column } : {}), source,
    ...(options.portalFieldId ? { portalFieldId: options.portalFieldId } : {}),
  };
};

const manualValue = (form: string, section: string, code: string, label: string, portalFieldId: string | undefined, source: string): EfiField => ({
  id: `${form}:${code}:${label}`, form, section, code, label,
  value: "", formattedValue: "À vérifier si concerné", copyValue: "", column: section, ...(portalFieldId ? { portalFieldId } : {}), manualReview: true, source,
});

// Identifiants du formulaire EFI 2033-A version 15 fourni par impots.gouv.fr.
const assetPortalFields: Record<string, { label: string; gross: string; provision: string }> = {
  "010": { label: "Immobilisations incorporelles - Fonds commercial", gross: "A304328_0", provision: "A304343_0" },
  "014": { label: "Immobilisations incorporelles - Autres", gross: "A304329_0", provision: "A304344_0" },
  "028": { label: "Immobilisations corporelles", gross: "A304330_0", provision: "A304345_0" },
  "040": { label: "Immobilisations financières (1)", gross: "A304331_0", provision: "A304346_0" },
  "050": { label: "Stocks matières premières, approvisionnements, en cours de production", gross: "A304333_0", provision: "A304348_0" },
  "060": { label: "Stocks marchandises", gross: "A304334_0", provision: "A304349_0" },
  "064": { label: "Avances et acomptes versés sur commandes", gross: "A304335_0", provision: "A304350_0" },
  "068": { label: "Créances (2) clients et comptes rattachés", gross: "A304336_0", provision: "A304351_0" },
  "072": { label: "Créances autres (3)", gross: "A304337_0", provision: "A304352_0" },
  "092": { label: "Charges constatées d’avance", gross: "A304341_0", provision: "A304355_0" },
  "080": { label: "Valeurs mobilières de placement", gross: "A304338_0", provision: "A304353_0" },
  "084": { label: "Disponibilités", gross: "A304339_0", provision: "A304354_0" },
};

const liabilityPortalFields: Record<string, string> = {
  "120": "A304391_0", "126": "A304393_0", "130/132": "A304395_0", "134": "A304396_0",
  "136": "A304397_0", "137": "A912390_0", "140": "A304398_0", "156": "A304401_0",
  "164": "A304402_0", "166": "A304403_0", "172": "A913096_0", "173": "A304390_0",
  "175": "A304404_0", "174": "A304405_0",
};

function addAssetFields(fields: EfiField[], source: ComplianceSource) {
  const balances = source.accountingSummary.balances;
  for (const row of source.simplifiedStatements.balanceSheet.assets) {
    const [grossCode, provisionCode] = String(row.code).split("/");
    if (!provisionCode) {
      fields.push(value("2033-A", "Actif", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`));
      continue;
    }
    const accounts = new Set<string>(row.sourceAccounts ?? []);
    const provisionRows = balances.filter((item) => accounts.has(item.accountNumber) && /^(28|29|39|49|59)/.test(item.accountNumber));
    const provision = round(provisionRows.reduce((sum, item) => sum + Math.max(0, -item.balance), 0));
    const gross = round(Number(row.value ?? 0) + provision);
    const grossAccounts = [...accounts].filter((account) => !/^(28|29|39|49|59)/.test(account));
    const portal = assetPortalFields[grossCode];
    const baseLabel = portal?.label ?? String(row.label).replace(/\s*[—-]\s*net$/iu, "");
    fields.push(value("2033-A", "Actif", grossCode, `${baseLabel} — brut`, gross, `Comptes ${grossAccounts.join(", ") || "calculés"}`, { column: "Brut", portalFieldId: portal?.gross }));
    fields.push(value("2033-A", "Actif", provisionCode, `${baseLabel} — amortissements ou provisions`, provision, `Comptes ${provisionRows.map((item) => item.accountNumber).join(", ") || "aucun"}`, { column: "Amortissements / provisions", portalFieldId: portal?.provision }));
  }
}

function addLiabilityFields(fields: EfiField[], source: ComplianceSource) {
  for (const row of source.simplifiedStatements.balanceSheet.liabilities) {
    if (row.code === "172") {
      const vatRows = source.accountingSummary.balances.filter((item) => item.accountNumber.startsWith("445") && item.balance < 0);
      const vatLiability = round(vatRows.reduce((sum, item) => sum - item.balance, 0));
      fields.push(value("2033-A", "Passif · dettes", "DONT-TVA", "Dont montant de la TVA", vatLiability, `Comptes ${vatRows.map((item) => item.accountNumber).join(", ") || "aucun"}`, { column: "Dont TVA", portalFieldId: "A913095_0" }));
    }
    fields.push(value("2033-A", "Passif", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`, { column: "Net exercice clos en N", portalFieldId: liabilityPortalFields[row.code] }));
  }
}

function addReferralFields(fields: EfiField[], source: ComplianceSource) {
  const pack = source.filingPackage;
  const debtorShareholders = round(source.accountingSummary.balances.filter((item) => item.accountNumber.startsWith("455") && item.balance > 0).reduce((sum, item) => sum + item.balance, 0));
  const acquisitions = round((pack.form2033C.fixedAssets ?? []).reduce((sum: number, item: any) => sum + Number(item.increases ?? 0), 0));
  fields.push(manualValue("2033-A", "Renvois", "RENVOI-1", "Dont immobilisations financières à moins d’un an", "A304425_0", "Échéance non suivie dans les comptes généraux"));
  fields.push(manualValue("2033-A", "Renvois", "RENVOI-2", "Dont créances à plus d’un an", "A304426_0", "Échéance non suivie dans les comptes généraux"));
  fields.push(value("2033-A", "Renvois", "RENVOI-3", "Dont comptes courants d’associés débiteurs", debtorShareholders, "Comptes 455 débiteurs", { column: "Renvois", portalFieldId: "A304427_0" }));
  fields.push(manualValue("2033-A", "Renvois", "RENVOI-4", "Dont dettes à plus d’un an", "A304428_0", "Échéance non suivie dans les comptes généraux"));
  fields.push(value("2033-A", "Renvois", "RENVOI-5-ACQ", "Coût de revient des immobilisations acquises ou créées durant l’exercice", acquisitions, "Mouvements d’immobilisations 2033-C", { column: "Renvois", portalFieldId: "A304429_0" }));
  fields.push(value("2033-A", "Renvois", "RENVOI-5-CESS", "Prix de vente HT des immobilisations cédées durant l’exercice", pack.form2033C.capitalGains?.saleProceeds ?? 0, "Cessions d’immobilisations 2033-C", { column: "Renvois", portalFieldId: "A304430_0" }));
}

const profitAndLossPortalFields: Record<string, string> = {
  "210": "A304449_0", "214": "A304450_0", "218": "A304451_0", "222": "A304452_0",
  "224": "A304453_0", "226": "A304454_0", "230": "A304455_0", "234": "A304457_0",
  "236": "A304458_0", "238": "A304459_0", "240": "A304460_0", "242": "A304461_0",
  "244": "A304462_0", "250": "A304463_0", "252": "A304464_0", "254": "A304465_0",
  "256": "A304466_0", "262": "A304467_0", "280": "A304470_0", "290": "A304471_0",
  "294": "A304472_0", "300": "A304473_0", "306": "A304474_0",
};

function addProfitAndTaxFields(fields: EfiField[], source: ComplianceSource) {
  const statements = source.simplifiedStatements;
  for (const row of statements.profitAndLoss.fields) {
    const portalFieldId = profitAndLossPortalFields[row.code];
    if (!portalFieldId) continue; // Les totaux et résultats sont calculés par le portail EFI.
    fields.push(value("2033-B", "Compte de résultat", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`, { column: "Total", portalFieldId }));
  }
  const reintegrations: any[] = statements.fiscalTable.reintegrations ?? [];
  const deductions: any[] = statements.fiscalTable.deductions ?? [];
  const losses: any[] = statements.fiscalTable.lossCarryforwards ?? [];
  const sumKinds = (items: any[], kinds: string[]) => round(items.filter((item) => kinds.includes(item.kind)).reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
  const nonDeductibleTaxes = sumKinds(reintegrations, ["corporate_tax", "fines_penalties"]);
  const excessDepreciation = sumKinds(reintegrations, ["excess_depreciation"]);
  const otherReintegrations = round(reintegrations.filter((item) => !["corporate_tax", "fines_penalties", "excess_depreciation"].includes(item.kind)).reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
  const ordinaryDeductions = round(deductions.reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
  const lossesApplied = round(losses.reduce((sum, item) => sum + Number(item.amount ?? 0), 0));
  fields.push(value("2033-B", "Résultat fiscal · réintégrations", "IMPOTS-NON-DEDUCTIBLES", "Impôts, IS et pénalités non déductibles", nonDeductibleTaxes, "Corrections fiscales validées", { portalFieldId: "A304480_0" }));
  fields.push(value("2033-B", "Résultat fiscal · réintégrations", "AMORT-EXCEDENTAIRES", "Amortissements excédentaires non déductibles", excessDepreciation, "Corrections fiscales validées", { portalFieldId: "A304478_0" }));
  fields.push(value("2033-B", "Résultat fiscal · réintégrations", "REINTEGRATIONS-DIVERSES", "Réintégrations diverses", otherReintegrations, "Corrections fiscales validées", { portalFieldId: "A304481_0" }));
  fields.push(value("2033-B", "Résultat fiscal · déductions", "DEDUCTIONS-DIVERSES", "Déductions diverses", ordinaryDeductions, "Corrections fiscales validées", { portalFieldId: "A304511_0" }));
  fields.push(value("2033-B", "Résultat fiscal · déficits", "DEFICITS-IMPUTES", "Déficits antérieurs imputés", lossesApplied, "Corrections fiscales validées", { portalFieldId: "A304517_0" }));
}

const fixedAssetPortalFields: Record<string, { label: string; gross: [string, string, string, string]; amort?: [string, string, string] }> = {
  goodwill: { label: "Fonds commercial", gross: ["A304524_0", "A304534_0", "A304544_0", "A304563_0"], amort: ["A911841_0", "A911842_0", "A911843_0"] },
  immaterial: { label: "Autres immobilisations incorporelles", gross: ["A304525_0", "A304535_0", "A304545_0", "A304564_0"], amort: ["A304573_0", "A304581_0", "A304589_0"] },
  land: { label: "Terrains", gross: ["A304526_0", "A304536_0", "A304546_0", "A304565_0"], amort: ["A304574_0", "A304582_0", "A304590_0"] },
  construction: { label: "Constructions", gross: ["A304527_0", "A304537_0", "A304547_0", "A304566_0"], amort: ["A304575_0", "A304583_0", "A304591_0"] },
  technical: { label: "Installations techniques, matériel et outillage", gross: ["A304528_0", "A304538_0", "A304548_0", "A304567_0"], amort: ["A304576_0", "A304584_0", "A304592_0"] },
  fittings: { label: "Installations générales et aménagements", gross: ["A304529_0", "A304539_0", "A304549_0", "A304568_0"], amort: ["A304577_0", "A304585_0", "A304593_0"] },
  transport: { label: "Matériel de transport", gross: ["A304530_0", "A304540_0", "A304550_0", "A304569_0"], amort: ["A304578_0", "A304586_0", "A304594_0"] },
  other_tangible: { label: "Autres immobilisations corporelles", gross: ["A304531_0", "A304541_0", "A304551_0", "A304570_0"], amort: ["A304579_0", "A304587_0", "A304595_0"] },
  financial: { label: "Immobilisations financières", gross: ["A304532_0", "A304542_0", "A304552_0", "A304571_0"] },
};

function fixedAssetKind(row: any, balances: ComplianceSource["accountingSummary"]["balances"]) {
  if (row.code === "financial") return "financial";
  if (row.code === "immaterial") {
    const hasGoodwill = balances.some((item) => item.accountNumber.startsWith("207") && item.balance > 0);
    const hasOther = balances.some((item) => item.accountNumber.startsWith("20") && !item.accountNumber.startsWith("207") && item.balance > 0);
    if (hasGoodwill && hasOther) return undefined;
    if (!hasGoodwill && !hasOther && [row.openingGross, row.increases, row.decreases, row.closingGross].some((item) => Number(item ?? 0) !== 0)) return undefined;
    return hasGoodwill ? "goodwill" : "immaterial";
  }
  const accounts = balances.filter((item) => /^(21|22|23)/.test(item.accountNumber) && item.balance > 0).map((item) => item.accountNumber);
  const kinds = new Set(accounts.map((account) => /^(211|212)/.test(account) ? "land" : /^(213|214)/.test(account) ? "construction" : account.startsWith("215") ? "technical" : account.startsWith("2181") ? "fittings" : account.startsWith("2182") ? "transport" : "other_tangible"));
  if (!kinds.size && [row.openingGross, row.increases, row.decreases, row.closingGross].some((item) => Number(item ?? 0) !== 0)) return undefined;
  return kinds.size <= 1 ? ([...kinds][0] ?? "other_tangible") : undefined;
}

function addFixedAssetFields(fields: EfiField[], source: ComplianceSource) {
  for (const row of source.filingPackage.form2033C.fixedAssets ?? []) {
    const kind = fixedAssetKind(row, source.accountingSummary.balances);
    if (!kind) {
      fields.push(manualValue("2033-C", "Immobilisations", `VENTILATION-${row.code}`, `Ventiler ${row.label} entre les lignes du formulaire`, undefined, "Plusieurs catégories d’immobilisations sont présentes"));
      continue;
    }
    const portal = fixedAssetPortalFields[kind];
    const grossValues = [row.openingGross, row.increases, row.decreases, row.closingGross];
    const grossLabels = ["Valeur brute au début", "Augmentations", "Diminutions", "Valeur brute à la fin"];
    grossValues.forEach((raw, index) => fields.push(value("2033-C", "Immobilisations", `${kind.toUpperCase()}-${index + 1}`, `${portal.label} · ${grossLabels[index]}`, raw ?? 0, "Tableau des immobilisations", { column: grossLabels[index], portalFieldId: portal.gross[index] })));
    if (portal.amort) {
      const amortValues = [row.openingDepreciation, row.depreciationCharge, row.depreciationDecrease];
      const amortLabels = ["Amortissements au début", "Dotations de l’exercice", "Sorties et reprises"];
      amortValues.forEach((raw, index) => fields.push(value("2033-C", "Amortissements", `${kind.toUpperCase()}-AMORT-${index + 1}`, `${portal.label} · ${amortLabels[index]}`, raw ?? 0, "Journal d’inventaire", { column: amortLabels[index], portalFieldId: portal.amort![index] })));
    }
  }
}

function addProvisionAndVatFields(fields: EfiField[], source: ComplianceSource) {
  const pack = source.filingPackage.form2033D;
  if ((pack.provisions ?? []).some((item: any) => Number(item.amount ?? 0) !== 0)) fields.push(manualValue("2033-D", "Provisions", "VENTILATION-PROVISIONS", "Ventiler les provisions entre ouverture, dotations et reprises", undefined, "Le solde de clôture seul ne suffit pas au formulaire"));
  fields.push(value("2033-D", "Déficits", "DEFICITS-IMPUTES", "Déficits imputés durant l’exercice", pack.lossCarryforwards ?? 0, "Corrections fiscales", { portalFieldId: "A309331_0" }));
  const deficit = Number(source.simplifiedStatements.fiscalTable.fields.find((item: any) => item.code === "372")?.value ?? 0);
  fields.push(value("2033-D", "Déficits", "DEFICIT-EXERCICE", "Déficit de l’exercice", deficit, "Résultat fiscal", { portalFieldId: "A304694_0" }));
  fields.push(value("2033-D", "TVA", "TVA-COLLECTEE", "Montant de la TVA collectée", pack.vatCollected ?? 0, "Comptes 44571", { portalFieldId: "A907430_0" }));
  fields.push(value("2033-D", "TVA", "TVA-DEDUCTIBLE", "Montant de la TVA déductible sur biens et services", pack.vatDeductible ?? 0, "Comptes 44562 et 44566", { portalFieldId: "A907431_0" }));
}

function balanceFlow(source: ComplianceSource, prefixes: string[], side: "expense" | "income", excludes: string[] = []) {
  return round(source.accountingSummary.balances.filter((item) => prefixes.some((prefix) => item.accountNumber.startsWith(prefix)) && !excludes.some((prefix) => item.accountNumber.startsWith(prefix))).reduce((sum, item) => sum + (side === "expense" ? Math.max(0, item.balance) : Math.max(0, -item.balance)), 0));
}

function addValueAddedFields(fields: EfiField[], source: ComplianceSource) {
  const pack = source.filingPackage.form2033E;
  const period = source.period;
  const rent = balanceFlow(source, ["613"], "expense");
  const externalCharges = Number(source.simplifiedStatements.profitAndLoss.fields.find((item: any) => item.code === "242")?.value ?? 0);
  const otherExternal = Math.max(0, round(externalCharges - rent));
  const rows = [
    ["EFFECTIF", "Effectif moyen du personnel", pack.averageEmployees ?? 0, "A907434_0", false],
    ["AUTRES-PRODUITS", "Autres produits de gestion courante", balanceFlow(source, ["75"], "income", ["751"]), "A900911_0", true],
    ["PRODUCTION-IMMOBILISEE", "Production immobilisée", balanceFlow(source, ["72"], "income"), "A900907_0", true],
    ["SUBVENTIONS", "Subventions d’exploitation", balanceFlow(source, ["74"], "income"), "A900908_0", true],
    ["VARIATION-STOCK-POSITIVE", "Variation positive des stocks", balanceFlow(source, ["71"], "income"), "A909397_0", true],
    ["VARIATION-STOCK-NEGATIVE", "Variation négative des stocks", balanceFlow(source, ["603"], "expense"), "A909399_0", true],
    ["CHARGES-EXTERNES-HORS-LOYERS", "Autres achats et charges externes hors loyers", otherExternal, "A900920_0", true],
    ["LOYERS", "Loyers et redevances", rent, "A900922_0", true],
    ["TAXES", "Taxes hors TVA et contributions directes", pack.taxes ?? 0, "A900921_0", true],
    ["AUTRES-CHARGES", "Autres charges de gestion courante", balanceFlow(source, ["65"], "expense"), "A900923_0", true],
    ["VA-CVAE", "Valeur ajoutée assujettie à la CVAE", Math.max(0, round(Number(pack.valueAdded ?? 0) - Number(pack.taxes ?? 0))), "A903444_0", true],
    ["CA-CVAE", "Chiffre d’affaires de référence CVAE", pack.turnover ?? 0, "A905913_0", true],
  ] as const;
  for (const [code, label, raw, portalFieldId, monetary] of rows) fields.push(value("2033-E", code === "EFFECTIF" ? "Effectifs" : "Valeur ajoutée", code, label, raw, "Journal comptable", { monetary, portalFieldId }));
  fields.push(value("2033-E", "Période CVAE", "PERIODE-DU", "Période de référence · du", portalDate(period.startDate), "Exercice comptable", { monetary: false, portalFieldId: "A905914_0" }));
  fields.push(value("2033-E", "Période CVAE", "PERIODE-AU", "Période de référence · au", portalDate(period.endDate), "Exercice comptable", { monetary: false, portalFieldId: "A905915_0" }));
  fields.push(manualValue("2033-E", "Effectifs", "EFFECTIF-APPRENTIS", "Dont apprentis", "A907435_0", "Donnée sociale non suivie dans ComptaOS"));
  fields.push(manualValue("2033-E", "Effectifs", "EFFECTIF-HANDICAPES", "Dont personnes handicapées", "A907436_0", "Donnée sociale non suivie dans ComptaOS"));
}

export function buildEfiGuide(source: ComplianceSource): EfiField[] {
  const pack = source.filingPackage, statements = source.simplifiedStatements, tax = source.taxCalculation;
  const fields: EfiField[] = [
    value("2065", "Identification", "IDENT-NOM", "Dénomination", pack.identity.name, "Fiche entreprise"),
    value("2065", "Identification", "IDENT-SIREN", "SIREN", pack.identity.siren, "Fiche entreprise"),
    value("2065", "Identification", "IDENT-SIRET", "SIRET", pack.identity.siret, "Fiche entreprise"),
    value("2065", "Identification", "IDENT-ADRESSE", "Adresse", pack.identity.address, "Fiche entreprise"),
    value("2065", "Exercice", "DATE-DEBUT", "Exercice ouvert le", source.period.startDate, "Exercice comptable"),
    value("2065", "Exercice", "DATE-FIN", "Exercice clos le", source.period.endDate, "Exercice comptable"),
    value("2065", "Résultat fiscal", "BENEFICE-15", "Bénéfice imposable à 15 %", pack.form2065.taxableAt15, "Calcul d’IS"),
    value("2065", "Résultat fiscal", "BENEFICE-25", "Bénéfice imposable à 25 %", pack.form2065.taxableAt25, "Calcul d’IS"),
    value("2572-SD", "Liquidation de l’IS", "IS-BRUT", "Impôt brut", pack.form2065.grossTax, "Calcul d’IS"),
    value("2572-SD", "Liquidation de l’IS", "IS-NET", "Impôt net", pack.form2065.netTax, "Calcul d’IS"),
    value("2572-SD", "Liquidation de l’IS", "ACOMPTES", "Acomptes d’IS", pack.form2065.prepayments, "Hypothèses d’IS"),
    value("2572-SD", "Liquidation de l’IS", "SOLDE", "Solde d’IS", pack.form2065.balance, "Calcul d’IS"),
  ];
  addAssetFields(fields, source);
  addLiabilityFields(fields, source);
  addReferralFields(fields, source);
  addProfitAndTaxFields(fields, source);
  addFixedAssetFields(fields, source);
  addProvisionAndVatFields(fields, source);
  addValueAddedFields(fields, source);
  pack.form2033F.owners.forEach((owner: any, index: number) => {
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-NOM`, "Nom ou dénomination", owner.name, "Structure financière"));
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-PART`, "Pourcentage détenu", owner.ownershipPercent ?? 0, "Structure financière", { monetary: false }));
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-TITRES`, "Nombre de titres", owner.shareCount ?? 0, "Structure financière", { monetary: false }));
  });
  if (!pack.form2033G.subsidiaries.length) fields.push(value("2033-G", "Participations", "NEANT", "Néant", "Oui", "Structure financière"));
  pack.form2033G.subsidiaries.forEach((item: any, index: number) => {
    fields.push(value("2033-G", "Participations", `FILIALE-${index + 1}-NOM`, "Dénomination", item.name, "Structure financière"));
    fields.push(value("2033-G", "Participations", `FILIALE-${index + 1}-PART`, "Pourcentage détenu", item.ownershipPercent ?? 0, "Structure financière", { monetary: false }));
  });
  return fields;
}

export function buildTdfcPreparation(source: ComplianceSource) {
  const fields = buildEfiGuide(source); const forms = Object.fromEntries([...new Set(fields.map((field) => field.form))].map((form) => [form, fields.filter((field) => field.form === form).map(({ code, label, value: raw, portalFieldId, column, manualReview }) => ({ code, label, value: raw, ...(portalFieldId ? { portalFieldId } : {}), ...(column ? { column } : {}), ...(manualReview ? { manualReview: true } : {}) }))]));
  const body = { format: "COMPTAOS-TDFC-PREPARATION", schemaVersion: "2026.1", campaign: 2026, officialInterchange: false, transmittableDirectly: false, requiresPartnerEdi: true, generatedAt: new Date().toISOString(), period: source.period, declarant: { name: source.filingPackage.identity.name, siren: source.filingPackage.identity.siren, siret: source.filingPackage.identity.siret }, forms };
  return { ...body, sha256: sha256(JSON.stringify(body)), warnings: ["Ce fichier contient les données fiscales structurées mais n’est pas un interchange EDIFACT attesté.", "La transmission exige un partenaire EDI et un adaptateur conforme à son protocole."] };
}

export function listTaxTransmissions(periodId: string) { return transmissionStore().filter((item) => item.periodId === periodId).sort((a, b) => b.revision - a.revision); }
export function createTaxTransmission(periodId: string, mode: TransmissionMode, payloadHash: string, correctionOf?: string) {
  if (mode !== "efi" && mode !== "edi") throw new Error("Mode de transmission invalide.");
  const store = transmissionStore(); const prior = correctionOf ? store.find((item) => item.id === correctionOf && item.periodId === periodId) : undefined;
  if (correctionOf && !prior) throw new Error("Transmission d’origine introuvable.");
  const revision = Math.max(0, ...store.filter((item) => item.periodId === periodId).map((item) => item.revision)) + 1; const now = new Date().toISOString();
  const record: TaxTransmission = { id: randomUUID(), periodId, mode, revision, status: "draft", payloadHash, correctionOf, createdAt: now, updatedAt: now, note: "" };
  store.push(record); saveTransmissions(store); return record;
}
export function updateTaxTransmission(periodId: string, id: string, action: "validate" | "mark_sent" | "cancel", payloadHash: string, note = "") {
  const store = transmissionStore(); const index = store.findIndex((item) => item.id === id && item.periodId === periodId); if (index < 0) throw new Error("Transmission introuvable.");
  const item = store[index], now = new Date().toISOString();
  if (action === "validate") { if (item.status !== "draft") throw new Error("Seul un brouillon peut être validé."); if (item.payloadHash !== payloadHash) throw new Error("Les données fiscales ont changé : crée une nouvelle transmission."); item.status = "validated"; item.validatedAt = now; }
  if (action === "mark_sent") { if (item.status !== "validated") throw new Error("Valide le dossier avant de déclarer son envoi."); item.status = "sent"; item.sentAt = now; }
  if (action === "cancel") { if (item.status === "accepted") throw new Error("Une transmission acceptée ne peut pas être annulée."); item.status = "cancelled"; item.completedAt = now; }
  item.note = String(note ?? "").trim(); item.updatedAt = now; store[index] = item; saveTransmissions(store); return item;
}
export function attachTransmissionReceipt(periodId: string, id: string, input: { fileName: string; contentBase64: string; outcome: "accepted" | "rejected"; note?: string }) {
  const store = transmissionStore(); const index = store.findIndex((item) => item.id === id && item.periodId === periodId); if (index < 0) throw new Error("Transmission introuvable.");
  if (store[index].status !== "sent") throw new Error("L’accusé ne peut être associé qu’à un dossier marqué comme envoyé.");
  if (input.outcome !== "accepted" && input.outcome !== "rejected") throw new Error("Résultat d’accusé invalide.");
  const bytes = Buffer.from(String(input.contentBase64 ?? ""), "base64"); if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("L’accusé doit contenir un fichier de 10 Mo maximum.");
  mkdirSync(receiptDirectory(), { recursive: true }); const fileName = cleanFileName(input.fileName), storedName = `${id}-${fileName}`; writeFileSync(join(receiptDirectory(), storedName), bytes);
  const now = new Date().toISOString(); store[index] = { ...store[index], status: input.outcome, completedAt: now, updatedAt: now, note: String(input.note ?? "").trim(), receipt: { fileName, storedName, sha256: sha256(bytes), receivedAt: now, outcome: input.outcome } }; saveTransmissions(store); return store[index];
}

export function getGovernanceConfig(periodId: string, source?: ComplianceSource): GovernanceConfig {
  const existing = governanceStore()[periodId]; if (existing) return Object.assign({ approvalVoteResult: "", allocationVoteResult: "", powersVoteResult: "" }, existing);
  const result = round(source?.fiscalSummary.accountingResult ?? 0), capital = Number(source?.filingPackage.identity.capital ?? 0), legalReserveBalance = Math.max(0, -(source?.accountingSummary.balances.find((item) => item.accountNumber.startsWith("1061"))?.balance ?? 0));
  const reserve = result > 0 ? round(Math.min(result * .05, Math.max(0, capital * .1 - legalReserveBalance))) : 0;
  return { meetingDate: "", meetingTime: "", meetingPlace: source?.filingPackage.form2065.signatory.city ?? "", chairName: source?.filingPackage.form2065.signatory.name ?? "", chairRole: source?.filingPackage.form2065.signatory.role ?? "Président", secretaryName: "", legalReserve: reserve, otherReserves: 0, retainedEarnings: round(result - reserve), dividends: 0, approvalVoteResult: "", allocationVoteResult: "", powersVoteResult: "", notes: "", updatedAt: new Date(0).toISOString() };
}
export function saveGovernanceConfig(periodId: string, input: Omit<GovernanceConfig, "updatedAt">, accountingResult: number) {
  const clean = { meetingDate: String(input.meetingDate ?? ""), meetingTime: String(input.meetingTime ?? ""), meetingPlace: String(input.meetingPlace ?? "").trim(), chairName: String(input.chairName ?? "").trim(), chairRole: String(input.chairRole ?? "").trim(), secretaryName: String(input.secretaryName ?? "").trim(), legalReserve: round(Number(input.legalReserve) || 0), otherReserves: round(Number(input.otherReserves) || 0), retainedEarnings: round(Number(input.retainedEarnings) || 0), dividends: round(Number(input.dividends) || 0), approvalVoteResult: String(input.approvalVoteResult ?? "").trim(), allocationVoteResult: String(input.allocationVoteResult ?? "").trim(), powersVoteResult: String(input.powersVoteResult ?? "").trim(), notes: String(input.notes ?? "").trim() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean.meetingDate)) throw new Error("La date réelle de l’assemblée est obligatoire.");
  if (!clean.meetingPlace || !clean.chairName || !clean.chairRole) throw new Error("Le lieu, le président de séance et sa qualité sont obligatoires.");
  if (!clean.approvalVoteResult || !clean.allocationVoteResult || !clean.powersVoteResult) throw new Error("Renseigne le résultat réel du vote pour chacune des trois résolutions.");
  const allocation = round(clean.legalReserve + clean.otherReserves + clean.retainedEarnings + clean.dividends); if (Math.abs(allocation - round(accountingResult)) > .01) throw new Error(`L’affectation (${allocation.toFixed(2)} €) doit correspondre au résultat comptable (${round(accountingResult).toFixed(2)} €).`);
  const store = governanceStore(); const value: GovernanceConfig = { ...clean, updatedAt: new Date().toISOString() }; store[periodId] = value; atomicWriteFileSync(governancePath(), JSON.stringify(store, null, 2)); return value;
}

const safePdfText = (value: string) => value.replace(/[’]/g, "'").replace(/[–—]/g, "-").replace(/œ/g, "oe");
function wrap(font: any, text: string, size: number, width: number) {
  const words = safePdfText(text).split(/\s+/), lines: string[] = []; let line = "";
  for (const word of words) { const candidate = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate; else { if (line) lines.push(line); line = word; } } if (line) lines.push(line); return lines;
}
export async function generateApprovalMinutes(source: ComplianceSource, config: GovernanceConfig) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold); let page = pdf.addPage([595.28, 841.89]), y = 790;
  const draw = (text: string, options: { size?: number; bold?: boolean; gap?: number } = {}) => { const size = options.size ?? 10, selected = options.bold ? bold : font; for (const line of wrap(selected, text, size, 495)) { if (y < 60) { page = pdf.addPage([595.28, 841.89]); y = 790; } page.drawText(line, { x: 50, y, size, font: selected, color: rgb(0, 0, 0) }); y -= size + 4; } y -= options.gap ?? 6; };
  const pack = source.filingPackage, result = round(source.fiscalSummary.accountingResult), owners = pack.form2033F.owners;
  draw(pack.identity.name.toUpperCase(), { size: 14, bold: true, gap: 2 }); draw(`${pack.identity.legalForm} au capital de ${euro(Number(pack.identity.capital) || 0)} euros`, { size: 9, gap: 1 }); draw(`Siège social : ${pack.identity.address}`, { size: 9, gap: 1 }); draw(`SIREN : ${pack.identity.siren}`, { size: 9, gap: 18 });
  draw("PROCÈS-VERBAL DE L'ASSEMBLÉE GÉNÉRALE ORDINAIRE ANNUELLE", { size: 12, bold: true, gap: 18 });
  draw(`Le ${config.meetingDate}${config.meetingTime ? ` à ${config.meetingTime}` : ""}, les associés de la société se sont réunis à ${config.meetingPlace}, sur convocation régulière, afin de statuer sur les comptes de l'exercice clos le ${source.period.endDate}.`);
  draw(`La séance est présidée par ${config.chairName}, en qualité de ${config.chairRole}.${config.secretaryName ? ` ${config.secretaryName} est désigné(e) secrétaire de séance.` : ""}`);
  draw("Associés présents ou représentés", { bold: true }); owners.forEach((owner: any) => draw(`${owner.name} - ${owner.ownershipPercent ?? 0} % - ${owner.shareCount ?? 0} titre(s)`, { size: 9, gap: 1 })); y -= 8;
  draw("Première résolution - Approbation des comptes", { bold: true }); draw(`L'assemblée, après avoir pris connaissance des comptes annuels, approuve le bilan, le compte de résultat et, le cas échéant, l'annexe de l'exercice clos le ${source.period.endDate}, ainsi que les opérations traduites dans ces comptes. Le résultat comptable de l'exercice s'élève à ${euro(result)} euros.`); draw(`Résultat du vote : ${config.approvalVoteResult}.`, { bold: true });
  draw("Deuxième résolution - Affectation du résultat", { bold: true }); draw(`L'assemblée décide d'affecter le résultat comme suit : réserve légale ${euro(config.legalReserve)} euros ; autres réserves ${euro(config.otherReserves)} euros ; report à nouveau ${euro(config.retainedEarnings)} euros ; dividendes ${euro(config.dividends)} euros.`); draw(`Résultat du vote : ${config.allocationVoteResult}.`, { bold: true });
  draw("Troisième résolution - Pouvoirs", { bold: true }); draw("Tous pouvoirs sont donnés au porteur d'un original, d'une copie ou d'un extrait du présent procès-verbal pour accomplir les formalités légales."); draw(`Résultat du vote : ${config.powersVoteResult}.`, { bold: true });
  if (config.notes) { draw("Observations", { bold: true }); draw(config.notes); }
  draw("Les résolutions ont été soumises au vote dans les conditions prévues par les statuts. Le présent document doit être contrôlé puis signé après la tenue effective de l'assemblée.", { size: 8, gap: 24 });
  draw(`Fait à ${config.meetingPlace}, le ${config.meetingDate}`, { gap: 24 }); draw(`${config.chairName} - ${config.chairRole}`, { bold: true });
  pdf.setTitle(`Procès-verbal d'approbation des comptes - ${pack.identity.name}`); pdf.setSubject("Projet à contrôler et signer après tenue de l'assemblée"); return pdf.save();
}

export async function createAnnualArchive(input: { source: ComplianceSource; preview: AccountingPreview; transactions: Transaction[]; filingPdf: Uint8Array; tdfc: unknown }) {
  const { source, preview, transactions } = input, stamp = new Date().toISOString().replace(/[:.]/g, "-"); const directory = join(getWorkspaceRoot(), "archives", "annual-closing"); mkdirSync(directory, { recursive: true });
  const fileName = `cloture-${source.period.endDate}-${stamp}.zip`, absolutePath = join(directory, fileName), output = createWriteStream(absolutePath), zip = new ZipArchive({ zlib: { level: 9 } });
  const entries: Array<{ name: string; bytes: Buffer }> = [
    { name: "liasse-2065-2033.pdf", bytes: Buffer.from(input.filingPdf) },
    { name: "dossier-fiscal.json", bytes: Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), period: source.period, package: source.filingPackage, statements: source.simplifiedStatements, taxCalculation: source.taxCalculation }, null, 2)) },
    { name: "tdfc-preparation.json", bytes: Buffer.from(JSON.stringify(input.tdfc, null, 2)) },
    { name: "suivi-conformite.json", bytes: Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), closingRecord: (source as any).record, transmissions: listTaxTransmissions(source.period.id), ediPartner: getEdiPartnerConfig(), governance: getGovernanceConfig(source.period.id, source) }, null, 2)) },
    { name: "FEC.txt", bytes: Buffer.from(generateFec(preview)) },
    { name: "journal.csv", bytes: Buffer.from(generateJournalCsv(preview)) },
    { name: "balance.csv", bytes: Buffer.from(generateBalanceCsv(preview)) },
  ];
  const evidence = new Set(transactions.flatMap((transaction) => [...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])]).map((file) => basename(file)));
  for (const name of evidence) { const path = join(getWorkspaceRoot(), "attachments", name); if (existsSync(path)) entries.push({ name: `justificatifs/${name}`, bytes: readFileSync(path) }); }
  for (const transmission of listTaxTransmissions(source.period.id)) if (transmission.receipt) { const stored = basename(transmission.receipt.storedName), path = join(receiptDirectory(), stored); if (existsSync(path)) entries.push({ name: `accuses-dgfip/${transmission.revision}-${transmission.receipt.fileName}`, bytes: readFileSync(path) }); }
  const manifest = { generatedAt: new Date().toISOString(), period: source.period, entries: entries.map((entry) => ({ name: entry.name, size: entry.bytes.length, sha256: sha256(entry.bytes) })) }; entries.push({ name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2)) });
  const completion = new Promise<void>((resolve, reject) => { output.on("close", resolve); output.on("error", reject); zip.on("error", reject); }); zip.pipe(output); entries.forEach((entry) => zip.append(entry.bytes, { name: entry.name })); await zip.finalize(); await completion;
  return { fileName, relativePath: `archives/annual-closing/${fileName}`, sha256: sha256(readFileSync(absolutePath)), createdAt: new Date().toISOString(), entries: manifest.entries.length };
}
