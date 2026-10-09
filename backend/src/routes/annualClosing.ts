import type { FastifyInstance, FastifyReply } from "fastify";
import { getActiveCompanyId } from "../services/companiesService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { getPlatformState } from "../services/platformService.js";
import { workspaceContext } from "../services/workspaceContext.js";
import { buildAnnualClosingSnapshot, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, type AnnualReview, type FiscalPeriod, type OpeningBalanceLine, type ProfitTaxRegime } from "../services/annualClosingService.js";
import { cancelInventoryEntry, createInventoryEntry, deleteInventoryDraft, updateInventoryEntry, validateInventoryEntry, type InventoryEntryInput } from "../services/annualInventoryService.js";
import { cancelFiscalAdjustment, createFiscalAdjustment, deleteFiscalDraft, saveFiscalReview, updateFiscalAdjustment, validateFiscalAdjustment, type FiscalAdjustmentInput } from "../services/annualFiscalService.js";
import { saveAnnualTaxConfig, type AnnualTaxConfigInput } from "../services/annualTaxService.js";
import { saveAnnualFilingConfig, type AnnualFilingConfigInput } from "../services/annualFilingService.js";
import { generateAnnualFilingPdf } from "../services/annualFilingPdfService.js";
import * as XLSX from "xlsx";

