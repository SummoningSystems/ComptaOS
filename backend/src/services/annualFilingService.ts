import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { getActiveCompanyId } from "./companiesService.js";
import { getPlatformState } from "./platformService.js";
import { loadCompanyProfile } from "./settingsService.js";
import type { AccountBalance, AccountingLine } from "./accountingExportService.js";
import type { FiscalPeriod, OpeningBalanceLine } from "./annualClosingService.js";

export interface AnnualFilingReview {
  fixedAssets: boolean;
  provisionsAndLosses: boolean;
  valueAdded: boolean;
  capitalAndOwners: boolean;
  subsidiaries: boolean;
  corporateTaxReturn: boolean;
}

export interface AnnualFilingConfig {
  activity: string;
  signatoryName: string;
  signatoryRole: string;
  signatoryCity: string;
  declarationDate: string;
  averageEmployees: number | null;
  accountingSoftware: string;
  ownerDetails: Record<string, { address: string; birthDate: string; birthPlace: string; legalForm: string; siren: string }>;
  subsidiaryDetails: Record<string, { address: string; postalCode: string; city: string; country: string; legalForm: string; siren: string }>;
  review: AnnualFilingReview;
  updatedAt: string;
}

export interface AnnualFilingConfigInput extends Omit<AnnualFilingConfig, "updatedAt"> {}

interface TaxCalculationLike {
  turnover: number; taxableBase: number; reducedBase: number; normalBase: number;
  grossTax: number; taxCredits: number; netTax: number; prepayments: number; balance: number;
}

interface SimplifiedStatementsLike {
  balanceSheet: { totalAssets: number; totalLiabilities: number; difference: number };
  fiscalTable: { fields: Array<{ code: string; label: string; value: number; sourceAccounts?: string[] }> };
}

const storePath = () => join(getWorkspaceRoot(), "settings", "annual-filing.json");
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const emptyReview = (): AnnualFilingReview => ({ fixedAssets: false, provisionsAndLosses: false, valueAdded: false, capitalAndOwners: false, subsidiaries: false, corporateTaxReturn: false });
const empty = (): AnnualFilingConfig => ({ activity: "", signatoryName: "", signatoryRole: "", signatoryCity: "", declarationDate: "", averageEmployees: null, accountingSoftware: "ComptaOS", ownerDetails: {}, subsidiaryDetails: {}, review: emptyReview(), updatedAt: new Date(0).toISOString() });

function loadStore(): Record<string, AnnualFilingConfig> {
  if (!existsSync(storePath())) return {};
  try { const parsed = JSON.parse(readFileSync(storePath(), "utf8")); return parsed && typeof parsed === "object" ? parsed : {}; }
  catch { return {}; }
}

export function getAnnualFilingConfig(periodId: string): AnnualFilingConfig {
  const value = loadStore()[periodId];
  return { ...empty(), ...value, ownerDetails: value?.ownerDetails ?? {}, subsidiaryDetails: value?.subsidiaryDetails ?? {}, review: { ...emptyReview(), ...(value?.review ?? {}) } };
}

