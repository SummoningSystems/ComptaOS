import { FastifyInstance } from "fastify";
import {
  loadCategoryRules,
  saveCategoryRules,
  loadTreasuryAlert,
  saveTreasuryAlert,
  loadAiConfig,
  saveAiConfig,
  loadBudgets,
  saveBudgets,
  loadCompanyProfile,
  saveCompanyProfile,
  CategoryRule,
  TreasuryAlert,
  AiConfig,
  CategoryBudget,
  CompanyProfile,
} from "../services/settingsService.js";
import { BUILTIN_CATEGORIES, deactivateCustomCategory, loadCategoryCatalog, upsertCustomCategory } from "../services/categoryCatalogService.js";

interface CategoryBody { id?: string; label?: string; account?: { number?: string; label?: string }; active?: boolean }

function validateCategory(body: CategoryBody, existingId?: string): string | null {
  const id = existingId ?? body.id ?? "";
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return "Le code doit contenir 2 à 40 lettres minuscules, chiffres ou underscores.";
  if (!body.label?.trim()) return "Le libellé est requis.";
  if (!/^\d{3,10}$/.test(body.account?.number?.trim() ?? "")) return "Le compte PCG doit contenir 3 à 10 chiffres.";
  if (!body.account?.label?.trim()) return "Le libellé du compte est requis.";
  return null;
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get("/categories", async (_req, reply) => reply.send(loadCategoryCatalog()));

  app.post<{ Body: CategoryBody }>("/categories", async (req, reply) => {
    const error = validateCategory(req.body);
    if (error) return reply.status(400).send({ error });
    if (loadCategoryCatalog().some((item) => item.id === req.body.id)) return reply.status(409).send({ error: "Ce code de catégorie existe déjà." });
    return reply.status(201).send(upsertCustomCategory({ id: req.body.id!, label: req.body.label!, account: { number: req.body.account!.number!, label: req.body.account!.label! }, active: req.body.active !== false }));
  });

  app.put<{ Params: { id: string }; Body: CategoryBody }>("/categories/:id", async (req, reply) => {
    if (BUILTIN_CATEGORIES.some((item) => item.id === req.params.id)) return reply.status(403).send({ error: "Une catégorie standard se configure dans le plan comptable mais ne peut pas être remplacée." });
    if (!loadCategoryCatalog().some((item) => item.id === req.params.id)) return reply.status(404).send({ error: "Catégorie introuvable." });
    const error = validateCategory(req.body, req.params.id);
    if (error) return reply.status(400).send({ error });
    return reply.send(upsertCustomCategory({ id: req.params.id, label: req.body.label!, account: { number: req.body.account!.number!, label: req.body.account!.label! }, active: req.body.active !== false }));
  });

  app.delete<{ Params: { id: string } }>("/categories/:id", async (req, reply) => {
    if (BUILTIN_CATEGORIES.some((item) => item.id === req.params.id)) return reply.status(403).send({ error: "Une catégorie standard ne peut pas être supprimée." });
    if (!deactivateCustomCategory(req.params.id)) return reply.status(404).send({ error: "Catégorie introuvable." });
    return reply.send({ ok: true });
  });

  app.get("/category-rules", async (_req, reply) => {
    return reply.send(loadCategoryRules());
  });

  app.put<{ Body: CategoryRule[] }>("/category-rules", async (req, reply) => {
    saveCategoryRules(req.body);
    return reply.send({ ok: true });
  });

  app.get("/treasury-alert", async (_req, reply) => {
    return reply.send(loadTreasuryAlert());
  });

  app.put<{ Body: TreasuryAlert }>("/treasury-alert", async (req, reply) => {
    saveTreasuryAlert(req.body);
    return reply.send({ ok: true });
  });

  // GET /api/settings/ai — retourne la config IA (clé masquée)
  app.get("/ai", async (_req, reply) => {
    const config = loadAiConfig();
    if (!config) return reply.send({ configured: false });
    return reply.send({
      configured: true,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl ?? null,
      // Masquer la clé : affiche les 4 premiers + "…"
      apiKeyPreview: config.apiKey.length > 4
        ? config.apiKey.slice(0, 4) + "…" + config.apiKey.slice(-3)
        : "***",
    });
  });

  // PUT /api/settings/ai — sauvegarde la config IA
  app.put<{ Body: AiConfig }>("/ai", async (req, reply) => {
    const { provider, apiKey, model, baseUrl } = req.body;
    if (!provider || !apiKey || !model) {
      return reply.status(400).send({ error: "provider, apiKey et model sont requis" });
    }
    saveAiConfig({ provider, apiKey, model, baseUrl });
    return reply.send({ ok: true });
  });

  // GET /api/settings/budgets
  app.get("/budgets", async (_req, reply) => {
    return reply.send(loadBudgets());
  });

  // PUT /api/settings/budgets
  app.put<{ Body: CategoryBudget[] }>("/budgets", async (req, reply) => {
    saveBudgets(req.body);
    return reply.send({ ok: true });
  });

  // GET /api/settings/profile
  app.get("/profile", async (_req, reply) => {
    return reply.send(loadCompanyProfile());
  });

  // PUT /api/settings/profile
  app.put<{ Body: CompanyProfile }>("/profile", async (req, reply) => {
    saveCompanyProfile(req.body);
    return reply.send({ ok: true });
  });
}
