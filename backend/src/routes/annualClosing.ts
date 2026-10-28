import type { FastifyInstance, FastifyReply } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { getActiveCompanyId } from "../services/companiesService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { getPlatformState } from "../services/platformService.js";
import { workspaceContext } from "../services/workspaceContext.js";
import { assertAnnualPeriodOpen, buildAnnualAccountingPreview, buildAnnualClosingSnapshot, buildCarryForwardBalance, getAnnualClosingRecord, reopenAnnualPeriod, saveAnnualLock, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, type AnnualReview, type FiscalPeriod, type OpeningBalanceLine, type ProfitTaxRegime } from "../services/annualClosingService.js";
import { cancelInventoryEntry, createInventoryEntry, deleteInventoryDraft, listActiveInventoryEntries, updateInventoryEntry, validateInventoryEntry, type InventoryEntryInput } from "../services/annualInventoryService.js";
import { cancelFiscalAdjustment, createFiscalAdjustment, deleteFiscalDraft, listFiscalAdjustments, saveFiscalReview, updateFiscalAdjustment, validateFiscalAdjustment, type FiscalAdjustmentInput } from "../services/annualFiscalService.js";
import { saveAnnualTaxConfig, type AnnualTaxConfigInput } from "../services/annualTaxService.js";
import { invalidateAnnualFilingReview, saveAnnualFilingConfig, type AnnualFilingConfigInput } from "../services/annualFilingService.js";
import { generateAnnualFilingPdf } from "../services/annualFilingPdfService.js";
import { attachTransmissionReceipt, buildEfiGuide, buildTdfcPreparation, createAnnualArchive, createTaxTransmission, generateApprovalMinutes, getGovernanceConfig, saveEdiPartnerConfig, saveGovernanceConfig, updateTaxTransmission, type EdiPartnerConfig, type GovernanceConfig } from "../services/annualComplianceService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import * as XLSX from "xlsx";

