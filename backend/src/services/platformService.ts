import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve, sep, join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot, loadCompanies } from "./companiesService.js";

export type PlatformNodeKind = "person" | "entity" | "account";

export interface PlatformPerson {
  id: string;
  kind: "person";
  name: string;
  profile: "individual" | "professional";
  notes?: string;
  createdAt: string;
}

export interface PlatformEntity {
  id: string;
  kind: "entity";
  name: string;
  workspaceId: string;
  createdAt: string;
}

export interface PlatformAccount {
  id: string;
  kind: "account";
  name: string;
  currency: string;
  maskedIdentifier?: string;
  provider?: string;
  sourceWorkspaceId: string;
  sourceAccountId: string;
  balance?: number;
  createdAt: string;
}

export type PlatformRelationType =
  | "family" | "spouse" | "parent" | "child"
  | "accountant" | "advisor"
  | "owner" | "director" | "employee" | "beneficiary"
  | "shareholder" | "subsidiary" | "management"
  | "holder" | "uses" | "other";

export interface PlatformRelation {
  id: string;
  fromId: string;
  toId: string;
  type: PlatformRelationType;
  label?: string;
  ownershipPercent?: number;
  source: "manual" | "workspace";
  createdAt: string;
}

export interface CreateRelationResult {
  state: PlatformState;
  relation: PlatformRelation;
  created: boolean;
}

export type PlatformAccessRole = "owner" | "manager" | "viewer";
export interface PlatformAccessGrant { id: string; userId: string; scopeId: string; role: PlatformAccessRole; createdAt: string; createdBy: string }

export interface PlatformState {
  schemaVersion: 1;
  revision: number;
  people: PlatformPerson[];
  entities: PlatformEntity[];
  accounts: PlatformAccount[];
  relations: PlatformRelation[];
  grants: PlatformAccessGrant[];
  accessInitializedAt?: string;
  updatedAt: string;
}

function root(): string { return getCompaniesRoot(); }
function storeFile(): string { return join(root(), "_platform.json"); }

function emptyState(): PlatformState {
  return { schemaVersion: 1, revision: 0, people: [], entities: [], accounts: [], relations: [], grants: [], updatedAt: new Date(0).toISOString() };
}

function isState(value: unknown): value is PlatformState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PlatformState>;
  return state.schemaVersion === 1 && Number.isInteger(state.revision)
    && Array.isArray(state.people) && Array.isArray(state.entities)
    && Array.isArray(state.accounts) && Array.isArray(state.relations)
    && (state.grants === undefined || Array.isArray(state.grants));
}

function readState(): PlatformState {
  if (!existsSync(storeFile())) return emptyState();
  try {
    const parsed: unknown = JSON.parse(readFileSync(storeFile(), "utf-8"));
    return isState(parsed) ? { ...parsed, grants: parsed.grants ?? [] } : emptyState();
  } catch {
    return emptyState();
  }
}

function writeState(state: PlatformState): PlatformState {
  const next = { ...state, revision: state.revision + 1, updatedAt: new Date().toISOString() };
  atomicWriteFileSync(storeFile(), JSON.stringify(next, null, 2));
  return next;
}

