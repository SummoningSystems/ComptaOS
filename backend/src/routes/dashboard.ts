import { FastifyInstance } from "fastify";
import { computeDashboard } from "../services/dashboardService.js";

export async function dashboardRoutes(app: FastifyInstance) {
  // GET /api/dashboard
  app.get<{ Querystring: { year?: string } }>("/", async (req, reply) => {
    const year = req.query.year;
    if (year !== undefined && !/^\d{4}$/.test(year)) {
      return reply.status(400).send({ error: "Exercice invalide" });
    }
    const data = await computeDashboard(year);
    return reply.send(data);
  });
}
