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
  value: string | number; formattedValue: string; source: string;
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

const value = (form: string, section: string, code: string, label: string, raw: string | number, source: string): EfiField => ({
  id: `${form}:${code}:${label}`, form, section, code, label, value: raw,
  formattedValue: typeof raw === "number" ? euro(raw) : String(raw ?? ""), source,
});

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
    value("2065", "Liquidation", "IS-BRUT", "Impôt brut", pack.form2065.grossTax, "Calcul d’IS"),
    value("2065", "Liquidation", "IS-NET", "Impôt net", pack.form2065.netTax, "Calcul d’IS"),
    value("2065", "Liquidation", "ACOMPTES", "Acomptes d’IS", pack.form2065.prepayments, "Hypothèses d’IS"),
    value("2065", "Liquidation", "SOLDE", "Solde d’IS", pack.form2065.balance, "Calcul d’IS"),
  ];
  for (const row of statements.balanceSheet.assets) fields.push(value("2033-A", "Actif", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`));
  for (const row of statements.balanceSheet.liabilities) fields.push(value("2033-A", "Passif", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`));
  for (const row of statements.profitAndLoss.fields) fields.push(value("2033-B", "Compte de résultat", row.code, row.label, row.value, `Comptes ${row.sourceAccounts?.join(", ") || "calculés"}`));
  for (const row of statements.fiscalTable.fields) fields.push(value("2033-B", "Résultat fiscal", row.code, row.label, row.value, "Corrections fiscales"));
  pack.form2033C.fixedAssets.forEach((row: any, index: number) => {
    const prefix = `IMM-${index + 1}`;
    fields.push(value("2033-C", "Immobilisations", `${prefix}-BRUT`, `${row.label} — brut clôture`, row.closingGross, "Journal et balance"));
    fields.push(value("2033-C", "Amortissements", `${prefix}-AMORT`, `${row.label} — amortissements clôture`, row.closingDepreciation, "Journal d’inventaire"));
  });
  fields.push(value("2033-D", "Déficits", "DEFICITS", "Déficits antérieurs imputés", pack.form2033D.lossCarryforwards, "Corrections fiscales"));
  Object.entries(pack.form2033E).forEach(([code, raw]) => fields.push(value("2033-E", "Valeur ajoutée", code.toUpperCase(), code, Number(raw ?? 0), "Journal comptable")));
  pack.form2033F.owners.forEach((owner: any, index: number) => {
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-NOM`, "Nom ou dénomination", owner.name, "Structure financière"));
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-PART`, "Pourcentage détenu", owner.ownershipPercent ?? 0, "Structure financière"));
    fields.push(value("2033-F", "Associés", `ASSOCIE-${index + 1}-TITRES`, "Nombre de titres", owner.shareCount ?? 0, "Structure financière"));
  });
  if (!pack.form2033G.subsidiaries.length) fields.push(value("2033-G", "Participations", "NEANT", "Néant", "Oui", "Structure financière"));
  pack.form2033G.subsidiaries.forEach((item: any, index: number) => {
    fields.push(value("2033-G", "Participations", `FILIALE-${index + 1}-NOM`, "Dénomination", item.name, "Structure financière"));
    fields.push(value("2033-G", "Participations", `FILIALE-${index + 1}-PART`, "Pourcentage détenu", item.ownershipPercent ?? 0, "Structure financière"));
  });
  return fields;
}

export function buildTdfcPreparation(source: ComplianceSource) {
  const fields = buildEfiGuide(source); const forms = Object.fromEntries([...new Set(fields.map((field) => field.form))].map((form) => [form, fields.filter((field) => field.form === form).map(({ code, label, value: raw }) => ({ code, label, value: raw }))]));
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
