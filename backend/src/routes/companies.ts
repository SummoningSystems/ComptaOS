import { actorContext } from "../services/workspaceContext.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getCompaniesRoot } from "../services/companiesService.js";
import { atomicWriteFileSync } from "../services/atomicFile.js";
import { FastifyInstance } from "fastify";
import {
  loadCompanies,
  createCompany,
  getActiveCompanyId,
  ensureDefaultCompany,
} from "../services/companiesService.js";

function preferences(): Record<string,string> { const file = join(getCompaniesRoot(), "_preferences.json"); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; }
function visible() { const actor = actorContext.getStore(); return loadCompanies().filter(c => !c.memberIds || actor?.id === "local" || c.memberIds.includes(actor?.id ?? "")); }
export async function companiesRoutes(app: FastifyInstance) {
  /** Liste toutes les entreprises */
  app.get("/", async () => {
    ensureDefaultCompany();
    return visible();
  });

  /** Retourne l'entreprise active */
  app.get("/active", async () => {
    ensureDefaultCompany();
    const companies = visible();
    const activeId = preferences()[actorContext.getStore()?.id ?? "local"] ?? getActiveCompanyId();
    return companies.find((c) => c.id === activeId) ?? companies[0] ?? null;
  });

  /** Change l'entreprise active */
  app.put("/active", async (req, reply) => {
    const { companyId } = req.body as { companyId: string };
    ensureDefaultCompany();
    const companies = visible();
    if (!companies.find((c) => c.id === companyId)) {
      return reply.status(404).send({ error: "Entreprise introuvable" });
    }
    atomicWriteFileSync(join(getCompaniesRoot(), "_preferences.json"), JSON.stringify({ ...preferences(), [actorContext.getStore()?.id ?? "local"]: companyId }));
    return { ok: true };
  });

  /** Crée une nouvelle entreprise */
  app.post("/", async (req, reply) => {
    if (!["owner", "admin"].includes(actorContext.getStore()?.role ?? "owner")) return reply.code(403).send({ error: "Administrateur requis" });
    const { name } = req.body as { name: string };
    if (!name?.trim()) return reply.status(400).send({ error: "Nom requis" });
    const company = createCompany(name.trim());
    return reply.status(201).send(company);
  });
}
