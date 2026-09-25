import { ecosystemsRoutes } from "./routes/ecosystems.js";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAccessControl } from "./services/workspaceAccess.js";
import { workspacesRoutes } from "./routes/workspaces.js";
import { householdRoutes } from "./routes/household.js";
import { registerMaintenance } from "./services/maintenance.js";
import { backupRoutes } from "./routes/backups.js";
import { startBackupScheduler } from "./services/backupService.js";
import cors from "@fastify/cors";
import { filesRoutes } from "./routes/files.js";
import { transactionsRoutes } from "./routes/transactions.js";
import { importRoutes } from "./routes/import.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { aiRoutes } from "./routes/ai.js";
import { ocrRoutes } from "./routes/ocr.js";
import { searchRoutes } from "./routes/search.js";
import { reportsRoutes } from "./routes/reports.js";
import { recurringRoutes } from "./routes/recurring.js";
import { hrRoutes } from "./routes/hr.js";
import { settingsRoutes } from "./routes/settings.js";
import { invoicesRoutes } from "./routes/invoices.js";
import { quotesRoutes } from "./routes/quotes.js";
import { companiesRoutes } from "./routes/companies.js";
import { attachmentsRoutes } from "./routes/attachments.js";
import { spreadsheetsRoutes } from "./routes/spreadsheets.js";
import { gitRoutes } from "./routes/git.js";
import { journalRoutes } from "./routes/journal.js";
import { alertsRoutes } from "./routes/alerts.js";
import { reconcileRoutes } from "./routes/reconcile.js";
import { closingRoutes } from "./routes/closing.js";
import { templatesRoutes } from "./routes/templates.js";
import { exportRoutes } from "./routes/export.js";
import { accountingRoutes } from "./routes/accounting.js";
import { annualAccountingRoutes } from "./routes/annualAccounting.js";
import { profitLossRoutes } from "./routes/profitLoss.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { encryptionRoutes } from "./routes/encryption.js";
import { licenseRoutes } from "./routes/license.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { bankingRoutes } from "./routes/banking.js";
import { stripeRoutes } from "./routes/stripe.js";
import { authRoutes } from "./routes/auth.js";
import { hasUsers } from "./services/authService.js";
import staticPlugin from "@fastify/static";
import { ensureDefaultCompany, getCompaniesRoot } from "./services/companiesService.js";
import { initRepo, startGitAutoCommitScheduler } from "./services/gitService.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: ["http://localhost:5173", "http://localhost:4173"],
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
});

// ── Middleware API Key (optionnel, rétrocompat) ──────────────────────────────
const LOCAL_API_KEY = process.env.LOCAL_API_KEY?.trim();
if (LOCAL_API_KEY) {
  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/api/health") return;
    const key =
      (req.headers["x-api-key"] as string | undefined) ??
      (req.query as Record<string, string>)["api_key"];
    if (key !== LOCAL_API_KEY) {
      return reply.status(401).send({ error: "Unauthorized — clé API invalide" });
    }
  });
  console.log("[auth] API key activée — accès restreint");
}

const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";
registerMaintenance(app);
registerAccessControl(app);
await app.register(ecosystemsRoutes, { prefix: "/api/ecosystems" });

async function registerBusinessRoutes(app: FastifyInstance, prefix: string) {
await app.register(filesRoutes, { prefix: prefix + "/files" });
await app.register(transactionsRoutes, { prefix: prefix + "/transactions" });
await app.register(importRoutes, { prefix: prefix + "/import" });
await app.register(dashboardRoutes, { prefix: prefix + "/dashboard" });
await app.register(aiRoutes, { prefix: prefix + "/ai" });
await app.register(ocrRoutes, { prefix: prefix + "/ocr" });
await app.register(searchRoutes, { prefix: prefix + "/search" });
await app.register(reportsRoutes, { prefix: prefix + "/reports" });
await app.register(recurringRoutes, { prefix: prefix + "/recurring" });
await app.register(hrRoutes, { prefix: prefix + "/hr" });
await app.register(settingsRoutes, { prefix: prefix + "/settings" });
await app.register(invoicesRoutes, { prefix: prefix + "/invoices" });
await app.register(quotesRoutes, { prefix: prefix + "/quotes" });
await app.register(attachmentsRoutes, { prefix: prefix + "/attachments" });
await app.register(spreadsheetsRoutes, { prefix: prefix + "/spreadsheets" });
await app.register(gitRoutes, { prefix: prefix + "/git" });
await app.register(journalRoutes, { prefix: prefix + "/journal" });
await app.register(alertsRoutes, { prefix: prefix + "/alerts" });
await app.register(reconcileRoutes, { prefix: prefix + "/reconcile" });
await app.register(closingRoutes, { prefix: prefix + "/closing" });
await app.register(templatesRoutes, { prefix: prefix + "/templates" });
await app.register(exportRoutes, { prefix: prefix + "/export" });
await app.register(accountingRoutes, { prefix: prefix + "/accounting" });
await app.register(annualAccountingRoutes, { prefix: prefix + "/annual-accounting" });
await app.register(profitLossRoutes, { prefix: prefix + "/pl" });
await app.register(pluginsRoutes,    { prefix: prefix + "/plugins" });
await app.register(encryptionRoutes, { prefix: prefix + "/encryption" });
}
await registerBusinessRoutes(app, "/api");
await registerBusinessRoutes(app, "/api/workspaces/:workspaceId");
await app.register(companiesRoutes, { prefix: "/api/companies" });
await app.register(licenseRoutes,    { prefix: "" });
await app.register(waitlistRoutes,   { prefix: "" });
await app.register(stripeRoutes,     { prefix: "" });
await app.register(authRoutes,       { prefix: "/api/auth" });
await app.register(bankingRoutes);
await app.register(bankingRoutes, { scopePrefix: "/api/workspaces/:workspaceId" });
await app.register(backupRoutes, { prefix: "/api/backups" });
await app.register(workspacesRoutes, { prefix: "/api/workspaces" });
await app.register(householdRoutes, { prefix: "/api/workspaces/:workspaceId/household" });

// Initialisation : créer l'entreprise par défaut si nécessaire
ensureDefaultCompany();

// Initialisation du dépôt Git du workspace actif
try {
  await initRepo(getCompaniesRoot());
  startGitAutoCommitScheduler(getCompaniesRoot());
} catch (err) {
  console.warn("[git] init ignoré:", (err as Error).message?.slice(0, 120));
}

// Health check
app.get("/api/health", async () => ({ status: "ok" }));

// Serve frontend build en production (Electron ou déploiement)
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
  await app.register(staticPlugin, { root: frontendDist, prefix: "/" });
  // SPA fallback — toute route non-API renvoie index.html
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Route introuvable" });
    reply.sendFile("index.html");
  });
}

// Avertissement si auth est désactivée en mode production
if (!AUTH_ENABLED && process.env.NODE_ENV === "production") {
  console.warn("[auth] ⚠ AUTH_ENABLED n'est pas activé. Ajoutez AUTH_ENABLED=true dans .env pour protéger l'accès en mode serveur.");
}

// Log si aucun utilisateur n'existe et auth est activée
if (AUTH_ENABLED && !hasUsers()) {
  console.log("[auth] Aucun utilisateur trouvé — un setup initial sera requis au premier accès.");
}

const PORT = parseInt(process.env.PORT ?? "3001");
// En production, écouter sur toutes les interfaces pour que Nginx (Docker) puisse proxifier
const HOST = process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

try {
  await app.listen({ port: PORT, host: HOST });
  startBackupScheduler();
  console.log(`ComptaOS backend démarré sur http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
