import { FastifyInstance } from "fastify";
import {
  getLog, getDiff, hasRepo,
  getSyncStatus, syncPush, syncPull,
  testRemoteConnection, writeSyncConfig, deleteSyncConfig,
  type GitSyncConfig,
} from "../services/gitService.js";
import { getCompaniesRoot } from "../services/companiesService.js";

export async function gitRoutes(app: FastifyInstance) {
  /**
   * GET /api/git/log
   * Retourne les N derniers commits du workspace actif.
   */
  app.get<{ Querystring: { n?: string } }>("/log", async (req, reply) => {
    const root = getCompaniesRoot();
    const ok = await hasRepo(root);
    if (!ok) return reply.send({ commits: [], initialized: false });
    const n = Math.min(parseInt(req.query.n ?? "100", 10), 500);
    const commits = await getLog(root, n);
    return reply.send({ commits, initialized: true });
  });

  /**
   * GET /api/git/diff/:hash
   * Retourne le diff complet d'un commit.
   */
  app.get<{ Params: { hash: string } }>("/diff/:hash", async (req, reply) => {
    const { hash } = req.params;
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) {
      return reply.status(400).send({ error: "hash invalide" });
    }
    const diff = await getDiff(getCompaniesRoot(), hash);
    return reply.send({ diff });
  });

  // ── Synchronisation distante ─────────────────────────────────────────────

  /** GET /api/git/sync — Statut de synchronisation */
  app.get("/sync", async (_req, reply) => {
    const status = await getSyncStatus(getCompaniesRoot());
    return reply.send(status);
  });

  /** POST /api/git/sync/configure — Enregistre la config et teste la connexion */
  app.post<{ Body: GitSyncConfig }>("/sync/configure", async (req, reply) => {
    const { provider, remoteUrl, token, branch } = req.body;
    if (!provider || !remoteUrl || !token || !branch) {
      return reply.status(400).send({ error: "Champs requis : provider, remoteUrl, token, branch" });
    }
    // Valider l'URL
    try { new URL(remoteUrl); } catch {
      return reply.status(400).send({ error: "URL invalide" });
    }
    // Tester la connexion avant de sauvegarder
    const test = await testRemoteConnection(getCompaniesRoot(), { provider, remoteUrl, token, branch });
    if (!test.ok) {
      return reply.status(422).send({ error: `Connexion échouée : ${test.error}` });
    }
    await writeSyncConfig(getCompaniesRoot(), { provider, remoteUrl, token, branch });
    return reply.send({ ok: true });
  });

  /** POST /api/git/sync/test — Teste la connexion sans sauvegarder */
  app.post<{ Body: GitSyncConfig }>("/sync/test", async (req, reply) => {
    const { provider, remoteUrl, token, branch } = req.body;
    if (!remoteUrl || !token) {
      return reply.status(400).send({ error: "remoteUrl et token requis" });
    }
    try { new URL(remoteUrl); } catch {
      return reply.status(400).send({ error: "URL invalide" });
    }
    const result = await testRemoteConnection(getCompaniesRoot(), {
      provider: provider ?? "custom", remoteUrl, token, branch: branch ?? "main",
    });
    return reply.send(result);
  });

  /** POST /api/git/sync/push — Pousse vers le remote */
  app.post("/sync/push", async (_req, reply) => {
    const result = await syncPush(getCompaniesRoot());
    return reply.status(result.ok ? 200 : 422).send(result);
  });

  /** POST /api/git/sync/pull — Récupère depuis le remote */
  app.post("/sync/pull", async (_req, reply) => {
    const result = await syncPull(getCompaniesRoot());
    return reply.status(result.ok ? 200 : 422).send(result);
  });

  /** DELETE /api/git/sync — Supprime la configuration de synchronisation */
  app.delete("/sync", async (_req, reply) => {
    await deleteSyncConfig(getCompaniesRoot());
    return reply.send({ ok: true });
  });
}
