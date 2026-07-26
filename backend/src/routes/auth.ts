import { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
  hasUsers,
  createOwner,
  verifyCredentials,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  createInvitation,
  getInvitation,
  acceptInvitation,
  listInvitations,
  revokeInvitation,
  getJwtSecret,
  type UserRole,
} from "../services/authService.js";

// ── Helpers cookies ───────────────────────────────────────────────────────────

export const COOKIE_NAME = "comptaos_token";
export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HTTPS_ONLY === "true" || env.NODE_ENV === "production";
}

export function isAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_ENABLED === "true";
}

const SECURE = shouldUseSecureCookies();

function setAuthCookie(reply: { header: (k: string, v: string) => void }, token: string): void {
  const maxAge = 30 * 24 * 3600; // 30 jours
  const flags = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    `SameSite=Lax`,
    `Max-Age=${maxAge}`,
    ...(SECURE ? ["Secure"] : []),
  ].join("; ");
  reply.header("Set-Cookie", flags);
}

function clearAuthCookie(reply: { header: (k: string, v: string) => void }): void {
  const secureFlag = SECURE ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  );
}

export interface JwtPayload {
  sub: string;
  username: string;
  role: UserRole;
}

function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: "30d" });
}

function parseCookie(header?: string): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(";")
      .map((c) => c.trim().split("=").map(decodeURIComponent))
      .filter((p) => p.length >= 2)
      .map((p) => [p[0].trim(), p.slice(1).join("=").trim()]),
  );
}

function getRequestUser(req: { headers: { cookie?: string } }): JwtPayload | null {
  const cookies = parseCookie(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as JwtPayload;
  } catch {
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {
  /**
   * GET /api/auth/status
   * Public — indique si l'auth est activée et si un setup initial est requis.
   */
  app.get("/status", async (_req, reply) => {
    const authEnabled = isAuthEnabled();
    return reply.send({
      authEnabled,
      needsSetup: authEnabled && !hasUsers(),
    });
  });

  /**
   * POST /api/auth/setup
   * Public — premier lancement uniquement. Crée le compte owner.
   */
  app.post<{ Body: { username: string; displayName: string; password: string } }>(
    "/setup",
    async (req, reply) => {
      if (hasUsers()) return reply.status(409).send({ error: "Setup déjà effectué." });
      const { username, displayName, password } = req.body ?? {};
      if (!username || !displayName || !password || password.length < 8) {
        return reply.status(400).send({ error: "Données invalides (mot de passe min. 8 caractères)." });
      }
      const user = await createOwner(username, displayName, password);
      setAuthCookie(reply, signToken({ sub: user.id, username: user.username, role: user.role }));
      return reply.status(201).send(user);
    },
  );

  /**
   * POST /api/auth/login
   * Public.
   */
  app.post<{ Body: { username: string; password: string } }>(
    "/login",
    async (req, reply) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) return reply.status(400).send({ error: "Identifiants requis." });
      const user = await verifyCredentials(username, password);
      if (!user) return reply.status(401).send({ error: "Identifiants incorrects." });
      setAuthCookie(reply, signToken({ sub: user.id, username: user.username, role: user.role }));
      return reply.send(user);
    },
  );

  /**
   * POST /api/auth/logout
   * Authentifié.
   */
  app.post("/logout", async (_req, reply) => {
    clearAuthCookie(reply);
    return reply.send({ ok: true });
  });

  /**
   * GET /api/auth/me
   * Authentifié.
   */
  app.get("/me", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    const user = getUserById(payload.sub);
    if (!user) return reply.status(401).send({ error: "Utilisateur introuvable." });
    return reply.send(user);
  });

  /**
   * GET /api/auth/users — admin+
   */
  app.get("/users", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
    return reply.send(listUsers());
  });

  /**
   * POST /api/auth/users — admin+
   */
  app.post<{
    Body: { username: string; displayName: string; password: string; role: Exclude<UserRole, "owner"> };
  }>("/users", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
    const { username, displayName, password, role } = req.body ?? {};
    if (!username || !displayName || !password || password.length < 8 || !role) {
      return reply.status(400).send({ error: "Données invalides (mot de passe min. 8 caractères)." });
    }
    const user = await createUser(username, displayName, password, role, payload.sub);
    return reply.status(201).send(user);
  });

  /**
   * PATCH /api/auth/users/:id — admin+ ou soi-même (nom/mdp)
   */
  app.patch<{
    Params: { id: string };
    Body: { displayName?: string; email?: string; role?: Exclude<UserRole, "owner">; password?: string; active?: boolean };
  }>("/users/:id", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    try {
      const user = await updateUser(req.params.id, req.body ?? {}, payload.sub, payload.role);
      return reply.send(user);
    } catch (e) {
      return reply.status(403).send({ error: (e as Error).message });
    }
  });

  /**
   * DELETE /api/auth/users/:id — admin+
   */
  app.delete<{ Params: { id: string } }>("/users/:id", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
    try {
      deleteUser(req.params.id, payload.sub);
      return reply.send({ ok: true });
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  /**
   * POST /api/auth/invite — admin+
   */
  app.post<{ Body: { role: Exclude<UserRole, "owner">; email?: string } }>(
    "/invite",
    async (req, reply) => {
      const payload = getRequestUser(req);
      if (!payload) return reply.status(401).send({ error: "Non authentifié." });
      if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
      const { role, email } = req.body ?? {};
      if (!role) return reply.status(400).send({ error: "Rôle requis." });
      const inv = createInvitation(role, payload.sub, email);
      return reply.status(201).send(inv);
    },
  );

  /**
   * GET /api/auth/invite/:token — Public
   */
  app.get<{ Params: { token: string } }>("/invite/:token", async (req, reply) => {
    const inv = getInvitation(req.params.token);
    if (!inv) return reply.status(404).send({ error: "Invitation invalide ou expirée." });
    return reply.send({ role: inv.role, email: inv.email });
  });

  /**
   * POST /api/auth/invite/:token/accept — Public
   */
  app.post<{
    Params: { token: string };
    Body: { username: string; displayName: string; password: string };
  }>("/invite/:token/accept", async (req, reply) => {
    const { username, displayName, password } = req.body ?? {};
    if (!username || !displayName || !password || password.length < 8) {
      return reply.status(400).send({ error: "Données invalides (mot de passe min. 8 caractères)." });
    }
    try {
      const user = await acceptInvitation(req.params.token, username, displayName, password);
      setAuthCookie(reply, signToken({ sub: user.id, username: user.username, role: user.role }));
      return reply.status(201).send(user);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }
  });

  /**
   * GET /api/auth/invitations — admin+
   */
  app.get("/invitations", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
    return reply.send(listInvitations());
  });

  /**
   * DELETE /api/auth/invitations/:token — admin+
   */
  app.delete<{ Params: { token: string } }>("/invitations/:token", async (req, reply) => {
    const payload = getRequestUser(req);
    if (!payload) return reply.status(401).send({ error: "Non authentifié." });
    if (payload.role !== "owner" && payload.role !== "admin") return reply.status(403).send({ error: "Accès refusé." });
    revokeInvitation(req.params.token);
    return reply.send({ ok: true });
  });
}
