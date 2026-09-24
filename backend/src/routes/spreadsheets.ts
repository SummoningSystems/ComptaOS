import { FastifyInstance } from "fastify";
import {
  listSpreadsheets,
  getSpreadsheet,
  createSpreadsheet,
  saveSpreadsheet,
  deleteSpreadsheet,
  getAccountingVariables,
  SpreadsheetDoc,
} from "../services/spreadsheetService.js";

export async function spreadsheetsRoutes(app: FastifyInstance, options: {variables?:()=>Promise<Record<string,number>>} = {}) {
  // GET /api/spreadsheets
  app.get("/", async (_req, reply) => {
    const docs = await listSpreadsheets();
    return reply.send(docs);
  });

  // GET /api/spreadsheets/variables — variables comptables
  app.get("/variables", async (_req, reply) => {
    const vars = await (options.variables??getAccountingVariables)();
    return reply.send(vars);
  });

  // GET /api/spreadsheets/:id
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const doc = await getSpreadsheet(req.params.id);
    if (!doc) return reply.status(404).send({ error: "Feuille introuvable" });
    return reply.send(doc);
  });

  // POST /api/spreadsheets — créer
  app.post<{ Body: { name: string } }>("/", async (req, reply) => {
    const { name } = req.body;
    if (!name?.trim()) return reply.status(400).send({ error: "name requis" });
    const doc = await createSpreadsheet(name.trim());
    return reply.status(201).send(doc);
  });

  // PUT /api/spreadsheets/:id — sauvegarder le contenu complet
  app.put<{ Params: { id: string }; Body: SpreadsheetDoc }>("/:id", async (req, reply) => {
    const body = req.body;
    if (body.id !== req.params.id) return reply.status(400).send({ error: "id mismatch" });
    const saved = await saveSpreadsheet(body);
    return reply.send(saved);
  });

  // DELETE /api/spreadsheets/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await deleteSpreadsheet(req.params.id);
    return reply.send({ ok: true });
  });
}
