import type { FastifyInstance, FastifyReply } from "fastify";
import { getActiveCompanyId } from "../services/companiesService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { getPlatformState } from "../services/platformService.js";
import { workspaceContext } from "../services/workspaceContext.js";
import { buildAnnualClosingSnapshot, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, type AnnualReview, type FiscalPeriod, type OpeningBalanceLine, type ProfitTaxRegime } from "../services/annualClosingService.js";
import { cancelInventoryEntry, createInventoryEntry, deleteInventoryDraft, updateInventoryEntry, validateInventoryEntry, type InventoryEntryInput } from "../services/annualInventoryService.js";
import { cancelFiscalAdjustment, createFiscalAdjustment, deleteFiscalDraft, saveFiscalReview, updateFiscalAdjustment, validateFiscalAdjustment, type FiscalAdjustmentInput } from "../services/annualFiscalService.js";
import { saveAnnualTaxConfig, type AnnualTaxConfigInput } from "../services/annualTaxService.js";

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
}
