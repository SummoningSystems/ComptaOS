import jwt from "jsonwebtoken";
import { authCookieName } from "./authCookie.js";
import { getJwtSecret, getUserById, type UserRole } from "./authService.js";

export interface RequestActor { id: string; role: UserRole | "local" }

export function isPublicRequest(pathname: string): boolean {
  return !pathname.startsWith("/api/") || ["/api/health", "/api/auth/status", "/api/auth/login", "/api/auth/setup"].includes(pathname)
    || /^\/api\/auth\/invite\/[^/]+(?:\/accept)?$/.test(pathname);
}

export function getRequestActor(headers: { cookie?: string }): RequestActor | null {
  if (process.env.AUTH_ENABLED !== "true") return { id: "local", role: "local" };
  try {
    const cookiePrefix = `${authCookieName()}=`;
    const raw = (headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(cookiePrefix))?.slice(cookiePrefix.length);
    const payload = jwt.verify(decodeURIComponent(raw ?? ""), getJwtSecret()) as jwt.JwtPayload;
    const user = getUserById(payload.sub ?? "");
    return user ? { id: user.id, role: user.role } : null;
  } catch { return null; }
}