export function saveAnnualFilingConfig(periodId: string, input: AnnualFilingConfigInput) {
  const rawAverageEmployees = input.averageEmployees as unknown;
  const averageEmployees = rawAverageEmployees === null || rawAverageEmployees === undefined || rawAverageEmployees === "" ? null : Number(rawAverageEmployees);
  if (averageEmployees !== null && (!Number.isFinite(averageEmployees) || averageEmployees < 0)) throw new Error("L’effectif moyen doit être positif.");
  const value: AnnualFilingConfig = {
    activity: String(input.activity ?? "").trim(), signatoryName: String(input.signatoryName ?? "").trim(), signatoryRole: String(input.signatoryRole ?? "").trim(), signatoryCity: String(input.signatoryCity ?? "").trim(),
    declarationDate: String(input.declarationDate ?? "").trim(), averageEmployees: averageEmployees === null ? null : round(averageEmployees), accountingSoftware: String(input.accountingSoftware ?? "ComptaOS").trim() || "ComptaOS",
    ownerDetails: Object.fromEntries(Object.entries(input.ownerDetails ?? {}).map(([id, detail]) => [id, { address: String(detail?.address ?? "").trim(), birthDate: String(detail?.birthDate ?? "").trim(), birthPlace: String(detail?.birthPlace ?? "").trim(), legalForm: String(detail?.legalForm ?? "").trim(), siren: String(detail?.siren ?? "").trim() }])),
    subsidiaryDetails: Object.fromEntries(Object.entries(input.subsidiaryDetails ?? {}).map(([id, detail]) => [id, { address: String(detail?.address ?? "").trim(), postalCode: String(detail?.postalCode ?? "").trim(), city: String(detail?.city ?? "").trim(), country: String(detail?.country ?? "France").trim(), legalForm: String(detail?.legalForm ?? "").trim(), siren: String(detail?.siren ?? "").trim() }])),
    review: Object.fromEntries(Object.keys(emptyReview()).map((key) => [key, input.review?.[key as keyof AnnualFilingReview] === true])) as unknown as AnnualFilingReview,
    updatedAt: new Date().toISOString(),
  };
  const store = loadStore(); store[periodId] = value; atomicWriteFileSync(storePath(), JSON.stringify(store, null, 2)); return value;
}

const balanceAmount = (balances: AccountBalance[], prefixes: string[], side: "debit" | "credit") => round(balances.filter((row) => prefixes.some((prefix) => row.accountNumber.startsWith(prefix))).reduce((sum, row) => sum + (side === "debit" ? Math.max(0, row.balance) : Math.max(0, -row.balance)), 0));
const openingAmount = (opening: OpeningBalanceLine[], prefixes: string[], side: "debit" | "credit") => round(opening.filter((row) => prefixes.some((prefix) => row.accountNumber.startsWith(prefix))).reduce((sum, row) => sum + (side === "debit" ? row.debit : row.credit), 0));
const movement = (lines: AccountingLine[], prefixes: string[], orientation: "debit" | "credit") => round(lines.filter((line) => line.journalCode !== "AN" && prefixes.some((prefix) => line.accountNumber.startsWith(prefix))).reduce((sum, line) => sum + (orientation === "debit" ? line.debit - line.credit : line.credit - line.debit), 0));
const result = (lines: AccountingLine[], prefixes: string[], orientation: "charge" | "product") => round(lines.filter((line) => line.journalCode !== "AN" && prefixes.some((prefix) => line.accountNumber.startsWith(prefix))).reduce((sum, line) => sum + (orientation === "charge" ? line.debit - line.credit : line.credit - line.debit), 0));

