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

export interface PlatformState {
  schemaVersion: 1;
  revision: number;
  people: PlatformPerson[];
  entities: PlatformEntity[];
  accounts: PlatformAccount[];
  relations: PlatformRelation[];
  updatedAt: string;
}

function root(): string { return getCompaniesRoot(); }
function storeFile(): string { return join(root(), "_platform.json"); }

function emptyState(): PlatformState {
  return { schemaVersion: 1, revision: 0, people: [], entities: [], accounts: [], relations: [], updatedAt: new Date(0).toISOString() };
}

function isState(value: unknown): value is PlatformState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PlatformState>;
  return state.schemaVersion === 1 && Number.isInteger(state.revision)
    && Array.isArray(state.people) && Array.isArray(state.entities)
    && Array.isArray(state.accounts) && Array.isArray(state.relations);
}

function readState(): PlatformState {
  if (!existsSync(storeFile())) return emptyState();
  try {
    const parsed: unknown = JSON.parse(readFileSync(storeFile(), "utf-8"));
    return isState(parsed) ? parsed : emptyState();
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
          if (!state.accounts.some((item) => item.id === accountId)) {
            state.accounts.push({
              id: accountId, kind: "account", name: account.name?.trim() || "Compte bancaire",
              currency: account.currency || "EUR", maskedIdentifier: maskIdentifier(account.iban ?? account.number),
              provider: connection.connectorName, sourceWorkspaceId: company.id, sourceAccountId,
              balance: typeof account.balance === "number" ? account.balance : undefined, createdAt: new Date().toISOString(),
            });
            changed = true;
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

export function createRelation(input: { fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; expectedRevision?: number }): PlatformState {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const nodes = new Set([...state.people, ...state.entities, ...state.accounts].map((node) => node.id));
  if (!nodes.has(input.fromId) || !nodes.has(input.toId)) throw new Error("Les deux éléments de la relation doivent exister.");
  if (input.fromId === input.toId) throw new Error("Un élément ne peut pas être relié à lui-même.");
  if (!RELATION_TYPES.has(input.type)) throw new Error("Type de relation invalide.");
  if (input.ownershipPercent !== undefined && (input.ownershipPercent < 0 || input.ownershipPercent > 100)) throw new Error("Le pourcentage doit être compris entre 0 et 100.");
  const duplicate = state.relations.some((relation) => relation.fromId === input.fromId && relation.toId === input.toId && relation.type === input.type);
  if (!duplicate) {
    state.relations.push({ id: `relation_${randomUUID()}`, fromId: input.fromId, toId: input.toId, type: input.type, label: input.label?.trim() || undefined, ownershipPercent: input.ownershipPercent, source: "manual", createdAt: new Date().toISOString() });
  }
  return duplicate ? state : writeState(state);
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
