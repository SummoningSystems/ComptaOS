import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Transaction } from "../types/index.js";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot, loadCompanies, resolveCompanyPath } from "./companiesService.js";
import { actorHasGlobalAccess, getScopeAccess, getVisiblePlatformState, type PlatformAccount, type PlatformState } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";
import { loadAllTransactions } from "./transactionService.js";
import { workspaceContext } from "./workspaceContext.js";

export type AccountUsage = "personal" | "business" | "shared" | "mixed";
export interface FinanceAllocation { scopeId: string; amount: number }
export interface AccountAssignment { usage: AccountUsage; defaultScopeId?: string }
export interface AllocationRule { id: string; pattern: string; scopeId: string }
export interface AllocationStore {
  schemaVersion: 1;
  accounts: Record<string, AccountAssignment>;
  transactions: Record<string, FinanceAllocation[]>;
  rules: AllocationRule[];
}
export interface FinanceScope { id: string; name: string; kind: "person" | "household" | "entity" }
export interface AllocatedTransaction extends Transaction {
  key: string;
  platformAccountId: string;
  accountName: string;
  sourceWorkspaceId: string;
  allocations: FinanceAllocation[];
  allocationSource: "manual" | "rule" | "account" | "relation" | "unassigned";
}
export interface FinanceAllocationSnapshot {
  month: string;
  scopes: FinanceScope[];
  accounts: Array<PlatformAccount & AccountAssignment>;
  transactions: AllocatedTransaction[];
  rules: AllocationRule[];
  unassignedCount: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const storeFile = () => join(getCompaniesRoot(), "_finance_allocations.json");
const emptyStore = (): AllocationStore => ({ schemaVersion: 1, accounts: {}, transactions: {}, rules: [] });
function readStore(): AllocationStore {
  if (!existsSync(storeFile())) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(storeFile(), "utf-8")) as Partial<AllocationStore>;
    return parsed.schemaVersion === 1 ? { schemaVersion: 1, accounts: parsed.accounts ?? {}, transactions: parsed.transactions ?? {}, rules: parsed.rules ?? [] } : emptyStore();
  } catch { return emptyStore(); }
}
function writeStore(store: AllocationStore): void { atomicWriteFileSync(storeFile(), JSON.stringify(store, null, 2)); }
function scopes(state: PlatformState): FinanceScope[] { return [...state.people, ...state.households, ...state.entities].map(({ id, name, kind }) => ({ id, name, kind })); }
function normalizePattern(label: string): string { return label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\d+/g, " ").replace(/[^a-z]+/g, " ").trim().split(/\s+/).filter((part) => part.length > 2).slice(0, 5).join(" "); }
function assertManageScopes(actor: RequestActor, scopeIds: string[]): void {
  if (actorHasGlobalAccess(actor)) return;
  if (scopeIds.some((scopeId) => !["owner", "manager"].includes(getScopeAccess(actor, scopeId) ?? ""))) throw Object.assign(new Error("Droits de gestion requis sur tous les périmètres concernés."), { code: "FORBIDDEN" });
}

function relatedDefault(state: PlatformState, account: PlatformAccount): { usage: AccountUsage; scopeId?: string } {
  const linked = state.relations.filter((relation) => (relation.type === "holder" || relation.type === "uses") && (relation.fromId === account.id || relation.toId === account.id)).map((relation) => relation.fromId === account.id ? relation.toId : relation.fromId);
  const household = state.households.find((item) => linked.includes(item.id));
  if (household) return { usage: "shared", scopeId: household.id };
  const people = state.people.filter((item) => linked.includes(item.id));
  if (people.length === 1) return { usage: "personal", scopeId: people[0].id };
  const entity = state.entities.find((item) => item.workspaceId === account.sourceWorkspaceId);
  return { usage: "business", scopeId: entity?.id };
}

