import {requireAdmin} from "../services/ecosystemService.js";
import {workspaceContext,actorContext} from "../services/workspaceContext.js";
import { FastifyInstance } from "fastify";
import {
  listPlugins,
  setPluginEnabled,
  createExamplePlugin,
  runPlugin,
} from "../services/pluginService.js";

export async function pluginsRoutes(app: FastifyInstance) {
  /** GET /api/plugins — liste tous les plugins */
  app.get("/", async (_req, reply) => {
    createExamplePlugin();
    return reply.send(listPlugins());
  });

  /** POST /api/plugins/:name/enable */
  app.post<{ Params: { name: string } }>("/:name/enable", async (req, reply) => {
    try {
      requireAdmin();setPluginEnabled(req.params.name, true);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  /** POST /api/plugins/:name/disable */
  app.post<{ Params: { name: string } }>("/:name/disable", async (req, reply) => {
    try {
      requireAdmin();setPluginEnabled(req.params.name, false);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(404).send({ error: (err as Error).message });
    }
  });

  /** POST /api/plugins/:name/run — exécute un hook manuellement (test) */
  app.post<{ Params: { name: string }; Body: { hook: string; context: Record<string, unknown> } }>(
    "/:name/run",
    async (req, reply) => {
      requireAdmin();const { hook, context } = req.body;
      if (!hook) return reply.status(400).send({ error: "hook requis" });
      const result = runPlugin(req.params.name, hook, {...(context??{}),scope:workspaceContext.getStore()?.id,actor:actorContext.getStore()?.id});
      return reply.send({ result });
    },
  );
}
