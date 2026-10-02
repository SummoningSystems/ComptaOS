import type { FastifyInstance, FastifyReply } from "fastify";
import { actorHasGlobalAccess, createPerson, createRelation, deleteAccessGrant, deleteRelation, getPlatformState, getVisiblePlatformState, setAccessGrant, updatePerson, type PlatformAccessRole, type PlatformRelationType } from "../services/platformService.js";
import { actorContext } from "../services/workspaceContext.js";
import { getUserById } from "../services/authService.js";

function sendError(reply: FastifyReply, error: unknown) {
  const typed = error as Error & { code?: string };
  const status = typed.code === "REVISION_CONFLICT" ? 409 : typed.code === "NOT_FOUND" ? 404 : 400;
  return reply.status(status).send({ error: typed.message || "Requête invalide." });
}

export async function platformRoutes(app: FastifyInstance) {
  const actor = () => actorContext.getStore() ?? { id: "local", role: "local" as const };
  const requireAdmin = (reply: FastifyReply) => {
    const current = actor();
    if (!actorHasGlobalAccess(current)) { void reply.status(403).send({ error: "Droits administrateur requis." }); return null; }
    return current;
  };

  app.get("/", async () => getVisiblePlatformState(actor()));

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

  app.patch("/people/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const { id } = req.params as { id: string };
      return updatePerson(id, req.body as { name?: string; profile?: "individual" | "professional"; notes?: string; expectedRevision?: number });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/relations", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const result = createRelation(req.body as { fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; expectedRevision?: number });
      return reply.status(result.created ? 201 : 200).send(result);
    } catch (error) { return sendError(reply, error); }
  });

  app.delete("/relations/:id", async (req, reply) => {
    if (!requireAdmin(reply)) return;
    try {
      const { id } = req.params as { id: string };
      const query = req.query as { expectedRevision?: string };
      return deleteRelation(id, query.expectedRevision === undefined ? undefined : Number(query.expectedRevision));
    } catch (error) { return sendError(reply, error); }
  });
}
