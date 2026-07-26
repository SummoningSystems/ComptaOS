import { chmodSync, readFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getCompaniesRoot } from "./companiesService.js";
import { atomicWriteFileSync } from "./atomicFile.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserRole = "owner" | "admin" | "member" | "readonly";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  createdBy?: string;
  lastLogin?: string;
  active: boolean;
}

export type PublicUser = Omit<AuthUser, "passwordHash">;

export interface Invitation {
  token: string;
  email?: string;
  role: Exclude<UserRole, "owner">;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  usedBy?: string;
}

interface AuthStore {
  users: AuthUser[];
  invitations: Invitation[];
}

const USER_ROLES = new Set<UserRole>(["owner", "admin", "member", "readonly"]);
const INVITATION_ROLES = new Set<string>(["admin", "member", "readonly"]);

function isAuthStore(value: unknown): value is AuthStore {
  if (!value || typeof value !== "object") return false;
  const store = value as Partial<AuthStore>;
  if (!Array.isArray(store.users) || !Array.isArray(store.invitations)) return false;

  const usersValid = store.users.every((user) => (
    !!user && typeof user === "object" &&
    typeof user.id === "string" && user.id.length > 0 &&
    typeof user.username === "string" && user.username.length > 0 &&
    typeof user.displayName === "string" &&
    typeof user.passwordHash === "string" && user.passwordHash.length > 0 &&
    USER_ROLES.has(user.role) &&
    typeof user.createdAt === "string" &&
    typeof user.active === "boolean"
  ));

  const invitationsValid = store.invitations.every((invitation) => (
    !!invitation && typeof invitation === "object" &&
    typeof invitation.token === "string" && invitation.token.length > 0 &&
    INVITATION_ROLES.has(invitation.role) &&
    typeof invitation.createdBy === "string" &&
    typeof invitation.createdAt === "string" &&
    typeof invitation.expiresAt === "string"
  ));

  return usersValid && invitationsValid;
}

// ── Chemins ───────────────────────────────────────────────────────────────────

function getAuthFilePath(): string {
  const root = getCompaniesRoot();
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  return join(root, "auth.json");
}

function getJwtSecretFilePath(): string {
  return join(getCompaniesRoot(), ".jwt_secret");
}

// ── Store I/O ─────────────────────────────────────────────────────────────────

function loadStore(): AuthStore {
  const p = getAuthFilePath();
  if (!existsSync(p)) return { users: [], invitations: [] };
  try {
    const parsed: unknown = JSON.parse(readFileSync(p, "utf-8"));
    if (!isAuthStore(parsed)) throw new Error("structure invalide");
    try { chmodSync(p, 0o600); } catch { /* non supporté sur certains systèmes */ }
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Stockage d'authentification invalide (${reason}).`);
  }
}

function saveStore(store: AuthStore): void {
  atomicWriteFileSync(getAuthFilePath(), JSON.stringify(store, null, 2));
}

function strip(user: AuthUser): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash: _ph, ...pub } = user;
  return pub;
}

// ── JWT secret ────────────────────────────────────────────────────────────────

