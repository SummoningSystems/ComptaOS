import { FastifyInstance } from "fastify";
import {
  loadCompanies,
  createCompany,
  getActiveCompanyId,
  setActiveCompanyId,
  invalidateActiveCompanyCache,
  ensureDefaultCompany,
} from "../services/companiesService.js";
import { invalidateTransactionCache } from "../services/transactionService.js";
import { actorHasGlobalAccess, getScopeAccess } from "../services/platformService.js";
import { actorContext } from "../services/workspaceContext.js";
import { getSelectedCompany, setSelectedCompany } from "../services/workspaceSelectionService.js";

function visibleCompanies() {
  const actor = actorContext.getStore() ?? { id: "local", role: "local" as const };
  return loadCompanies().filter((company) => actorHasGlobalAccess(actor) || getScopeAccess(actor, company.scopeId ?? `entity_${company.id}`) !== null);
}

export async function companiesRoutes(app: FastifyInstance) {
  /** Liste toutes les entreprises */
  app.get("/", async () => {
    ensureDefaultCompany();
    return visibleCompanies();
  });

  /** Retourne l'entreprise active */
  app.get("/active", async () => {
    ensureDefaultCompany();
    const companies = visibleCompanies();
    const actor = actorContext.getStore() ?? { id: "local", role: "local" as const };
    const activeId = getSelectedCompany(actor.id) ?? getActiveCompanyId();
    return companies.find((c) => c.id === activeId) ?? companies[0] ?? null;
  });

  /** Change l'entreprise active */
  app.put("/active", async (req, reply) => {
    const { companyId } = req.body as { companyId: string };
    ensureDefaultCompany();
    const companies = visibleCompanies();
    if (!companies.find((c) => c.id === companyId)) {
      return reply.status(404).send({ error: "Entreprise introuvable" });
    }
    const actor = actorContext.getStore() ?? { id: "local", role: "local" as const };
    setSelectedCompany(actor.id, companyId);
    if (actor.id === "local") { setActiveCompanyId(companyId); invalidateActiveCompanyCache(); }
    invalidateTransactionCache();
    return { ok: true };
  });

  /** Crée une nouvelle entreprise */
  app.post("/", async (req, reply) => {
    const actor = actorContext.getStore();
    if (actor && !actorHasGlobalAccess(actor)) return reply.status(403).send({ error: "Droits administrateur requis." });
    const { name, legalType } = req.body as { name: string; legalType?: "company" | "sci" | "holding" | "association" | "sole_proprietorship" | "other" };
    if (!name?.trim()) return reply.status(400).send({ error: "Nom requis" });
    if (legalType && !["company", "sci", "holding", "association", "sole_proprietorship", "other"].includes(legalType)) return reply.status(400).send({ error: "Type de structure invalide" });
    const company = createCompany(name.trim(), legalType);
    return reply.status(201).send(company);
  });
}