export function buildAnnualFilingPackage(args: { period: FiscalPeriod; openingBalance: OpeningBalanceLine[]; balances: AccountBalance[]; lines: AccountingLine[]; statements: SimplifiedStatementsLike; tax: TaxCalculationLike }) {
  const { period, openingBalance, balances, lines, statements, tax } = args; const config = getAnnualFilingConfig(period.id); const profile = loadCompanyProfile();
  const state = getPlatformState(); const companyId = getActiveCompanyId(); const entity = state.entities.find((item) => item.workspaceId === companyId);
  const peopleById = new Map(state.people.map((item) => [item.id, item.name])); const entitiesById = new Map(state.entities.map((item) => [item.id, item.name]));
  const owners = entity ? state.relations.filter((relation) => relation.toId === entity.id && ["owner", "shareholder", "subsidiary"].includes(relation.type)).map((relation) => ({ id: relation.id, kind: peopleById.has(relation.fromId) ? "person" as const : "entity" as const, name: peopleById.get(relation.fromId) ?? entitiesById.get(relation.fromId) ?? relation.fromId, ownershipPercent: relation.ownershipPercent ?? null, shareCount: relation.shareCount ?? null, ...(config.ownerDetails[relation.id] ?? { address: "", birthDate: "", birthPlace: "", legalForm: "", siren: "" }) })) : [];
  const subsidiaries = entity ? state.relations.filter((relation) => relation.fromId === entity.id && ["owner", "shareholder", "subsidiary"].includes(relation.type) && entitiesById.has(relation.toId)).map((relation) => ({ id: relation.id, name: entitiesById.get(relation.toId)!, ownershipPercent: relation.ownershipPercent ?? null, shareCount: relation.shareCount ?? null, ...(config.subsidiaryDetails[relation.id] ?? { address: "", postalCode: "", city: "", country: "France", legalForm: "", siren: "" }) })) : [];
  const assetGroups = [{ code: "immaterial", label: "Immobilisations incorporelles", gross: ["20"], depreciation: ["280", "290"] }, { code: "tangible", label: "Immobilisations corporelles", gross: ["21", "22", "23"], depreciation: ["281", "282", "283", "291", "292", "293"] }, { code: "financial", label: "Immobilisations financières", gross: ["26", "27"], depreciation: ["296", "297"] }];
  const fixedAssets = assetGroups.map((group) => { const openingGross = openingAmount(openingBalance, group.gross, "debit"), grossMovement = movement(lines, group.gross, "debit"), closingGross = balanceAmount(balances, group.gross, "debit"), openingDepreciation = openingAmount(openingBalance, group.depreciation, "credit"), depreciationMovement = movement(lines, group.depreciation, "credit"), closingDepreciation = balanceAmount(balances, group.depreciation, "credit"); return { code: group.code, label: group.label, openingGross, increases: Math.max(0, grossMovement), decreases: Math.max(0, -grossMovement), closingGross, openingDepreciation, depreciationCharge: Math.max(0, depreciationMovement), depreciationDecrease: Math.max(0, -depreciationMovement), closingDepreciation, closingNet: round(closingGross - closingDepreciation) }; });
  const provisions = [{ label: "Provisions réglementées", amount: balanceAmount(balances, ["14"], "credit") }, { label: "Provisions pour risques et charges", amount: balanceAmount(balances, ["15"], "credit") }, { label: "Dépréciations d’actif", amount: balanceAmount(balances, ["29", "39", "49", "59"], "credit") }];
  const production = round(result(lines, ["70", "71", "72", "74"], "product")), externalConsumption = round(result(lines, ["60", "61", "62"], "charge")), valueAdded = round(production - externalConsumption);
  const valueAddedTable = { turnover: tax.turnover, production, externalConsumption, valueAdded, taxes: result(lines, ["63"], "charge"), wages: result(lines, ["641"], "charge"), socialCharges: result(lines, ["645"], "charge"), depreciation: result(lines, ["6811"], "charge"), averageEmployees: config.averageEmployees };
  const identity = { name: profile.name || entity?.name || "", legalForm: profile.legalForm ?? entity?.legalType ?? "", siren: profile.siren ?? "", siret: profile.siret ?? "", address: [profile.address, profile.postalCode, profile.city].filter(Boolean).join(" "), email: profile.email ?? "", capital: profile.capital ?? (entity?.capitalAmount === undefined ? "" : String(entity.capitalAmount)), activity: config.activity };
  const form2065 = { periodStart: period.startDate, periodEnd: period.endDate, regime: "simplified", identity, taxableAt15: tax.reducedBase, taxableAt25: tax.normalBase, deficit: tax.taxableBase === 0 ? Math.max(0, -statements.fiscalTable.fields.find((field) => field.code === "372")?.value! || 0) : 0, grossTax: tax.grossTax, taxCredits: tax.taxCredits, netTax: tax.netTax, prepayments: tax.prepayments, balance: tax.balance, computerizedAccounting: true, accountingSoftware: config.accountingSoftware, signatory: { name: config.signatoryName, role: config.signatoryRole, city: config.signatoryCity, date: config.declarationDate } };
  const missing: string[] = [];
  if (!identity.name) missing.push("Dénomination de l’entreprise"); if (!identity.siren || !/^\d{9}$/.test(identity.siren.replace(/\s/g, ""))) missing.push("SIREN à 9 chiffres"); if (!identity.siret || !/^\d{14}$/.test(identity.siret.replace(/\s/g, ""))) missing.push("SIRET à 14 chiffres (Paramètres → Entreprise)"); if (!identity.address) missing.push("Adresse de l’entreprise"); if (!config.activity) missing.push("Activité exercée"); if (!config.signatoryName) missing.push("Nom du signataire"); if (!config.signatoryRole) missing.push("Qualité du signataire"); if (!config.signatoryCity) missing.push("Lieu de signature"); if (!/^\d{4}-\d{2}-\d{2}$/.test(config.declarationDate)) missing.push("Date de déclaration"); if (config.averageEmployees === null) missing.push("Effectif moyen 2033-E (0 si aucun salarié)");
  const unreviewed = Object.entries(config.review).filter(([, checked]) => !checked).map(([key]) => key); const ownershipTotal = owners.reduce((sum, owner) => sum + (owner.ownershipPercent ?? 0), 0); const ownershipRoundingTolerance = owners.length * .005 + .000001; if (owners.length && owners.some((owner) => owner.ownershipPercent === null)) missing.push("Pourcentage de chaque associé"); if (owners.length && Math.abs(ownershipTotal - 100) > ownershipRoundingTolerance) missing.push(`Répartition du capital à 100 % (actuellement ${round(ownershipTotal)} %)`);
  const totalShares = owners.reduce((sum, owner) => sum + (owner.shareCount ?? 0), 0); if (owners.length && totalShares > 0 && owners.every((owner) => owner.shareCount !== null && owner.ownershipPercent !== null) && owners.some((owner) => Math.abs((owner.shareCount! / totalShares) * 100 - owner.ownershipPercent!) > .1)) missing.push("Cohérence entre le nombre de titres et les pourcentages de détention (2033-F)");
  for (const owner of owners.filter((item) => (item.ownershipPercent ?? 0) >= 10)) { if (owner.shareCount === null) missing.push(`Nombre de titres détenus par ${owner.name}`); if (!owner.address) missing.push(`Adresse de ${owner.name} (2033-F)`); if (owner.kind === "person") { if (!owner.birthDate) missing.push(`Date de naissance de ${owner.name} (2033-F)`); if (!owner.birthPlace) missing.push(`Lieu de naissance de ${owner.name} (2033-F)`); } else { if (!owner.legalForm) missing.push(`Forme juridique de ${owner.name} (2033-F)`); if (!/^\d{9}$/.test(owner.siren.replace(/\s/g, ""))) missing.push(`SIREN de ${owner.name} (2033-F)`); } }
  for (const subsidiary of subsidiaries.filter((item) => (item.ownershipPercent ?? 0) >= 10)) { if (!subsidiary.legalForm || !subsidiary.address || !subsidiary.postalCode || !subsidiary.city || !subsidiary.country || !/^\d{9}$/.test(subsidiary.siren.replace(/\s/g, ""))) missing.push(`Identification complète de ${subsidiary.name} (2033-G)`); }
  const checks = { balanceSheetBalanced: Math.abs(statements.balanceSheet.difference) <= .01, taxCalculationReviewed: true, identityComplete: missing.length === 0, annexesReviewed: unreviewed.length === 0 };
  const assetSaleProceeds = result(lines, ["775"], "product"), assetBookValueDisposed = result(lines, ["675"], "charge");
  return { millesime: 2026, config, identity, form2065, form2033C: { fixedAssets, capitalGains: { saleProceeds: assetSaleProceeds, netBookValueDisposed: assetBookValueDisposed, netGain: round(assetSaleProceeds - assetBookValueDisposed) } }, form2033D: { provisions, lossCarryforwards: statements.fiscalTable.fields.find((field) => field.code === "360")?.value ?? 0 }, form2033E: valueAddedTable, form2033F: { capital: Number(identity.capital) || 0, owners, ownershipTotal: round(ownershipTotal), totalShares }, form2033G: { subsidiaries }, missing, unreviewed, checks, ready: missing.length === 0 && unreviewed.length === 0 && checks.balanceSheetBalanced };
}
