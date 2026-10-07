import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { resolve, sep, join } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot, loadCompanies, updateCompanyMetadata } from "./companiesService.js";

export type PlatformNodeKind = "person" | "household" | "entity" | "account";

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
  legalType?: "company" | "sci" | "holding" | "association" | "sole_proprietorship" | "other";
  capitalAmount?: number;
  taxRegime?: "is" | "ir" | "micro" | "non_profit" | "other";
  vatRegime?: "monthly_ca3" | "quarterly_ca3" | "simplified_ca12" | "franchise";
  startDate?: string;
  endDate?: string;
  fiscalYearStart?: string;
  fiscalYearEnd?: string;
  fiscalPeriods?: Array<{ id: string; startDate: string; endDate: string; label?: string }>;
  createdAt: string;
}

export interface PlatformHousehold {
  id: string;
  kind: "household";
  name: string;
  notes?: string;
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
  | "member"
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
  shareCount?: number;
  ultimateBeneficiaryId?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  financialLinkType?: "none" | "shareholder_current_account" | "intercompany_loan";
  financialAmount?: number;
  interestRate?: number;
  source: "manual" | "workspace";
  createdAt: string;
}

export interface CreateRelationResult {
  state: PlatformState;
  relation: PlatformRelation;
  created: boolean;
}

export interface StructureIssue { id: string; scopeId: string; severity: "warning" | "blocking"; code: string; message: string }

export type PlatformAccessRole = "owner" | "manager" | "viewer";
export interface PlatformAccessGrant { id: string; userId: string; scopeId: string; role: PlatformAccessRole; createdAt: string; createdBy: string }

export interface PlatformState {
  schemaVersion: 1;
  revision: number;
  people: PlatformPerson[];
  households: PlatformHousehold[];
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
  return { schemaVersion: 1, revision: 0, people: [], households: [], entities: [], accounts: [], relations: [], grants: [], updatedAt: new Date(0).toISOString() };
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
    return isState(parsed) ? { ...parsed, households: parsed.households ?? [], grants: parsed.grants ?? [] } : emptyState();
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

interface StoredCompanyProfile {
  legalForm?: string;
  capital?: string | number;
  vatRegime?: PlatformEntity["vatRegime"];
}

function profileForCompany(companyPath: string): StoredCompanyProfile {
  const file = join(companyPath, "settings", "company_profile.json");
  if (!existsSync(file)) return {};
  try { return JSON.parse(readFileSync(file, "utf-8")) as StoredCompanyProfile; }
  catch { return {}; }
}

function legalTypeFromProfile(value?: string): PlatformEntity["legalType"] | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["ei", "eirl", "micro", "micro-entreprise", "auto-entrepreneur", "entreprise individuelle"].includes(normalized)) return "sole_proprietorship";
  if (normalized.includes("sci")) return "sci";
  if (normalized.includes("holding")) return "holding";
  if (normalized.includes("association")) return "association";
  return "company";
}

