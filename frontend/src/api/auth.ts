import { api } from "./client";

export type UserRole = "owner" | "admin" | "member" | "readonly";

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  role: UserRole;
  createdAt: string;
  createdBy?: string;
  lastLogin?: string;
  active: boolean;
}

export interface Invitation {
  token: string;
  email?: string;
  role: Exclude<UserRole, "owner">;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

export async function fetchAuthStatus(): Promise<{ authEnabled: boolean; needsSetup: boolean }> {
  const { data } = await api.get<{ authEnabled: boolean; needsSetup: boolean }>("/auth/status");
  return data;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/auth/login", { username, password });
  return data;
}

export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

export async function fetchMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>("/auth/me");
  return data;
}

export async function setupOwner(
  username: string,
  displayName: string,
  password: string,
): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/auth/setup", { username, displayName, password });
  return data;
}

export async function fetchUsers(): Promise<AuthUser[]> {
  const { data } = await api.get<AuthUser[]>("/auth/users");
  return data;
}

export async function createUser(body: {
  username: string;
  displayName: string;
  password: string;
  role: Exclude<UserRole, "owner">;
}): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>("/auth/users", body);
  return data;
}

export async function updateUser(
  id: string,
  patch: Partial<AuthUser & { password: string }>,
): Promise<AuthUser> {
  const { data } = await api.patch<AuthUser>(`/auth/users/${id}`, patch);
  return data;
}

export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/auth/users/${id}`);
}

export async function fetchInvitations(): Promise<Invitation[]> {
  const { data } = await api.get<Invitation[]>("/auth/invitations");
  return data;
}

export async function createInvitation(
  role: Exclude<UserRole, "owner">,
  email?: string,
  workspaceId?: string,
): Promise<Invitation> {
  const { data } = await api.post<Invitation>("/auth/invite", { role, email, workspaceId });
  return data;
}

export async function revokeInvitation(token: string): Promise<void> {
  await api.delete(`/auth/invitations/${token}`);
}

export async function fetchInvitationInfo(
  token: string,
): Promise<{ role: string; email?: string }> {
  const { data } = await api.get<{ role: string; email?: string }>(`/auth/invite/${token}`);
  return data;
}

export async function acceptInvitation(
  token: string,
  body: { username: string; displayName: string; password: string },
): Promise<AuthUser> {
  const { data } = await api.post<AuthUser>(`/auth/invite/${token}/accept`, body);
  return data;
}