function safeCompanyPath(relativePath: string): string | null {
  const workspaceRoot = root();
  const candidate = resolve(workspaceRoot, relativePath);
  const prefix = workspaceRoot.endsWith(sep) ? workspaceRoot : `${workspaceRoot}${sep}`;
  return candidate === workspaceRoot || candidate.startsWith(prefix) ? candidate : null;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 18)}`;
}

function maskIdentifier(value?: string): string | undefined {
  const normalized = value?.replace(/\s+/g, "");
  return normalized ? `•••• ${normalized.slice(-4)}` : undefined;
}

interface StoredBankConnection {
  connectorName?: string;
  accounts?: Array<{ id?: number | string; iban?: string; number?: string; name?: string; currency?: string; balance?: number }>;
}

/** Synchronise uniquement des références. Aucune donnée d'entreprise n'est déplacée ou modifiée. */
export function getPlatformState(): PlatformState {
  let state = readState();
  let changed = false;

  for (const company of loadCompanies()) {
    const entityId = `entity_${company.id}`;
    if (!state.entities.some((entity) => entity.id === entityId)) {
      state.entities.push({ id: entityId, kind: "entity", name: company.name, workspaceId: company.id, createdAt: company.createdAt });
      changed = true;
    }

    const companyPath = safeCompanyPath(company.path);
    if (!companyPath) continue;
    const connectionFile = join(companyPath, "banking", "connections.json");
    if (!existsSync(connectionFile)) continue;

    try {
      const connections = JSON.parse(readFileSync(connectionFile, "utf-8")) as StoredBankConnection[];
      for (const connection of Array.isArray(connections) ? connections : []) {
        for (const account of connection.accounts ?? []) {
          if (account.id === undefined && !account.iban && !account.number) continue;
          const sourceAccountId = String(account.id ?? account.iban ?? account.number);
          const dedupeKey = account.iban?.replace(/\s+/g, "").toUpperCase() ?? `${company.id}:${sourceAccountId}`;
          const accountId = stableId("account", dedupeKey);
          const existingAccount = state.accounts.find((item) => item.id === accountId);
          if (!existingAccount) {
            state.accounts.push({
              id: accountId, kind: "account", name: account.name?.trim() || "Compte bancaire",
              currency: account.currency || "EUR", maskedIdentifier: maskIdentifier(account.iban ?? account.number),
              provider: connection.connectorName, sourceWorkspaceId: company.id, sourceAccountId,
              balance: typeof account.balance === "number" ? account.balance : undefined, createdAt: new Date().toISOString(),
            });
            changed = true;
          } else {
            const current = { name: account.name?.trim() || existingAccount.name, currency: account.currency || existingAccount.currency, maskedIdentifier: maskIdentifier(account.iban ?? account.number) ?? existingAccount.maskedIdentifier, provider: connection.connectorName ?? existingAccount.provider, balance: typeof account.balance === "number" ? account.balance : existingAccount.balance };
            if (existingAccount.name !== current.name || existingAccount.currency !== current.currency || existingAccount.maskedIdentifier !== current.maskedIdentifier || existingAccount.provider !== current.provider || existingAccount.balance !== current.balance) {
              Object.assign(existingAccount, current); changed = true;
            }
          }
          const relationId = stableId("relation", `${entityId}:uses:${accountId}`);
          if (!state.relations.some((relation) => relation.id === relationId)) {
            state.relations.push({ id: relationId, fromId: entityId, toId: accountId, type: "uses", source: "workspace", createdAt: new Date().toISOString() });
            changed = true;
          }
        }
      }
    } catch {
      // Une configuration bancaire illisible ne doit jamais bloquer la plateforme.
    }
  }

  return changed ? writeState(state) : state;
}

function assertRevision(state: PlatformState, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && expectedRevision !== state.revision) {
    throw Object.assign(new Error("La structure a été modifiée ailleurs. Recharge la vue avant de réessayer."), { code: "REVISION_CONFLICT" });
  }
}

export function createPerson(input: { name: string; profile?: PlatformPerson["profile"]; notes?: string; expectedRevision?: number }): PlatformState {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const name = input.name.trim();
  if (!name) throw new Error("Le nom de la personne est requis.");
  state.people.push({ id: `person_${randomUUID()}`, kind: "person", name, profile: input.profile ?? "individual", notes: input.notes?.trim() || undefined, createdAt: new Date().toISOString() });
  return writeState(state);
}

export function updatePerson(id: string, input: { name?: string; profile?: PlatformPerson["profile"]; notes?: string; expectedRevision?: number }): PlatformState {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const person = state.people.find((item) => item.id === id);
  if (!person) throw Object.assign(new Error("Personne introuvable."), { code: "NOT_FOUND" });
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error("Le nom de la personne est requis.");
    person.name = input.name.trim();
  }
  if (input.profile) person.profile = input.profile;
  if (input.notes !== undefined) person.notes = input.notes.trim() || undefined;
  return writeState(state);
}

const RELATION_TYPES = new Set<PlatformRelationType>(["family", "spouse", "parent", "child", "accountant", "advisor", "owner", "director", "employee", "beneficiary", "shareholder", "subsidiary", "management", "holder", "uses", "other"]);

export function createRelation(input: { fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; expectedRevision?: number }): CreateRelationResult {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const nodes = new Set([...state.people, ...state.entities, ...state.accounts].map((node) => node.id));
  if (!nodes.has(input.fromId) || !nodes.has(input.toId)) throw new Error("Les deux éléments de la relation doivent exister.");
  if (input.fromId === input.toId) throw new Error("Un élément ne peut pas être relié à lui-même.");
  if (!RELATION_TYPES.has(input.type)) throw new Error("Type de relation invalide.");
  if (input.ownershipPercent !== undefined && (input.ownershipPercent < 0 || input.ownershipPercent > 100)) throw new Error("Le pourcentage doit être compris entre 0 et 100.");
  const duplicate = state.relations.find((relation) => relation.fromId === input.fromId && relation.toId === input.toId && relation.type === input.type);
  if (duplicate) return { state, relation: duplicate, created: false };

  const relation: PlatformRelation = { id: `relation_${randomUUID()}`, fromId: input.fromId, toId: input.toId, type: input.type, label: input.label?.trim() || undefined, ownershipPercent: input.ownershipPercent, source: "manual", createdAt: new Date().toISOString() };
  state.relations.push(relation);
  return { state: writeState(state), relation, created: true };
}

export function deleteRelation(id: string, expectedRevision?: number): PlatformState {
  const state = getPlatformState();
  assertRevision(state, expectedRevision);
  const relation = state.relations.find((item) => item.id === id);
  if (!relation) throw Object.assign(new Error("Relation introuvable."), { code: "NOT_FOUND" });
  if (relation.source === "workspace") throw new Error("Une relation issue d'un espace comptable doit être retirée depuis sa source.");
  state.relations = state.relations.filter((item) => item.id !== id);
  return writeState(state);
}

export interface AccessUser { id: string; role: "owner" | "admin" | "member" | "readonly"; active: boolean }

/** Préserve les accès historiques une seule fois lors de l'activation du nouveau modèle. */
export function initializeLegacyAccess(users: AccessUser[]): PlatformState {
  const state = getPlatformState();
  if (state.accessInitializedAt) return state;
  const now = new Date().toISOString();
  for (const user of users.filter((item) => item.active && item.role !== "owner" && item.role !== "admin")) {
    for (const entity of state.entities) {
      state.grants.push({ id: `grant_${randomUUID()}`, userId: user.id, scopeId: entity.id, role: user.role === "readonly" ? "viewer" : "manager", createdAt: now, createdBy: "migration" });
    }
  }
  state.accessInitializedAt = now;
  return writeState(state);
}

export function actorHasGlobalAccess(actor: { role: string }): boolean { return actor.role === "owner" || actor.role === "admin" || actor.role === "local"; }

export function getScopeAccess(actor: { id: string; role: string }, scopeId: string): PlatformAccessRole | null {
  if (actorHasGlobalAccess(actor)) return "owner";
  return getPlatformState().grants.find((grant) => grant.userId === actor.id && grant.scopeId === scopeId)?.role ?? null;
}

export function getVisiblePlatformState(actor: { id: string; role: string }): PlatformState {
  const state = getPlatformState();
  if (actorHasGlobalAccess(actor)) return state;
  const visible = new Set(state.grants.filter((grant) => grant.userId === actor.id).map((grant) => grant.scopeId));
  for (const relation of state.relations) {
    const fromVisibleScope = visible.has(relation.fromId) && [...state.people, ...state.entities].some((scope) => scope.id === relation.fromId);
    const toVisibleScope = visible.has(relation.toId) && [...state.people, ...state.entities].some((scope) => scope.id === relation.toId);
    if (fromVisibleScope && state.accounts.some((account) => account.id === relation.toId)) visible.add(relation.toId);
    if (toVisibleScope && state.accounts.some((account) => account.id === relation.fromId)) visible.add(relation.fromId);
  }
  return { ...state, people: state.people.filter((item) => visible.has(item.id)), entities: state.entities.filter((item) => visible.has(item.id)), accounts: state.accounts.filter((item) => visible.has(item.id)), relations: state.relations.filter((item) => visible.has(item.fromId) && visible.has(item.toId)), grants: state.grants.filter((grant) => grant.userId === actor.id) };
}

export function setAccessGrant(input: { userId: string; scopeId: string; role: PlatformAccessRole; createdBy: string; expectedRevision?: number }): PlatformState {
  const state = getPlatformState(); assertRevision(state, input.expectedRevision);
  const nodes = new Set([...state.people, ...state.entities, ...state.accounts].map((node) => node.id));
  if (!nodes.has(input.scopeId)) throw new Error("Périmètre introuvable.");
  const existing = state.grants.find((grant) => grant.userId === input.userId && grant.scopeId === input.scopeId);
  if (existing) existing.role = input.role;
  else state.grants.push({ id: `grant_${randomUUID()}`, userId: input.userId, scopeId: input.scopeId, role: input.role, createdAt: new Date().toISOString(), createdBy: input.createdBy });
  return writeState(state);
}

export function deleteAccessGrant(id: string, expectedRevision?: number): PlatformState {
  const state = getPlatformState(); assertRevision(state, expectedRevision);
  if (!state.grants.some((grant) => grant.id === id)) throw Object.assign(new Error("Autorisation introuvable."), { code: "NOT_FOUND" });
  state.grants = state.grants.filter((grant) => grant.id !== id);
  return writeState(state);
}