/** Retourne ou génère un secret JWT persistant. */
export function getJwtSecret(): string {
  if (process.env.JWT_SECRET?.trim()) return process.env.JWT_SECRET.trim();
  const secretFile = getJwtSecretFilePath();
  if (existsSync(secretFile)) {
    const existing = readFileSync(secretFile, "utf-8").trim();
    if (existing.length < 32) throw new Error("Secret JWT local invalide ou tronqué.");
    try { chmodSync(secretFile, 0o600); } catch { /* non supporté sur certains systèmes */ }
    return existing;
  }
  const secret = crypto.randomBytes(64).toString("hex");
  atomicWriteFileSync(secretFile, secret);
  console.log("[auth] Nouveau secret JWT généré automatiquement.");
  return secret;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

export function hasUsers(): boolean {
  return loadStore().users.length > 0;
}

export async function createOwner(
  username: string,
  displayName: string,
  password: string,
): Promise<PublicUser> {
  const store = loadStore();
  if (store.users.length > 0) throw new Error("Un compte owner existe déjà.");
  const hash = await bcrypt.hash(password, 12);
  const user: AuthUser = {
    id: `user_${crypto.randomBytes(6).toString("hex")}`,
    username: username.toLowerCase().trim(),
    displayName: displayName.trim(),
    passwordHash: hash,
    role: "owner",
    createdAt: new Date().toISOString(),
    active: true,
  };
  store.users.push(user);
  saveStore(store);
  return strip(user);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<PublicUser | null> {
  const store = loadStore();
  const user = store.users.find(
    (u) => u.username === username.toLowerCase().trim() && u.active,
  );
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  user.lastLogin = new Date().toISOString();
  saveStore(store);
  return strip(user);
}

export function getUserById(id: string): PublicUser | null {
  const user = loadStore().users.find((u) => u.id === id && u.active);
  return user ? strip(user) : null;
}

// ── Users CRUD ────────────────────────────────────────────────────────────────

export function listUsers(): PublicUser[] {
  return loadStore().users.map(strip);
}

export async function createUser(
  username: string,
  displayName: string,
  password: string,
  role: Exclude<UserRole, "owner">,
  createdBy: string,
): Promise<PublicUser> {
  const store = loadStore();
  if (store.users.find((u) => u.username === username.toLowerCase().trim())) {
    throw new Error("Ce nom d'utilisateur existe déjà.");
  }
  const hash = await bcrypt.hash(password, 12);
  const user: AuthUser = {
    id: `user_${crypto.randomBytes(6).toString("hex")}`,
    username: username.toLowerCase().trim(),
    displayName: displayName.trim(),
    passwordHash: hash,
    role,
    createdAt: new Date().toISOString(),
    createdBy,
    active: true,
  };
  store.users.push(user);
  saveStore(store);
  return strip(user);
}

export async function updateUser(
  id: string,
  patch: {
    displayName?: string;
    email?: string;
    role?: Exclude<UserRole, "owner">;
    password?: string;
    active?: boolean;
  },
  requesterId: string,
  requesterRole: UserRole,
): Promise<PublicUser> {
  const store = loadStore();
  const idx = store.users.findIndex((u) => u.id === id);
  if (idx === -1) throw new Error("Utilisateur introuvable.");
  const user = store.users[idx];

  if (user.role === "owner" && patch.role) throw new Error("Impossible de changer le rôle du owner.");
  if (user.role === "owner" && patch.active === false) throw new Error("Impossible de désactiver le owner.");
  if (requesterRole === "member" && id !== requesterId) throw new Error("Accès refusé.");
  if (requesterRole === "readonly") throw new Error("Accès refusé.");

  if (patch.displayName) user.displayName = patch.displayName.trim();
  if (patch.email !== undefined) user.email = patch.email || undefined;
  if (patch.role && (requesterRole === "owner" || requesterRole === "admin")) user.role = patch.role;
  if (patch.active !== undefined && (requesterRole === "owner" || requesterRole === "admin")) user.active = patch.active;
  if (patch.password) user.passwordHash = await bcrypt.hash(patch.password, 12);

  store.users[idx] = user;
  saveStore(store);
  return strip(user);
}

export function deleteUser(id: string, requesterId: string): void {
  const store = loadStore();
  const user = store.users.find((u) => u.id === id);
  if (!user) throw new Error("Utilisateur introuvable.");
  if (user.role === "owner") throw new Error("Impossible de supprimer le compte owner.");
  if (id === requesterId) throw new Error("Impossible de supprimer son propre compte.");
  store.users = store.users.filter((u) => u.id !== id);
  saveStore(store);
}

// ── Invitations ───────────────────────────────────────────────────────────────

export function createInvitation(
  role: Exclude<UserRole, "owner">,
  createdBy: string,
  email?: string,
): Invitation {
  const store = loadStore();
  const inv: Invitation = {
    token: crypto.randomBytes(24).toString("hex"),
    email,
    role,
    createdBy,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
  };
  store.invitations.push(inv);
  saveStore(store);
  return inv;
}

export function getInvitation(token: string): Invitation | null {
  const store = loadStore();
  return (
    store.invitations.find(
      (i) => i.token === token && !i.usedAt && new Date(i.expiresAt) > new Date(),
    ) ?? null
  );
}

export async function acceptInvitation(
  token: string,
  username: string,
  displayName: string,
  password: string,
): Promise<PublicUser> {
  const inv = getInvitation(token);
  if (!inv) throw new Error("Invitation invalide ou expirée.");
  const user = await createUser(username, displayName, password, inv.role, inv.createdBy);
  const store = loadStore();
  const idx = store.invitations.findIndex((i) => i.token === token);
  if (idx !== -1) {
    store.invitations[idx].usedAt = new Date().toISOString();
    store.invitations[idx].usedBy = user.id;
    saveStore(store);
  }
  return user;
}

export function listInvitations(): Invitation[] {
  return loadStore().invitations;
}

export function revokeInvitation(token: string): void {
  const store = loadStore();
  store.invitations = store.invitations.filter((i) => i.token !== token);
  saveStore(store);
}