function resolveAllocations(transaction: Transaction, key: string, account: PlatformAccount, state: PlatformState, store: AllocationStore): Pick<AllocatedTransaction, "allocations" | "allocationSource"> {
  if (store.transactions[key]) {
    const available = new Set(scopes(state).map((scope) => scope.id));
    const visible = store.transactions[key].filter((allocation) => available.has(allocation.scopeId));
    return visible.length ? { allocations: visible, allocationSource: "manual" } : { allocations: [], allocationSource: "unassigned" };
  }
  const pattern = normalizePattern(transaction.label);
  const rule = store.rules.find((item) => pattern && pattern.includes(item.pattern));
  if (rule && scopes(state).some((scope) => scope.id === rule.scopeId)) return { allocations: [{ scopeId: rule.scopeId, amount: transaction.amount_ttc }], allocationSource: "rule" };
  const configured = store.accounts[account.id];
  if (configured?.usage === "mixed" && !configured.defaultScopeId) return { allocations: [], allocationSource: "unassigned" };
  if (configured?.defaultScopeId && scopes(state).some((scope) => scope.id === configured.defaultScopeId)) return { allocations: [{ scopeId: configured.defaultScopeId, amount: transaction.amount_ttc }], allocationSource: "account" };
  const related = relatedDefault(state, account);
  return related.scopeId ? { allocations: [{ scopeId: related.scopeId, amount: transaction.amount_ttc }], allocationSource: "relation" } : { allocations: [], allocationSource: "unassigned" };
}

export async function loadFinanceTransactions(actor: RequestActor, month?: string): Promise<{ state: PlatformState; store: AllocationStore; accounts: PlatformAccount[]; transactions: AllocatedTransaction[] }> {
  const state = getVisiblePlatformState(actor);
  const store = readStore();
  const accounts = state.accounts;
  const grouped = new Map<string, PlatformAccount[]>();
  for (const account of accounts) grouped.set(account.sourceWorkspaceId, [...(grouped.get(account.sourceWorkspaceId) ?? []), account]);
  const transactions: AllocatedTransaction[] = [];
  for (const [workspaceId, workspaceAccounts] of grouped) {
    const company = loadCompanies().find((item) => item.id === workspaceId); if (!company) continue;
    const accountBySource = new Map(workspaceAccounts.map((account) => [account.sourceAccountId, account]));
    const source = await workspaceContext.run({ companyId: company.id, root: resolveCompanyPath(company), actor, accessRole: "viewer" }, () => loadAllTransactions());
    for (const transaction of source) {
      const account = accountBySource.get(transaction.account);
      if (!account || transaction.status === "rejected" || (month && !transaction.date.startsWith(month))) continue;
      const key = `${workspaceId}:${transaction.id}`;
      transactions.push({ ...transaction, key, platformAccountId: account.id, accountName: account.name, sourceWorkspaceId: workspaceId, ...resolveAllocations(transaction, key, account, state, store) });
    }
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  return { state, store, accounts, transactions };
}

export async function getFinanceAllocationSnapshot(actor: RequestActor, month: string): Promise<FinanceAllocationSnapshot> {
  const loaded = await loadFinanceTransactions(actor, month);
  return {
    month, scopes: scopes(loaded.state), rules: loaded.store.rules.filter((rule) => scopes(loaded.state).some((scope) => scope.id === rule.scopeId)),
    accounts: loaded.accounts.map((account) => ({ ...account, ...(loaded.store.accounts[account.id] ?? relatedDefault(loaded.state, account)) })),
    transactions: loaded.transactions,
    unassignedCount: loaded.transactions.filter((transaction) => transaction.allocations.length === 0).length,
  };
}

export function saveAccountAssignment(accountId: string, input: AccountAssignment, actor: RequestActor): AccountAssignment {
  const state = getVisiblePlatformState(actor);
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) throw Object.assign(new Error("Compte inaccessible."), { code: "NOT_FOUND" });
  if (!["personal", "business", "shared", "mixed"].includes(input.usage)) throw new Error("Usage du compte invalide.");
  if (input.defaultScopeId && !scopes(state).some((scope) => scope.id === input.defaultScopeId)) throw new Error("Périmètre par défaut invalide.");
  if (input.defaultScopeId) assertManageScopes(actor, [input.defaultScopeId]);
  else if (!actorHasGlobalAccess(actor)) {
    const related = relatedDefault(state, account).scopeId;
    if (!related) throw Object.assign(new Error("Droits de gestion requis sur ce compte."), { code: "FORBIDDEN" });
    assertManageScopes(actor, [related]);
  }
  const store = readStore(); store.accounts[accountId] = { usage: input.usage, defaultScopeId: input.defaultScopeId || undefined }; writeStore(store); return store.accounts[accountId];
}

