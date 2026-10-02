import type { FastifyInstance, FastifyReply } from "fastify";
import { actorHasGlobalAccess, createHousehold, createPerson, createRelation, deleteAccessGrant, deleteRelation, getPlatformState, getScopeAccess, getStructureIssues, getVisiblePlatformState, setAccessGrant, updateEntity, updatePerson, updateRelation, type PlatformAccessRole, type PlatformEntity, type RelationInput } from "../services/platformService.js";
import { actorContext } from "../services/workspaceContext.js";
import { getUserById } from "../services/authService.js";
import { getPersonalFinance, savePersonalBudgets, setPersonalTransactionCategory } from "../services/personalFinanceService.js";
import { getFinanceAllocationSnapshot, saveAccountAssignment, saveBatchAllocation, saveTransactionAllocations, type AccountUsage, type FinanceAllocation } from "../services/financeAllocationService.js";
import { getHouseholdFinance, saveHouseholdBudgets } from "../services/householdFinanceService.js";
import { getPlatformLayout, savePlatformLayout, type PlatformLayout } from "../services/platformLayoutService.js";
import { ensureAccountingDossier, getAccountingDossiers } from "../services/accountingDossierService.js";
import { advancePortfolioTransfer, correctPortfolioTransfer, createPortfolioCommitment, createPortfolioTransfer, deletePortfolioCommitment, deletePortfolioTransfer, getPortfolioSnapshot, savePortfolioAssumptions, type PortfolioAssumptions, type PortfolioCommitment, type PortfolioTransfer, type PortfolioTransferInput } from "../services/portfolioService.js";

function sendError(reply: FastifyReply, error: unknown) {
  const typed = error as Error & { code?: string };
  const status = typed.code === "REVISION_CONFLICT" ? 409 : typed.code === "NOT_FOUND" ? 404 : typed.code === "FORBIDDEN" ? 403 : 400;
  return reply.status(status).send({ error: typed.message || "Requête invalide." });
}