function periods(): FiscalPeriod[] {
  const companyId = workspaceContext.getStore()?.companyId ?? getActiveCompanyId(); const entity = getPlatformState().entities.find((item) => item.workspaceId === companyId);
  return [...(entity?.fiscalPeriods ?? [])].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

function selected(periodId?: string) {
  const available = periods(); const period = (periodId ? available.find((item) => item.id === periodId) : available.find((item) => item.endDate <= new Date().toISOString().slice(0, 10))) ?? available[0];
  if (!period) throw new Error("Aucun exercice comptable daté n’est enregistré pour cette structure."); return { period, available };
}

function error(reply: FastifyReply, caught: unknown) { return reply.status(400).send({ error: caught instanceof Error ? caught.message : "Requête invalide." }); }

async function snapshot(period: FiscalPeriod, available = periods()) {
  return { availablePeriods: available, ...buildAnnualClosingSnapshot(period, await loadAllTransactions()) };
}

export async function annualClosingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { periodId?: string } }>("/", async (request, reply) => {
    try { const { period, available } = selected(request.query.periodId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { profitTaxRegime: ProfitTaxRegime } }>("/:periodId/setup", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveAnnualSetup(period, request.body?.profitTaxRegime ?? "unknown"); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { lines: OpeningBalanceLine[] } }>("/:periodId/opening-balance", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveOpeningBalance(period, request.body?.lines ?? []); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { review: Partial<AnnualReview> } }>("/:periodId/review", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveAnnualReview(period, request.body?.review ?? {}); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: InventoryEntryInput }>("/:periodId/inventory", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); createInventoryEntry(period, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string; entryId: string }; Body: InventoryEntryInput }>("/:periodId/inventory/:entryId", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); updateInventoryEntry(period, request.params.entryId, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; entryId: string } }>("/:periodId/inventory/:entryId/validate", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); validateInventoryEntry(period.id, request.params.entryId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; entryId: string }; Body: { reason: string } }>("/:periodId/inventory/:entryId/cancel", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); cancelInventoryEntry(period.id, request.params.entryId, request.body?.reason); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.delete<{ Params: { periodId: string; entryId: string } }>("/:periodId/inventory/:entryId", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); deleteInventoryDraft(period.id, request.params.entryId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: FiscalAdjustmentInput }>("/:periodId/fiscal-adjustments", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); createFiscalAdjustment(period.id, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string; adjustmentId: string }; Body: FiscalAdjustmentInput }>("/:periodId/fiscal-adjustments/:adjustmentId", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); updateFiscalAdjustment(period.id, request.params.adjustmentId, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; adjustmentId: string } }>("/:periodId/fiscal-adjustments/:adjustmentId/validate", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); validateFiscalAdjustment(period.id, request.params.adjustmentId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; adjustmentId: string }; Body: { reason: string } }>("/:periodId/fiscal-adjustments/:adjustmentId/cancel", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); cancelFiscalAdjustment(period.id, request.params.adjustmentId, request.body?.reason); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.delete<{ Params: { periodId: string; adjustmentId: string } }>("/:periodId/fiscal-adjustments/:adjustmentId", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); deleteFiscalDraft(period.id, request.params.adjustmentId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { confirmed: boolean; note?: string } }>("/:periodId/fiscal-review", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveFiscalReview(period.id, request.body?.confirmed === true, request.body?.note ?? ""); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: AnnualTaxConfigInput }>("/:periodId/corporate-tax", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const transactions = await loadAllTransactions(); const before = buildAnnualClosingSnapshot(period, transactions); saveAnnualTaxConfig(period, before.fiscalSummary.fiscalResult, before.taxCalculation.automaticTurnover, request.body); return { availablePeriods: available, ...buildAnnualClosingSnapshot(period, transactions) }; }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: AnnualFilingConfigInput }>("/:periodId/filing", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveAnnualFilingConfig(period.id, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.get<{ Params: { periodId: string }; Querystring: { format?: "json" | "xlsx" | "pdf" } }>("/:periodId/filing-package", async (request, reply) => {
    try {
      const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); const pack = data.filingPackage;
      if (!pack.ready || !data.taxCalculation.ready) return reply.status(409).send({ error: "Le dossier 2065/2033 doit être entièrement complété et confirmé avant export.", missing: pack.missing, unreviewed: pack.unreviewed });
      const baseName = `liasse-${period.endDate}-travail`;
      if (request.query.format === "json") return reply.header("Content-Disposition", `attachment; filename="${baseName}.json"`).send({ generatedAt: new Date().toISOString(), legalStatus: "Dossier de saisie contrôlé — transmission non effectuée", period, package: pack, statements: data.simplifiedStatements, taxCalculation: data.taxCalculation });
      if (request.query.format === "pdf") { const bytes = await generateAnnualFilingPdf({ period, package: pack, statements: data.simplifiedStatements }); return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="${baseName}.pdf"`).send(Buffer.from(bytes)); }
      const wb = XLSX.utils.book_new(); const sheet = (name: string, rows: unknown[][]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
      sheet("2065", [["Champ", "Valeur"], ...Object.entries({ "Entreprise": pack.identity.name, "Forme juridique": pack.identity.legalForm, "SIREN": pack.identity.siren, "SIRET": pack.identity.siret, "Adresse": pack.identity.address, "Activité": pack.identity.activity, "Ouverture": period.startDate, "Clôture": period.endDate, "Bénéfice à 15 %": pack.form2065.taxableAt15, "Bénéfice à 25 %": pack.form2065.taxableAt25, "IS brut": pack.form2065.grossTax, "Crédits d’impôt": pack.form2065.taxCredits, "IS net": pack.form2065.netTax, "Acomptes": pack.form2065.prepayments, "Solde": pack.form2065.balance, "Logiciel": pack.form2065.accountingSoftware, "Signataire": pack.form2065.signatory.name, "Qualité": pack.form2065.signatory.role, "Lieu": pack.form2065.signatory.city, "Date": pack.form2065.signatory.date })]);
      sheet("2033-A", [["Code", "Libellé", "Montant", "Comptes sources"], ...data.simplifiedStatements.balanceSheet.assets.map((row) => [row.code, row.label, row.value, row.sourceAccounts.join(", ")]), ...data.simplifiedStatements.balanceSheet.liabilities.map((row) => [row.code, row.label, row.value, row.sourceAccounts.join(", ")]), ["TOTAL ACTIF", "", data.simplifiedStatements.balanceSheet.totalAssets], ["TOTAL PASSIF", "", data.simplifiedStatements.balanceSheet.totalLiabilities]]);
      sheet("2033-B", [["Code", "Libellé", "Montant", "Comptes sources"], ...data.simplifiedStatements.profitAndLoss.fields.map((row) => [row.code, row.label, row.value, row.sourceAccounts.join(", ")]), ...data.simplifiedStatements.fiscalTable.fields.map((row) => [row.code, row.label, row.value, ""])]);
      sheet("2033-C", [["Nature", "Brut ouverture", "Augmentations", "Diminutions", "Brut clôture", "Amort. ouverture", "Dotations", "Reprises/sorties", "Amort. clôture", "Net clôture"], ...pack.form2033C.fixedAssets.map((row) => [row.label, row.openingGross, row.increases, row.decreases, row.closingGross, row.openingDepreciation, row.depreciationCharge, row.depreciationDecrease, row.closingDepreciation, row.closingNet]), [], ["Cessions d’immobilisations", "Prix de cession", pack.form2033C.capitalGains.saleProceeds], ["Cessions d’immobilisations", "Valeur nette comptable", pack.form2033C.capitalGains.netBookValueDisposed], ["Plus ou moins-value nette", "", pack.form2033C.capitalGains.netGain]]);
      sheet("2033-D", [["Provisions et déficits", "Montant"], ...pack.form2033D.provisions.map((row) => [row.label, row.amount]), ["Déficits antérieurs imputés", pack.form2033D.lossCarryforwards]]);
      sheet("2033-E", [["Champ", "Montant"], ...Object.entries(pack.form2033E)]);
      sheet("2033-F", [["Capital", pack.form2033F.capital], ["Associé", "Nature", "% détention", "Parts", "Adresse", "Date de naissance", "Lieu de naissance", "Forme juridique", "SIREN"], ...pack.form2033F.owners.map((row) => [row.name, row.kind === "person" ? "Personne physique" : "Personne morale", row.ownershipPercent, row.shareCount, row.address, row.birthDate, row.birthPlace, row.legalForm, row.siren]), ["TOTAL", "", pack.form2033F.ownershipTotal]]);
      sheet("2033-G", [["Filiale / participation", "Forme juridique", "SIREN", "% détention", "Adresse", "Code postal", "Ville", "Pays"], ...pack.form2033G.subsidiaries.map((row) => [row.name, row.legalForm, row.siren, row.ownershipPercent, row.address, row.postalCode, row.city, row.country]), ...(pack.form2033G.subsidiaries.length ? [] : [["Néant"]])]);
      sheet("Contrôles", [["Contrôle", "État"], ["Bilan équilibré", pack.checks.balanceSheetBalanced ? "OK" : "KO"], ["Identité complète", pack.checks.identityComplete ? "OK" : "KO"], ["Annexes revues", pack.checks.annexesReviewed ? "OK" : "KO"], ["Calcul IS confirmé", data.taxCalculation.ready ? "OK" : "KO"], ["Transmission EDI-TDFC", "NON EFFECTUÉE"]]);
      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }); return reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").header("Content-Disposition", `attachment; filename="${baseName}.xlsx"`).send(buffer);
    } catch (caught) { return error(reply, caught); }
  });
}
