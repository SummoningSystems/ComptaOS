import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
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
import { templatesRoutes } from "./routes/templates.js";
import { exportRoutes } from "./routes/export.js";
import { accountingRoutes } from "./routes/accounting.js";
import { profitLossRoutes } from "./routes/profitLoss.js";
import { pluginsRoutes } from "./routes/plugins.js";
import { encryptionRoutes } from "./routes/encryption.js";
import { licenseRoutes } from "./routes/license.js";
import { waitlistRoutes } from "./routes/waitlist.js";
import { bankingRoutes } from "./routes/banking.js";
import { stripeRoutes } from "./routes/stripe.js";
import { authRoutes, COOKIE_NAME } from "./routes/auth.js";
import { hasUsers, getJwtSecret } from "./services/authService.js";
import jwt from "jsonwebtoken";
import staticPlugin from "@fastify/static";
import { ensureDefaultCompany } from "./services/companiesService.js";
import { initRepo } from "./services/gitService.js";
import { getWorkspaceRoot } from "./services/fileSystem.js";

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

// ── Middleware Auth JWT (activé quand AUTH_ENABLED=true) ──────────────────────
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

// Routes publiques qui n'ont pas besoin de JWT même avec auth activée
const PUBLIC_PATHS = [
  "/api/health",
  "/api/auth/status",
  "/api/auth/login",
  "/api/auth/setup",
];

function isPublicPath(url: string): boolean {
  if (PUBLIC_PATHS.includes(url)) return true;
  // Invitations
  if (/^\/api\/auth\/invite\/[^/]+(\/(accept))?$/.test(url)) return true;
  // Assets statiques (frontend)
  if (!url.startsWith("/api/")) return true;
  return false;
}

if (AUTH_ENABLED) {
  app.addHook("onRequest", async (req, reply) => {
    if (isPublicPath(req.url)) return;
    // Lire le token depuis le cookie
    const cookieHeader = req.headers.cookie ?? "";
    const cookiePairs = Object.fromEntries(
      cookieHeader
        .split(";")
        .map((c) => c.trim().split("=").map(decodeURIComponent))
        .filter((p) => p.length >= 2)
        .map((p) => [p[0].trim(), p.slice(1).join("=").trim()]),
    );
    const token = cookiePairs[COOKIE_NAME];
    if (!token) {
      return reply.status(401).send({ error: "Non authentifié." });
    }
    try {
      jwt.verify(token, getJwtSecret());
    } catch {
      return reply.status(401).send({ error: "Session expirée." });
    }
  });
  console.log("[auth] Authentification JWT activée (AUTH_ENABLED=true).");
}

// Routes
await app.register(filesRoutes, { prefix: "/api/files" });
await app.register(transactionsRoutes, { prefix: "/api/transactions" });
await app.register(importRoutes, { prefix: "/api/import" });
await app.register(dashboardRoutes, { prefix: "/api/dashboard" });
await app.register(aiRoutes, { prefix: "/api/ai" });
await app.register(ocrRoutes, { prefix: "/api/ocr" });
await app.register(searchRoutes, { prefix: "/api/search" });
await app.register(reportsRoutes, { prefix: "/api/reports" });
await app.register(recurringRoutes, { prefix: "/api/recurring" });
await app.register(settingsRoutes, { prefix: "/api/settings" });
await app.register(invoicesRoutes, { prefix: "/api/invoices" });
await app.register(quotesRoutes, { prefix: "/api/quotes" });
await app.register(companiesRoutes, { prefix: "/api/companies" });
await app.register(attachmentsRoutes, { prefix: "/api/attachments" });
await app.register(spreadsheetsRoutes, { prefix: "/api/spreadsheets" });
await app.register(gitRoutes, { prefix: "/api/git" });
await app.register(journalRoutes, { prefix: "/api/journal" });
await app.register(alertsRoutes, { prefix: "/api/alerts" });
await app.register(reconcileRoutes, { prefix: "/api/reconcile" });
await app.register(templatesRoutes, { prefix: "/api/templates" });
await app.register(exportRoutes, { prefix: "/api/export" });
await app.register(accountingRoutes, { prefix: "/api/accounting" });
await app.register(profitLossRoutes, { prefix: "/api/pl" });
await app.register(pluginsRoutes,    { prefix: "/api/plugins" });
await app.register(encryptionRoutes, { prefix: "/api/encryption" });
await app.register(licenseRoutes,    { prefix: "" });
await app.register(waitlistRoutes,   { prefix: "" });
await app.register(bankingRoutes,    { prefix: "" });
await app.register(stripeRoutes,     { prefix: "" });
await app.register(authRoutes,       { prefix: "/api/auth" });

// Initialisation : créer l'entreprise par défaut si nécessaire
ensureDefaultCompany();

// Initialisation du dépôt Git du workspace actif
try {
  await initRepo(getWorkspaceRoot());
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
  app.setNotFoundHandler((_req, reply) => {
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
  console.log(`ComptaOS backend démarré sur http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