export async function platformRoutes(app: FastifyInstance) {
  const actor = () => actorContext.getStore() ?? { id: "local", role: "local" as const };
  const requireAdmin = (reply: FastifyReply) => {
    const current = actor();
    if (!actorHasGlobalAccess(current)) { void reply.status(403).send({ error: "Droits administrateur requis." }); return null; }
    return current;
  };
  const requirePersonAccess = (personId: string, reply: FastifyReply, write = false) => {
    const current = actor();
    const visible = getVisiblePlatformState(current).people.some((person) => person.id === personId);
    const access = getScopeAccess(current, personId);
    if (!visible || (write && !actorHasGlobalAccess(current) && access !== "owner" && access !== "manager")) {
      void reply.status(403).send({ error: write ? "Droits de gestion requis sur cette personne." : "Cette personne ne vous est pas attribuée." }); return null;
    }
    return current;
  };
  const requireHouseholdAccess = (householdId: string, reply: FastifyReply, write = false) => {
    const current = actor(); const visible = getVisiblePlatformState(current).households.some((household) => household.id === householdId); const access = getScopeAccess(current, householdId);
    if (!visible || (write && !actorHasGlobalAccess(current) && access !== "owner" && access !== "manager")) { void reply.status(403).send({ error: write ? "Droits de gestion requis sur ce foyer." : "Ce foyer ne vous est pas attribué." }); return null; }
    return current;
  };

  app.get("/", async () => getVisiblePlatformState(actor()));
  app.get("/completeness", async () => getStructureIssues(getVisiblePlatformState(actor())));

  app.get("/layout", async () => getPlatformLayout(actor()));

  app.put("/layout", async (req, reply) => {
    try { return savePlatformLayout(actor(), (req.body as { positions?: PlatformLayout }).positions ?? {}); }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/dossiers", async () => getAccountingDossiers(actor()));

  app.post("/dossiers/:scopeId", async (req, reply) => {
    try { const { scopeId } = req.params as { scopeId: string }; return reply.status(201).send(ensureAccountingDossier(scopeId, actor())); }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/access", async (_req, reply) => requireAdmin(reply) ? getPlatformState().grants : undefined);

  app.put("/access", async (req, reply) => {
    const current = requireAdmin(reply); if (!current) return;
    try {
      const input = req.body as { userId: string; scopeId: string; role: PlatformAccessRole; expectedRevision?: number };
      if (!getUserById(input.userId)) return reply.status(404).send({ error: "Utilisateur introuvable." });
      return setAccessGrant({ ...input, createdBy: current.id });
    } catch (error) { return sendError(reply, error); }
  });

  app.delete("/access/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try { const { id } = req.params as { id: string }; const query = req.query as { expectedRevision?: string }; return deleteAccessGrant(id, query.expectedRevision === undefined ? undefined : Number(query.expectedRevision)); }
    catch (error) { return sendError(reply, error); }
  });

  app.post("/people", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      return reply.status(201).send(createPerson(req.body as { name: string; profile?: "individual" | "professional"; notes?: string; expectedRevision?: number }));
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/households", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try { return reply.status(201).send(createHousehold(req.body as { name: string; notes?: string; expectedRevision?: number })); }
    catch (error) { return sendError(reply, error); }
  });

  app.patch("/people/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const { id } = req.params as { id: string };
      return updatePerson(id, req.body as { name?: string; profile?: "individual" | "professional"; notes?: string; expectedRevision?: number });
    } catch (error) { return sendError(reply, error); }
  });

  app.patch("/entities/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try { const { id } = req.params as { id: string }; return updateEntity(id, req.body as Partial<PlatformEntity> & { expectedRevision?: number }); }
    catch (error) { return sendError(reply, error); }
  });

  app.post("/relations", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const result = createRelation(req.body as RelationInput);
      return reply.status(result.created ? 201 : 200).send(result);
    } catch (error) { return sendError(reply, error); }
  });

  app.patch("/relations/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try { const { id } = req.params as { id: string }; return updateRelation(id, req.body as Partial<RelationInput>); }
    catch (error) { return sendError(reply, error); }
  });

  app.delete("/relations/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const { id } = req.params as { id: string };
      const query = req.query as { expectedRevision?: string };
      return deleteRelation(id, query.expectedRevision === undefined ? undefined : Number(query.expectedRevision));
    } catch (error) { return sendError(reply, error); }
  });

  app.get("/people/:id/finance", async (req, reply) => {
    const { id } = req.params as { id: string }; const current = requirePersonAccess(id, reply); if (!current) return;
    try {
      const query = req.query as { month?: string };
      const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : new Date().toISOString().slice(0, 7);
      return await getPersonalFinance(id, month, current);
    } catch (error) { return sendError(reply, error); }
  });

  app.patch("/people/:id/finance/category", async (req, reply) => {
    const { id } = req.params as { id: string }; if (!requirePersonAccess(id, reply, true)) return;
    try { const input = req.body as { key: string; category: string }; if (!input.key) throw new Error("Transaction requise."); setPersonalTransactionCategory(id, input.key, input.category); return { saved: true }; }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/people/:id/finance/budgets", async (req, reply) => {
    const { id } = req.params as { id: string }; if (!requirePersonAccess(id, reply, true)) return;
    try { return savePersonalBudgets(id, req.body as Array<{ category: string; monthlyLimit: number }>); }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/households/:id/finance", async (req, reply) => {
    const { id } = req.params as { id: string }; const current = requireHouseholdAccess(id, reply); if (!current) return;
    try { const query = req.query as { month?: string }; const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : new Date().toISOString().slice(0, 7); return await getHouseholdFinance(id, month, current); }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/households/:id/finance/budgets", async (req, reply) => {
    const { id } = req.params as { id: string }; if (!requireHouseholdAccess(id, reply, true)) return;
    try { return saveHouseholdBudgets(id, req.body as Array<{ category: string; monthlyLimit: number }>); }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/allocations", async (req, reply) => {
    try { const query = req.query as { month?: string }; const month = /^\d{4}-\d{2}$/.test(query.month ?? "") ? query.month! : new Date().toISOString().slice(0, 7); return await getFinanceAllocationSnapshot(actor(), month); }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/allocations/accounts/:id", async (req, reply) => {
    try { const { id } = req.params as { id: string }; return saveAccountAssignment(id, req.body as { usage: AccountUsage; defaultScopeId?: string }, actor()); }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/allocations/transactions", async (req, reply) => {
    try { const input = req.body as { month: string; key: string; allocations: FinanceAllocation[]; rememberRule?: boolean }; return await saveTransactionAllocations(actor(), input.month, input.key, input.allocations, input.rememberRule); }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/allocations/transactions/batch", async (req, reply) => {
    try { const input = req.body as { month: string; keys: string[]; scopeId: string }; return { saved: await saveBatchAllocation(actor(), input.month, input.keys, input.scopeId) }; }
    catch (error) { return sendError(reply, error); }
  });

  app.get("/portfolio", async (req, reply) => {
    try {
      const query = req.query as { rootScopeId?: string; scopeIds?: string; horizon?: string; month?: string };
      if (!query.rootScopeId) throw new Error("Périmètre racine requis.");
      const horizon = Math.min(60, Math.max(1, Number(query.horizon) || 12));
      const scopeIds = query.scopeIds?.split(",").filter(Boolean);
      return await getPortfolioSnapshot(actor(), query.rootScopeId, horizon, scopeIds, query.month);
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/portfolio/transfers", async (req, reply) => {
    try { return reply.status(201).send(await createPortfolioTransfer(actor(), req.body as PortfolioTransferInput)); }
    catch (error) { return sendError(reply, error); }
  });

  app.delete("/portfolio/transfers/:id", async (req, reply) => {
    try { const { id } = req.params as { id: string }; deletePortfolioTransfer(actor(), id); return { deleted: true }; }
    catch (error) { return sendError(reply, error); }
  });

  app.post("/portfolio/transfers/:id/workflow", async (req, reply) => {
    try { const { id } = req.params as { id: string }; const input = req.body as { action: "review" | "validate" | "post" | "cancel"; note?: string }; return advancePortfolioTransfer(actor(), id, input.action, input.note); }
    catch (error) { return sendError(reply, error); }
  });

  app.patch("/portfolio/transfers/:id", async (req, reply) => {
    try { const { id } = req.params as { id: string }; return correctPortfolioTransfer(actor(), id, req.body as Partial<Pick<PortfolioTransfer, "amount" | "fee" | "date" | "label" | "treatment">> & { note: string }); }
    catch (error) { return sendError(reply, error); }
  });

  app.put("/portfolio/assumptions", async (req, reply) => {
    try { return savePortfolioAssumptions(actor(), req.body as PortfolioAssumptions); }
    catch (error) { return sendError(reply, error); }
  });

  app.post("/portfolio/commitments", async (req, reply) => {
    try { return reply.status(201).send(createPortfolioCommitment(actor(), req.body as Omit<PortfolioCommitment, "id" | "createdAt">)); }
    catch (error) { return sendError(reply, error); }
  });

  app.delete("/portfolio/commitments/:id", async (req, reply) => {
    try { const { id } = req.params as { id: string }; deletePortfolioCommitment(actor(), id); return { deleted: true }; }
    catch (error) { return sendError(reply, error); }
  });
}
