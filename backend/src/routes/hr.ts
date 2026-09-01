import { FastifyInstance } from "fastify";
import { isHrEmployee, loadHrEmployees, saveHrEmployees, type HrEmployee } from "../services/hrService.js";

export async function hrRoutes(app: FastifyInstance) {
  app.get("/employees", async () => loadHrEmployees());
  app.put<{ Body: HrEmployee[] }>("/employees", async (request, reply) => {
    if (!Array.isArray(request.body) || !request.body.every(isHrEmployee)) return reply.status(400).send({ error: "La liste contient un dossier RH invalide." });
    saveHrEmployees(request.body);
    return reply.send({ saved: request.body.length });
  });
}
