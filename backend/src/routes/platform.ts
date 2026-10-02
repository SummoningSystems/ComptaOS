import type { FastifyInstance, FastifyReply } from "fastify";
import { createPerson, createRelation, deleteRelation, getPlatformState, updatePerson, type PlatformRelationType } from "../services/platformService.js";

function sendError(reply: FastifyReply, error: unknown) {
  const typed = error as Error & { code?: string };
  const status = typed.code === "REVISION_CONFLICT" ? 409 : typed.code === "NOT_FOUND" ? 404 : 400;
  return reply.status(status).send({ error: typed.message || "Requête invalide." });
}

export async function platformRoutes(app: FastifyInstance) {
  app.get("/", async () => getPlatformState());

  app.post("/people", async (req, reply) => {
    try {
      return reply.status(201).send(createPerson(req.body as { name: string; profile?: "individual" | "professional"; notes?: string; expectedRevision?: number }));
    } catch (error) { return sendError(reply, error); }
  });

  app.patch("/people/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      return updatePerson(id, req.body as { name?: string; profile?: "individual" | "professional"; notes?: string; expectedRevision?: number });
    } catch (error) { return sendError(reply, error); }
  });

  app.post("/relations", async (req, reply) => {
    try {
      return reply.status(201).send(createRelation(req.body as { fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; expectedRevision?: number }));
    } catch (error) { return sendError(reply, error); }
  });

  app.delete("/relations/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string };
      const query = req.query as { expectedRevision?: string };
      return deleteRelation(id, query.expectedRevision === undefined ? undefined : Number(query.expectedRevision));
    } catch (error) { return sendError(reply, error); }
  });
}