function periods(): FiscalPeriod[] {
  const companyId = workspaceContext.getStore()?.companyId ?? getActiveCompanyId(); const entity = getPlatformState().entities.find((item) => item.workspaceId === companyId);
  return [...(entity?.fiscalPeriods ?? [])].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

function selected(periodId?: string) {
  const available = periods(); const period = (periodId ? available.find((item) => item.id === periodId) : available.find((item) => item.endDate <= new Date().toISOString().slice(0, 10))) ?? available[0];
  if (!period) throw new Error("Aucun exercice comptable daté n’est enregistré pour cette structure."); return { period, available };
}

function selectedOpen(periodId?: string) { const result = selected(periodId); assertAnnualPeriodOpen(result.period); return result; }

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
    try { const { period, available } = selectedOpen(request.params.periodId); saveAnnualSetup(period, request.body?.profitTaxRegime ?? "unknown"); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { lines: OpeningBalanceLine[] } }>("/:periodId/opening-balance", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); saveOpeningBalance(period, request.body?.lines ?? []); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { review: Partial<AnnualReview> } }>("/:periodId/review", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); saveAnnualReview(period, request.body?.review ?? {}); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: InventoryEntryInput }>("/:periodId/inventory", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); createInventoryEntry(period, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string; entryId: string }; Body: InventoryEntryInput }>("/:periodId/inventory/:entryId", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); updateInventoryEntry(period, request.params.entryId, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; entryId: string } }>("/:periodId/inventory/:entryId/validate", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); validateInventoryEntry(period.id, request.params.entryId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; entryId: string }; Body: { reason: string } }>("/:periodId/inventory/:entryId/cancel", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); cancelInventoryEntry(period.id, request.params.entryId, request.body?.reason); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.delete<{ Params: { periodId: string; entryId: string } }>("/:periodId/inventory/:entryId", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); deleteInventoryDraft(period.id, request.params.entryId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: FiscalAdjustmentInput }>("/:periodId/fiscal-adjustments", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); createFiscalAdjustment(period.id, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string; adjustmentId: string }; Body: FiscalAdjustmentInput }>("/:periodId/fiscal-adjustments/:adjustmentId", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); updateFiscalAdjustment(period.id, request.params.adjustmentId, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; adjustmentId: string } }>("/:periodId/fiscal-adjustments/:adjustmentId/validate", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); validateFiscalAdjustment(period.id, request.params.adjustmentId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; adjustmentId: string }; Body: { reason: string } }>("/:periodId/fiscal-adjustments/:adjustmentId/cancel", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); cancelFiscalAdjustment(period.id, request.params.adjustmentId, request.body?.reason); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.delete<{ Params: { periodId: string; adjustmentId: string } }>("/:periodId/fiscal-adjustments/:adjustmentId", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); deleteFiscalDraft(period.id, request.params.adjustmentId); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { confirmed: boolean; note?: string } }>("/:periodId/fiscal-review", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); saveFiscalReview(period.id, request.body?.confirmed === true, request.body?.note ?? ""); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: AnnualTaxConfigInput }>("/:periodId/corporate-tax", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); const transactions = await loadAllTransactions(); const before = buildAnnualClosingSnapshot(period, transactions); saveAnnualTaxConfig(period, before.fiscalSummary.fiscalResult, before.taxCalculation.automaticTurnover, request.body); return { availablePeriods: available, ...buildAnnualClosingSnapshot(period, transactions) }; }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: AnnualFilingConfigInput }>("/:periodId/filing", async (request, reply) => {
    try { const { period, available } = selectedOpen(request.params.periodId); saveAnnualFilingConfig(period.id, request.body); return snapshot(period, available); }
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

  app.post<{ Params: { periodId: string }; Body: { confirm?: boolean } }>("/:periodId/finalize-tax-entry", async (request, reply) => {
    try {
      if (request.body?.confirm !== true) throw new Error("La confirmation explicite de la comptabilisation de l’IS est obligatoire.");
      const { period, available } = selectedOpen(request.params.periodId); const transactions = await loadAllTransactions(); const before = buildAnnualClosingSnapshot(period, transactions);
      if (!before.filingReady || !before.taxCalculation.ready) throw new Error("Le dossier fiscal doit être intégralement contrôlé avant de comptabiliser l’IS.");
      const amount = Math.round(Number(before.taxCalculation.netTax) * 100) / 100;
      if (amount <= .009) return { availablePeriods: available, ...before };
      const existingEntry = listActiveInventoryEntries(period.id).find((entry) => entry.kind === "corporate_tax");
      if (existingEntry) {
        const debit = existingEntry.lines.filter((line) => line.accountNumber.startsWith("695")).reduce((sum, line) => sum + line.debit - line.credit, 0);
        if (Math.abs(debit - amount) > .01) throw new Error(`Une écriture d’IS de ${debit.toFixed(2)} € existe déjà. Annule-la ou corrige le calcul avant de continuer.`);
        if (existingEntry.status === "draft") validateInventoryEntry(period.id, existingEntry.id);
      } else {
        const entry = createInventoryEntry(period, { date: period.endDate, kind: "corporate_tax", label: `Impôt sur les sociétés — exercice clos le ${period.endDate}`, reference: `IS-${period.endDate}`, lines: [
          { id: "", accountNumber: "695000", accountLabel: "Impôts sur les bénéfices", debit: amount, credit: 0 },
          { id: "", accountNumber: "444000", accountLabel: "État - Impôts sur les bénéfices", debit: 0, credit: amount },
        ] });
        validateInventoryEntry(period.id, entry.id);
      }
      const existingAdjustment = listFiscalAdjustments(period.id).find((item) => item.kind === "corporate_tax" && item.status !== "cancelled");
      if (existingAdjustment) {
        if (Math.abs(existingAdjustment.amount - amount) > .01) throw new Error(`Une réintégration d’IS de ${existingAdjustment.amount.toFixed(2)} € existe déjà et ne correspond pas au calcul.`);
        if (existingAdjustment.status === "draft") validateFiscalAdjustment(period.id, existingAdjustment.id);
      } else {
        const adjustment = createFiscalAdjustment(period.id, { type: "reintegration", kind: "corporate_tax", label: "Réintégration fiscale de l’impôt sur les sociétés", amount, accountNumber: "695000", reference: `IS-${period.endDate}` });
        validateFiscalAdjustment(period.id, adjustment.id);
      }
      saveFiscalReview(period.id, true, "IS comptabilisé au 695/444 et réintégré fiscalement par l’assistant de clôture.");
      return snapshot(period, available);
    } catch (caught) { return error(reply, caught); }
  });

  app.get<{ Params: { periodId: string } }>("/:periodId/efi-guide", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); return { period, fields: buildEfiGuide(data) }; }
    catch (caught) { return error(reply, caught); }
  });
  app.get<{ Params: { periodId: string } }>("/:periodId/tdfc-preparation", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); if (!data.filingReady) return reply.status(409).send({ error: "La liasse doit être complète et contrôlée avant l’export TDFC préparatoire." }); const payload = buildTdfcPreparation(data); return reply.header("Content-Disposition", `attachment; filename="tdfc-preparation-${period.endDate}.json"`).send(payload); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: { mode?: "efi" | "edi"; correctionOf?: string } }>("/:periodId/transmissions", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); if (!data.filingReady) throw new Error("La liasse doit être complète avant de créer un dossier de transmission."); const payload = buildTdfcPreparation(data); createTaxTransmission(period.id, request.body?.mode ?? "efi", payload.sha256, request.body?.correctionOf); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; transmissionId: string }; Body: { action: "validate" | "mark_sent" | "cancel"; note?: string } }>("/:periodId/transmissions/:transmissionId/action", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); const payload = buildTdfcPreparation(data); updateTaxTransmission(period.id, request.params.transmissionId, request.body?.action, payload.sha256, request.body?.note); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string; transmissionId: string }; Body: { fileName: string; contentBase64: string; outcome: "accepted" | "rejected"; note?: string } }>("/:periodId/transmissions/:transmissionId/receipt", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); attachTransmissionReceipt(period.id, request.params.transmissionId, request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: Omit<GovernanceConfig, "updatedAt"> }>("/:periodId/governance", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); saveGovernanceConfig(period.id, request.body, data.fiscalSummary.accountingResult); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: Omit<EdiPartnerConfig, "apiConfigured" | "updatedAt"> }>("/:periodId/edi-partner", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); saveEdiPartnerConfig(request.body); return snapshot(period, available); }
    catch (caught) { return error(reply, caught); }
  });
  app.get<{ Params: { periodId: string } }>("/:periodId/governance/minutes.pdf", async (request, reply) => {
    try { const { period, available } = selected(request.params.periodId); const data = await snapshot(period, available); const config = getGovernanceConfig(period.id, data); if (!config.meetingDate) throw new Error("Enregistre d’abord les informations réelles de l’assemblée."); const bytes = await generateApprovalMinutes(data, config); return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="pv-approbation-comptes-${period.endDate}.pdf"`).send(Buffer.from(bytes)); }
    catch (caught) { return error(reply, caught); }
  });

  app.post<{ Params: { periodId: string }; Body: { confirm?: boolean; nextPeriodId?: string } }>("/:periodId/finalize", async (request, reply) => {
    try {
      if (request.body?.confirm !== true) throw new Error("La confirmation explicite du verrouillage définitif est obligatoire.");
      const { period, available } = selectedOpen(request.params.periodId); const transactions = await loadAllTransactions(); const data = buildAnnualClosingSnapshot(period, transactions);
      if (!data.filingReady || !data.compliance.taxEntryReady) throw new Error("La liasse et l’écriture d’IS doivent être finalisées avant le verrouillage.");
      const next = request.body?.nextPeriodId ? available.find((item) => item.id === request.body?.nextPeriodId) : [...available].filter((item) => item.startDate > period.endDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
      if (request.body?.nextPeriodId && !next) throw new Error("L’exercice suivant sélectionné est introuvable.");
      const currentRecord = getAnnualClosingRecord(period);
      if (next && getAnnualClosingRecord(next).openingBalance.length) {
        const existing = getAnnualClosingRecord(next).openingBalance;
        const prior = currentRecord.correctionRequired?.priorCarryForward ?? [];
        if (!prior.length || JSON.stringify(existing) !== JSON.stringify(prior)) throw new Error("L’exercice suivant possède une balance d’ouverture différente du report initial. Contrôle-la avant de relancer le report.");
      }
      const carryForward = next ? buildCarryForwardBalance(data) : [];
      const preview = buildAnnualAccountingPreview(period, transactions); const filingPdf = await generateAnnualFilingPdf({ period, package: data.filingPackage, statements: data.simplifiedStatements }); const tdfc = buildTdfcPreparation(data);
      const archive = await createAnnualArchive({ source: data, preview, transactions: transactions.filter((item) => item.date >= period.startDate && item.date <= period.endDate), filingPdf, tdfc });
      let carriedForwardTo: string | undefined;
      if (next) { saveOpeningBalance(next, carryForward); carriedForwardTo = next.id; }
      saveAnnualLock(period, { lockHash: archive.sha256, archiveFile: archive.relativePath, carriedForwardTo });
      return snapshot(period, available);
    } catch (caught) { return error(reply, caught); }
  });
  app.post<{ Params: { periodId: string }; Body: { confirm?: boolean; reason?: string } }>("/:periodId/reopen-for-correction", async (request, reply) => {
    try {
      if (request.body?.confirm !== true) throw new Error("La confirmation explicite de la réouverture est obligatoire.");
      const { period, available } = selected(request.params.periodId); const record = getAnnualClosingRecord(period);
      if (!record.lockedAt) throw new Error("Cet exercice n’est pas verrouillé.");
      const transactions = await loadAllTransactions(); const data = buildAnnualClosingSnapshot(period, transactions);
      const priorCarryForward = record.carriedForwardTo ? buildCarryForwardBalance(data) : [];
      if (record.carriedForwardTo) {
        const next = available.find((item) => item.id === record.carriedForwardTo);
        if (!next) throw new Error("L’exercice ayant reçu le report initial est introuvable.");
        const existing = getAnnualClosingRecord(next).openingBalance;
        if (JSON.stringify(existing) !== JSON.stringify(priorCarryForward)) throw new Error("La balance d’ouverture de l’exercice suivant a été modifiée depuis le report. La réouverture automatique est bloquée pour protéger ces données.");
      }
      reopenAnnualPeriod(period, request.body?.reason ?? "", priorCarryForward);
      saveFiscalReview(period.id, false, `Revue à refaire après réouverture : ${String(request.body?.reason ?? "").trim()}`);
      invalidateAnnualFilingReview(period.id);
      return snapshot(period, available);
    } catch (caught) { return error(reply, caught); }
  });
  app.get<{ Params: { periodId: string } }>("/:periodId/archive", async (request, reply) => {
    try { const { period } = selected(request.params.periodId); const record = getAnnualClosingRecord(period); const archiveFile = record.archiveFile ?? record.correctionRequired?.archiveFile; if (!archiveFile) throw new Error("Aucune archive de clôture n’a encore été créée."); const base = resolve(getWorkspaceRoot(), "archives", "annual-closing"); const file = resolve(getWorkspaceRoot(), archiveFile); if (!file.startsWith(`${base}${sep}`) || !existsSync(file)) throw new Error("Archive de clôture introuvable."); return reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="${file.split(/[\\/]/).at(-1)}"`).send(readFileSync(file)); }
    catch (caught) { return error(reply, caught); }
  });
}
