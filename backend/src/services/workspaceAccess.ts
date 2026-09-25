import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { getUserById, getJwtSecret } from "./authService.js";
import { ensureDefaultCompany, loadCompanies, resolveCompanyPath } from "./companiesService.js";
import { actorContext, workspaceContext } from "./workspaceContext.js";

export function registerAccessControl(app: FastifyInstance) {
  app.addHook("onRequest", (req, reply, done) => {
    const pathname = req.url.split("?")[0];
    const publicRoute = !pathname.startsWith("/api/") || ["/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup"].includes(pathname) || /^\/api\/auth\/invite\/[^/]+(?:\/accept)?$/.test(pathname);
    let actor = { id: "local", role: "owner" };
    if (process.env.AUTH_ENABLED === "true" && !publicRoute) {
      try {
        const token = (req.headers.cookie ?? "").split(";").map(c => c.trim()).find(c => c.startsWith("comptaos_token="))?.slice(15);
        const payload = jwt.verify(decodeURIComponent(token ?? ""), getJwtSecret()) as jwt.JwtPayload;
        const user = getUserById(payload.sub ?? "");
        if (!user) throw new Error("Utilisateur désactivé");
        actor = { id: user.id, role: user.role };
      } catch { void reply.code(401).send({ error: "Session expirée ou utilisateur désactivé." }); return; }
    }
    if (!(req.method === "PUT" && /^\/api\/ecosystems\/[^/]+\/preferences$/.test(pathname)) && !publicRoute && actor.role === "readonly" && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !["/api/auth/logout","/api/companies/active"].includes(pathname)) {
      void reply.code(403).send({ error: "Accès en lecture seule." }); return;
    }
    const scoped = /^\/api\/workspaces\/([^/]+)\/(.*)$/.exec(pathname);
    const globalRoute = /^\/api\/(auth|companies|workspaces|ecosystems|health|backups|license|waitlist|stripe)(\/|$)/.test(pathname);
    if (publicRoute || (!scoped && globalRoute)) { actorContext.run(actor, done); return; }
    ensureDefaultCompany();
    const companies = loadCompanies();
    if (!scoped && companies.length !== 1) { void reply.code(400).send({ error: "workspaceId explicite requis." }); return; }
    const company = scoped ? companies.find(c => c.id === scoped[1]) : companies[0];
    const membership = company?.ecosystemId ? companies.find(c => c.id === company.ecosystemId) : company;
    if (!company || !membership || (membership.memberIds && actor.id !== "local" && !membership.memberIds.includes(actor.id))) {
      void reply.code(403).send({ error: "Espace inaccessible." }); return;
    }
    const resource = scoped?.[2] ?? pathname.replace(/^\/api\//, "");
    if (company.ecosystemId && /^banking(?:\/|$)/.test(resource)) { void reply.code(409).send({error:"Utilisez les connexions bancaires de l’écosystème."}); return; }
    if (company.kind === "ecosystem") { void reply.code(403).send({ error: "Utilisez les ressources écosystème." }); return; }
    if (company.kind === "household" && !/^household(?:\/|$)/.test(resource)) {
      void reply.code(403).send({ error: "Fonction réservée aux espaces professionnels." }); return;
    }
    try {
      const root = resolveCompanyPath(company);
      actorContext.run(actor, () => workspaceContext.run({ id: company.id, root, kind: company.kind ?? "business", actor: actor.id, role: actor.role }, done));
    } catch (error) { done(error as Error); }
  });
}
