import type { FastifyInstance } from "fastify";
import { ensureDefaultCompany, getActiveCompanyId, loadCompanies, resolveCompanyPath } from "./companiesService.js";
import { actorHasGlobalAccess, getScopeAccess } from "./platformService.js";
import { getRequestActor, isPublicRequest } from "./requestActor.js";
import { getSelectedCompany } from "./workspaceSelectionService.js";
import { actorContext, workspaceContext } from "./workspaceContext.js";

const GLOBAL_ROUTE = /^\/api\/(auth|companies|platform|health|license|waitlist|stripe)(\/|$)/;

export function registerWorkspaceAccess(app: FastifyInstance): void {
  app.addHook("onRequest", (req, reply, done) => {
    const pathname = req.url.split("?")[0];
    if (isPublicRequest(pathname)) { done(); return; }
    const actor = getRequestActor(req.headers);
    if (!actor) { void reply.status(401).send({ error: "Session expirée ou utilisateur désactivé." }); return; }

    if (GLOBAL_ROUTE.test(pathname)) {
      if (actor.role === "readonly" && !["GET", "HEAD", "OPTIONS"].includes(req.method) && !["/api/auth/logout", "/api/companies/active"].includes(pathname)) {
        void reply.status(403).send({ error: "Accès en lecture seule." }); return;
      }
      actorContext.run(actor, done); return;
    }

    ensureDefaultCompany();
    const visible = loadCompanies().filter((company) => actorHasGlobalAccess(actor) || getScopeAccess(actor, `entity_${company.id}`) !== null);
    const selectedId = getSelectedCompany(actor.id) ?? getActiveCompanyId();
    const company = visible.find((item) => item.id === selectedId) ?? visible[0];
    if (!company) { void reply.status(403).send({ error: "Aucun espace comptable ne vous a été attribué." }); return; }
    const accessRole = getScopeAccess(actor, `entity_${company.id}`) ?? "viewer";
    if ((actor.role === "readonly" || accessRole === "viewer") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      void reply.status(403).send({ error: "Cet espace est accessible en lecture seule." }); return;
    }
    try {
      const context = { companyId: company.id, root: resolveCompanyPath(company), actor, accessRole } as const;
      actorContext.run(actor, () => workspaceContext.run(context, done));
    } catch (error) { done(error as Error); }
  });
}
