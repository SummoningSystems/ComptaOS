import { FastifyInstance } from "fastify";
import {
  loadManualRecurring,
  saveManualRecurring,
  ManualRecurring,
  isManualRecurring,
} from "../services/manualRecurringService.js";

export async function recurringRoutes(app: FastifyInstance) {
  app.get("/manual", async () => {
    return loadManualRecurring();
  });

  app.put<{ Body: ManualRecurring[] }>("/manual", async (req, reply) => {
    const entries = req.body;
    if (!Array.isArray(entries) || !entries.every(isManualRecurring)) {
      return reply.status(400).send({ error: "La liste contient un frais récurrent invalide." });
    }
    saveManualRecurring(entries);
    return reply.send({ saved: entries.length });
  });
}
