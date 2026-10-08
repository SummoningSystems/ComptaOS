import type { FastifyInstance, FastifyReply } from "fastify";
import { getActiveCompanyId } from "../services/companiesService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { getPlatformState } from "../services/platformService.js";
import { workspaceContext } from "../services/workspaceContext.js";
import { buildAnnualClosingSnapshot, saveAnnualReview, saveAnnualSetup, saveOpeningBalance, type AnnualReview, type FiscalPeriod, type OpeningBalanceLine, type ProfitTaxRegime } from "../services/annualClosingService.js";

function periods(): FiscalPeriod[] {
  const companyId = workspaceContext.getStore()?.companyId ?? getActiveCompanyId(); const entity = getPlatformState().entities.find((item) => item.workspaceId === companyId);
  return [...(entity?.fiscalPeriods ?? [])].sort((a, b) => b.endDate.localeCompare(a.endDate));
}

function selected(periodId?: string) {
  const available = periods(); const period = (periodId ? available.find((item) => item.id === periodId) : available.find((item) => item.endDate <= new Date().toISOString().slice(0, 10))) ?? available[0];
  if (!period) throw new Error("Aucun exercice comptable daté n’est enregistré pour cette structure."); return { period, available };
}

function error(reply: FastifyReply, caught: unknown) { return reply.status(400).send({ error: caught instanceof Error ? caught.message : "Requête invalide." }); }

export async function annualClosingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { periodId?: string } }>("/", async (request, reply) => {
    try { const { period, available } = selected(request.query.periodId); return { availablePeriods: available, ...buildAnnualClosingSnapshot(period, await loadAllTransactions()) }; }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { profitTaxRegime: ProfitTaxRegime } }>("/:periodId/setup", async (request, reply) => {
    try { const { period } = selected(request.params.periodId); saveAnnualSetup(period, request.body?.profitTaxRegime ?? "unknown"); return buildAnnualClosingSnapshot(period, await loadAllTransactions()); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { lines: OpeningBalanceLine[] } }>("/:periodId/opening-balance", async (request, reply) => {
    try { const { period } = selected(request.params.periodId); saveOpeningBalance(period, request.body?.lines ?? []); return buildAnnualClosingSnapshot(period, await loadAllTransactions()); }
    catch (caught) { return error(reply, caught); }
  });
  app.put<{ Params: { periodId: string }; Body: { review: Partial<AnnualReview> } }>("/:periodId/review", async (request, reply) => {
    try { const { period } = selected(request.params.periodId); saveAnnualReview(period, request.body?.review ?? {}); return buildAnnualClosingSnapshot(period, await loadAllTransactions()); }
    catch (caught) { return error(reply, caught); }
  });
}
