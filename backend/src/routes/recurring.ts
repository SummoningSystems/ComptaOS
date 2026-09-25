import {readRecurring,writeRecurring,planningContext} from "../services/ecosystemPlanning.js";
import { FastifyInstance } from "fastify";
import {
  loadManualRecurring,
  saveManualRecurring,
  ManualRecurring,
  isManualRecurring,
} from "../services/manualRecurringService.js";

export async function recurringRoutes(app: FastifyInstance) {
  app.get("/manual", async (_req,reply) => {
    const c=await planningContext();if(c)reply.header("X-Ecosystem-Revision",c.state.revision);
    return readRecurring();
  });

  app.put<{ Body: ManualRecurring[] }>("/manual", async (req, reply) => {
    const entries = req.body;
    if (!Array.isArray(entries) || !entries.every(isManualRecurring)) {
      return reply.status(400).send({ error: "La liste contient un frais récurrent invalide." });
    }
    if(!await writeRecurring(entries,req.headers["x-ecosystem-revision"]===undefined?undefined:Number(req.headers["x-ecosystem-revision"])))saveManualRecurring(entries);
    const updated=await planningContext();if(updated)reply.header("X-Ecosystem-Revision",updated.state.revision);
    return reply.send({ saved: entries.length });
  });
}