/** Synchronise uniquement des références. Aucune donnée d'entreprise n'est déplacée ou modifiée. */
export function getPlatformState(): PlatformState {
  let state = readState();
  let changed = false;

  for (const company of loadCompanies()) {
    const entityId = `entity_${company.id}`;
    const isBusiness = !company.kind || company.kind === "business";
    const companyPath = safeCompanyPath(company.path);
    const storedProfile = companyPath ? profileForCompany(companyPath) : {};
    const inferredLegalType = company.legalType ?? legalTypeFromProfile(storedProfile.legalForm);
    const inferredCapital = storedProfile.capital === undefined || storedProfile.capital === "" ? undefined : Number(storedProfile.capital);
    if (isBusiness && !state.entities.some((entity) => entity.id === entityId)) {
      state.entities.push({ id: entityId, kind: "entity", name: company.name, workspaceId: company.id, legalType: inferredLegalType, capitalAmount: Number.isFinite(inferredCapital) ? inferredCapital : undefined, vatRegime: storedProfile.vatRegime, createdAt: company.createdAt });
      changed = true;
    } else if (isBusiness) {
      const entity = state.entities.find((item) => item.id === entityId)!;
      const patch = {
        name: company.name,
        legalType: entity.legalType ?? inferredLegalType,
        capitalAmount: entity.capitalAmount ?? (Number.isFinite(inferredCapital) ? inferredCapital : undefined),
        vatRegime: entity.vatRegime ?? storedProfile.vatRegime,
      };
      if (entity.name !== patch.name || entity.legalType !== patch.legalType || entity.capitalAmount !== patch.capitalAmount || entity.vatRegime !== patch.vatRegime) { Object.assign(entity, patch); changed = true; }
    }

    if (company.scopeId) {
      const manualAccountId = stableId("account", `${company.id}:main`);
      if (!state.accounts.some((account) => account.id === manualAccountId)) {
        state.accounts.push({ id: manualAccountId, kind: "account", name: "Saisie manuelle", currency: "EUR", provider: "ComptaOS", sourceWorkspaceId: company.id, sourceAccountId: "main", createdAt: company.createdAt }); changed = true;
      }
      const manualRelationId = stableId("relation", `${company.scopeId}:uses:${manualAccountId}`);
      if (!state.relations.some((relation) => relation.id === manualRelationId)) {
        state.relations.push({ id: manualRelationId, fromId: company.scopeId, toId: manualAccountId, type: "uses", source: "workspace", createdAt: company.createdAt }); changed = true;
      }
    }

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
          const ownerScopeId = company.scopeId ?? entityId;
          const relationId = stableId("relation", `${ownerScopeId}:uses:${accountId}`);
          if (!state.relations.some((relation) => relation.id === relationId)) {
            state.relations.push({ id: relationId, fromId: ownerScopeId, toId: accountId, type: "uses", source: "workspace", createdAt: new Date().toISOString() });
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

export function createHousehold(input: { name: string; notes?: string; expectedRevision?: number }): PlatformState {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const name = input.name.trim();
  if (!name) throw new Error("Le nom du foyer est requis.");
  state.households.push({ id: `household_${randomUUID()}`, kind: "household", name, notes: input.notes?.trim() || undefined, createdAt: new Date().toISOString() });
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

export function updateEntity(id: string, input: Partial<Omit<PlatformEntity, "id" | "kind" | "workspaceId" | "createdAt">> & { expectedRevision?: number }): PlatformState {
  const state = getPlatformState(); assertRevision(state, input.expectedRevision); const entity = state.entities.find((item) => item.id === id);
  if (!entity) throw Object.assign(new Error("Structure introuvable."), { code: "NOT_FOUND" });
  if (input.legalType && !["company", "sci", "holding", "association", "sole_proprietorship", "other"].includes(input.legalType)) throw new Error("Forme juridique invalide.");
  if (input.taxRegime && !["is", "ir", "micro", "non_profit", "other"].includes(input.taxRegime)) throw new Error("Régime fiscal invalide.");
  if (input.vatRegime && !["monthly_ca3", "quarterly_ca3", "simplified_ca12", "franchise"].includes(input.vatRegime)) throw new Error("Régime de TVA invalide.");
  if (input.capitalAmount !== undefined && (!Number.isFinite(input.capitalAmount) || input.capitalAmount < 0)) throw new Error("Capital invalide.");
  for (const value of [input.startDate, input.endDate]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date invalide.");
  for (const value of [input.fiscalYearStart, input.fiscalYearEnd]) if (value && !/^\d{2}-\d{2}$/.test(value)) throw new Error("Date d’exercice invalide (MM-JJ attendu).");
  if (input.fiscalPeriods !== undefined) {
    const ids = new Set<string>();
    const ordered = [...input.fiscalPeriods].sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (const period of ordered) {
      if (!period.id?.trim() || ids.has(period.id)) throw new Error("Chaque exercice comptable doit avoir un identifiant unique.");
      ids.add(period.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(period.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(period.endDate)) throw new Error("Les dates de l’exercice comptable sont incomplètes.");
      if (period.endDate < period.startDate) throw new Error("La fin d’un exercice comptable précède son début.");
    }
    for (let index = 1; index < ordered.length; index += 1) if (ordered[index].startDate <= ordered[index - 1].endDate) throw new Error("Deux exercices comptables se chevauchent.");
  }
  const nextStart = input.startDate === undefined ? entity.startDate : input.startDate || undefined;
  const nextEnd = input.endDate === undefined ? entity.endDate : input.endDate || undefined;
  if (nextStart && nextEnd && nextEnd < nextStart) throw new Error("La date de fin précède la date de début.");
  if (input.name !== undefined) { if (!input.name.trim()) throw new Error("Le nom est requis."); entity.name = input.name.trim(); }
  Object.assign(entity, {
    legalType: input.legalType ?? entity.legalType,
    capitalAmount: input.capitalAmount ?? entity.capitalAmount,
    taxRegime: input.taxRegime ?? entity.taxRegime,
    vatRegime: input.vatRegime ?? entity.vatRegime,
    startDate: input.startDate === undefined ? entity.startDate : input.startDate || undefined,
    endDate: input.endDate === undefined ? entity.endDate : input.endDate || undefined,
    fiscalYearStart: input.fiscalYearStart === undefined ? entity.fiscalYearStart : input.fiscalYearStart || undefined,
    fiscalYearEnd: input.fiscalYearEnd === undefined ? entity.fiscalYearEnd : input.fiscalYearEnd || undefined,
    fiscalPeriods: input.fiscalPeriods === undefined ? entity.fiscalPeriods : input.fiscalPeriods.map((period) => ({ ...period, label: period.label?.trim() || undefined })),
  });
  updateCompanyMetadata(entity.workspaceId, { name: entity.name, legalType: entity.legalType }); return writeState(state);
}

const RELATION_TYPES = new Set<PlatformRelationType>(["family", "spouse", "parent", "child", "member", "accountant", "advisor", "owner", "director", "employee", "beneficiary", "shareholder", "subsidiary", "management", "holder", "uses", "other"]);

export type RelationInput = { fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; shareCount?: number; ultimateBeneficiaryId?: string; effectiveFrom?: string; effectiveTo?: string; financialLinkType?: PlatformRelation["financialLinkType"]; financialAmount?: number; interestRate?: number; expectedRevision?: number };
function validateRelationInput(state: PlatformState, input: RelationInput): void {
  if (input.ownershipPercent !== undefined && (!Number.isFinite(input.ownershipPercent) || input.ownershipPercent < 0 || input.ownershipPercent > 100)) throw new Error("Le pourcentage doit être compris entre 0 et 100.");
  if (input.shareCount !== undefined && (!Number.isInteger(input.shareCount) || input.shareCount < 0)) throw new Error("Le nombre de parts doit être un entier positif.");
  if (input.financialAmount !== undefined && (!Number.isFinite(input.financialAmount) || input.financialAmount < 0)) throw new Error("Le montant financier est invalide.");
  if (input.interestRate !== undefined && (!Number.isFinite(input.interestRate) || input.interestRate < 0 || input.interestRate > 100)) throw new Error("Le taux d’intérêt est invalide.");
  for (const value of [input.effectiveFrom, input.effectiveTo]) if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Date d’effet invalide.");
  if (input.effectiveFrom && input.effectiveTo && input.effectiveTo < input.effectiveFrom) throw new Error("La fin du lien précède son début.");
  if (input.ultimateBeneficiaryId && !state.people.some((person) => person.id === input.ultimateBeneficiaryId)) throw new Error("Le bénéficiaire effectif doit être une personne connue.");
}
export function createRelation(input: RelationInput): CreateRelationResult {
  const state = getPlatformState();
  assertRevision(state, input.expectedRevision);
  const nodes = new Set([...state.people, ...state.households, ...state.entities, ...state.accounts].map((node) => node.id));
  if (!nodes.has(input.fromId) || !nodes.has(input.toId)) throw new Error("Les deux éléments de la relation doivent exister.");
  if (input.fromId === input.toId) throw new Error("Un élément ne peut pas être relié à lui-même.");
  if (!RELATION_TYPES.has(input.type)) throw new Error("Type de relation invalide.");
  validateRelationInput(state, input);
  const duplicate = state.relations.find((relation) => relation.fromId === input.fromId && relation.toId === input.toId && relation.type === input.type);
  if (duplicate) return { state, relation: duplicate, created: false };

  const relation: PlatformRelation = { id: `relation_${randomUUID()}`, fromId: input.fromId, toId: input.toId, type: input.type, label: input.label?.trim() || undefined, ownershipPercent: input.ownershipPercent, shareCount: input.shareCount, ultimateBeneficiaryId: input.ultimateBeneficiaryId, effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo, financialLinkType: input.financialLinkType ?? "none", financialAmount: input.financialAmount, interestRate: input.interestRate, source: "manual", createdAt: new Date().toISOString() };
  state.relations.push(relation);
  return { state: writeState(state), relation, created: true };
}

export function updateRelation(id: string, input: Partial<RelationInput>): PlatformState {
  const state = getPlatformState(); assertRevision(state, input.expectedRevision); const relation = state.relations.find((item) => item.id === id);
  if (!relation) throw Object.assign(new Error("Relation introuvable."), { code: "NOT_FOUND" });
  if (relation.source === "workspace") throw new Error("Une relation automatique ne peut pas être modifiée ici.");
  const merged = { ...relation, ...input } as RelationInput; validateRelationInput(state, merged);
  Object.assign(relation, { label: input.label === undefined ? relation.label : input.label.trim() || undefined, ownershipPercent: input.ownershipPercent ?? relation.ownershipPercent, shareCount: input.shareCount ?? relation.shareCount, ultimateBeneficiaryId: input.ultimateBeneficiaryId ?? relation.ultimateBeneficiaryId, effectiveFrom: input.effectiveFrom ?? relation.effectiveFrom, effectiveTo: input.effectiveTo ?? relation.effectiveTo, financialLinkType: input.financialLinkType ?? relation.financialLinkType, financialAmount: input.financialAmount ?? relation.financialAmount, interestRate: input.interestRate ?? relation.interestRate });
  return writeState(state);
}

export function getStructureIssues(state = getPlatformState()): StructureIssue[] {
  const issues: StructureIssue[] = [];
  for (const entity of state.entities) {
    if (!entity.legalType) issues.push({ id: `${entity.id}:legal-type`, scopeId: entity.id, severity: "blocking", code: "MISSING_LEGAL_TYPE", message: `${entity.name} n’a pas de forme juridique.` });
    if (!entity.taxRegime) issues.push({ id: `${entity.id}:tax`, scopeId: entity.id, severity: "warning", code: "MISSING_TAX_REGIME", message: `${entity.name} n’a pas de régime fiscal.` });
    if (!entity.vatRegime) issues.push({ id: `${entity.id}:vat`, scopeId: entity.id, severity: "warning", code: "MISSING_VAT_REGIME", message: `${entity.name} n’a pas de régime de TVA.` });
    if (!entity.startDate) issues.push({ id: `${entity.id}:activity-start`, scopeId: entity.id, severity: "warning", code: "MISSING_ACTIVITY_START", message: `${entity.name} n’a pas de date de début d’activité.` });
    if (!entity.fiscalYearStart || !entity.fiscalYearEnd) issues.push({ id: `${entity.id}:fiscal-cycle`, scopeId: entity.id, severity: "warning", code: "MISSING_FISCAL_CYCLE", message: `${entity.name} n’a pas de cycle annuel de référence complet.` });
    const ownership = state.relations.filter((relation) => relation.toId === entity.id && ["owner", "shareholder", "subsidiary"].includes(relation.type));
    if (!ownership.length) issues.push({ id: `${entity.id}:owner`, scopeId: entity.id, severity: "blocking", code: "MISSING_OWNER", message: `${entity.name} n’est rattachée à aucun associé, foyer ou structure.` });
    else if (ownership.some((relation) => relation.ownershipPercent === undefined)) issues.push({ id: `${entity.id}:percent`, scopeId: entity.id, severity: "warning", code: "MISSING_OWNERSHIP", message: `Au moins une participation de ${entity.name} n’a pas de pourcentage.` });
    else { const total = roundPercentage(ownership.reduce((sum, relation) => sum + (relation.ownershipPercent ?? 0), 0)); if (total !== 100) issues.push({ id: `${entity.id}:total`, scopeId: entity.id, severity: "warning", code: "OWNERSHIP_TOTAL", message: `Les participations de ${entity.name} totalisent ${total} % au lieu de 100 %.` }); }
    if (entity.legalType === "sci" && !ownership.some((relation) => state.households.some((household) => household.id === relation.fromId) || state.people.some((person) => person.id === relation.fromId))) issues.push({ id: `${entity.id}:sci-owner`, scopeId: entity.id, severity: "warning", code: "SCI_WITHOUT_NATURAL_OWNER", message: `La SCI ${entity.name} n’est reliée à aucun foyer ou associé personne physique.` });
  }
  return issues;
}
function roundPercentage(value: number): number { return Math.round(value * 100) / 100; }

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
  const scopes = new Set([...state.people, ...state.households, ...state.entities].map((scope) => scope.id));
  const accounts = new Set(state.accounts.map((account) => account.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of state.relations) {
      const memberLink = relation.type === "member" && scopes.has(relation.fromId) && scopes.has(relation.toId);
      const accountLink = relation.type === "holder" || relation.type === "uses";
      if ((memberLink || accountLink) && visible.has(relation.fromId) && !visible.has(relation.toId) && (memberLink || accounts.has(relation.toId))) { visible.add(relation.toId); changed = true; }
      if ((memberLink || accountLink) && visible.has(relation.toId) && !visible.has(relation.fromId) && (memberLink || accounts.has(relation.fromId))) { visible.add(relation.fromId); changed = true; }
    }
  }
  return { ...state, people: state.people.filter((item) => visible.has(item.id)), households: state.households.filter((item) => visible.has(item.id)), entities: state.entities.filter((item) => visible.has(item.id)), accounts: state.accounts.filter((item) => visible.has(item.id)), relations: state.relations.filter((item) => visible.has(item.fromId) && visible.has(item.toId)), grants: state.grants.filter((grant) => grant.userId === actor.id) };
}

export function setAccessGrant(input: { userId: string; scopeId: string; role: PlatformAccessRole; createdBy: string; expectedRevision?: number }): PlatformState {
  const state = getPlatformState(); assertRevision(state, input.expectedRevision);
  const nodes = new Set([...state.people, ...state.households, ...state.entities, ...state.accounts].map((node) => node.id));
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
