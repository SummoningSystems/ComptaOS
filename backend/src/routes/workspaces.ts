import type { FastifyInstance } from "fastify";
import { createCompany, ensureDefaultCompany, loadCompanies, saveCompanies } from "../services/companiesService.js";
import { actorContext, workspaceContext } from "../services/workspaceContext.js";
import { initializeHousehold } from "../services/householdService.js";
import { resolveCompanyPath } from "../services/companiesService.js";

export async function workspacesRoutes(app: FastifyInstance) {
  app.get("/", async () => {
    ensureDefaultCompany();
    const actor = actorContext.getStore();
    return loadCompanies().filter(c => !c.memberIds || actor?.id === "local" || c.memberIds.includes(actor?.id ?? ""));
  });
  app.post<{ Body: { name: string; kind?: "business" | "household"; people?: string[] } }>("/", async (req, reply) => {
    const actor = actorContext.getStore() ?? { id: "local", role: "owner" };
    if (!["owner", "admin"].includes(actor.role)) return reply.code(403).send({ error: "Administrateur requis." });
    const { name, kind = "business", people } = req.body ?? {};
    if (typeof name !== "string" || !name.trim() || !["business", "household"].includes(kind)) return reply.code(400).send({ error: "Nom et type requis." });
    if (kind === "household" && (!Array.isArray(people) || people.length !== 2 || people.some(p => typeof p !== "string" || !p.trim()))) return reply.code(400).send({ error: "Indiquez les deux personnes." });
    const company = createCompany(name.trim(), false);
    company.kind = kind;
    company.memberIds = [actor.id];
    if (kind === "household") await workspaceContext.run({ id: company.id, root: resolveCompanyPath(company), kind, actor: actor.id, role: actor.role }, () => initializeHousehold(people!));
    saveCompanies([...loadCompanies(), company]);
    return reply.code(201).send(company);
  });
}

/** Invitations grant membership only in their selected workspace. */
export function joinInviterWorkspaces(inviterId: string, userId: string, workspaceId: string) {
  const list = loadCompanies();
  for (const workspace of list) if (workspace.id === workspaceId && workspace.memberIds?.includes(inviterId) && !workspace.memberIds.includes(userId)) workspace.memberIds.push(userId);
  saveCompanies(list);
}