function validateAllocations(amount: number, allocations: FinanceAllocation[], state: PlatformState): FinanceAllocation[] {
  if (!Array.isArray(allocations) || allocations.length === 0) throw new Error("Au moins une affectation est requise.");
  const available = new Set(scopes(state).map((scope) => scope.id));
  const normalized = allocations.map((allocation) => {
    if (!available.has(allocation.scopeId)) throw new Error("Périmètre d’affectation invalide.");
    if (!Number.isFinite(allocation.amount) || (allocation.amount !== 0 && Math.sign(allocation.amount) !== Math.sign(amount))) throw new Error("Les montants répartis doivent avoir le même sens que la transaction.");
    return { scopeId: allocation.scopeId, amount: round2(allocation.amount) };
  }).filter((allocation) => allocation.amount !== 0);
  if (Math.abs(round2(normalized.reduce((sum, allocation) => sum + allocation.amount, 0)) - round2(amount)) >= 0.01) throw new Error("La répartition doit correspondre au montant total de la transaction.");
  return normalized;
}

export async function saveTransactionAllocations(actor: RequestActor, month: string, key: string, allocations: FinanceAllocation[], rememberRule = false): Promise<FinanceAllocation[]> {
  const loaded = await loadFinanceTransactions(actor, month);
  const transaction = loaded.transactions.find((item) => item.key === key);
  if (!transaction) throw Object.assign(new Error("Transaction inaccessible."), { code: "NOT_FOUND" });
  const visibleScopeIds = new Set(scopes(loaded.state).map((scope) => scope.id));
  const hiddenExisting = (loaded.store.transactions[key] ?? []).some((allocation) => !visibleScopeIds.has(allocation.scopeId));
  if (hiddenExisting && !actorHasGlobalAccess(actor)) throw Object.assign(new Error("Cette transaction contient une affectation hors de votre périmètre."), { code: "FORBIDDEN" });
  const normalized = validateAllocations(transaction.amount_ttc, allocations, loaded.state);
  assertManageScopes(actor, normalized.map((allocation) => allocation.scopeId));
  const store = readStore(); store.transactions[key] = normalized;
  if (rememberRule && normalized.length === 1) {
    const pattern = normalizePattern(transaction.label);
    if (pattern) store.rules = [...store.rules.filter((rule) => rule.pattern !== pattern), { id: `rule_${Date.now().toString(36)}`, pattern, scopeId: normalized[0].scopeId }];
  }
  writeStore(store); return normalized;
}

export async function saveBatchAllocation(actor: RequestActor, month: string, keys: string[], scopeId: string): Promise<number> {
  const loaded = await loadFinanceTransactions(actor, month);
  if (!scopes(loaded.state).some((scope) => scope.id === scopeId)) throw new Error("Périmètre invalide.");
  assertManageScopes(actor, [scopeId]);
  const selected = loaded.transactions.filter((transaction) => keys.includes(transaction.key));
  if (selected.length !== new Set(keys).size) throw new Error("Certaines transactions ne sont plus accessibles.");
  const store = readStore(); for (const transaction of selected) store.transactions[transaction.key] = [{ scopeId, amount: transaction.amount_ttc }]; writeStore(store); return selected.length;
}
