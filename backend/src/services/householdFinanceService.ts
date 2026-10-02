import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot } from "./companiesService.js";
import { loadFinanceTransactions, type AllocatedTransaction } from "./financeAllocationService.js";
import { PERSONAL_CATEGORIES, type PersonalBudget, type PersonalCategory } from "./personalFinanceService.js";
import { getPlatformState, type PlatformAccount } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";

export interface HouseholdTransaction extends AllocatedTransaction { allocatedAmount: number; allocatedScopes: Array<{ scopeId: string; name: string; amount: number }>; internalTransfer: boolean }
export interface HouseholdFinanceSnapshot {
  household: { id: string; name: string };
  month: string;
  members: Array<{ id: string; name: string; income: number; expenses: number; net: number }>;
  accounts: PlatformAccount[];
  transactions: HouseholdTransaction[];
  budgets: PersonalBudget[];
  categories: typeof PERSONAL_CATEGORIES;
  summary: { balance: number; income: number; expenses: number; net: number; internalTransfers: number };
}

const storeFile = (id: string) => join(getCompaniesRoot(), "_households", id, "finance.json");
function readBudgets(id: string): PersonalBudget[] {
  if (!existsSync(storeFile(id))) return [];
  try { const parsed = JSON.parse(readFileSync(storeFile(id), "utf-8")) as { budgets?: PersonalBudget[] }; return Array.isArray(parsed.budgets) ? parsed.budgets : []; }
  catch { return []; }
}
function directAccountIds(scopeIds: Set<string>): Set<string> {
  const state = getPlatformState(); const result = new Set<string>();
  for (const relation of state.relations) {
    if (relation.type !== "holder" && relation.type !== "uses") continue;
    if (scopeIds.has(relation.fromId) && state.accounts.some((account) => account.id === relation.toId)) result.add(relation.toId);
    if (scopeIds.has(relation.toId) && state.accounts.some((account) => account.id === relation.fromId)) result.add(relation.fromId);
  }
  return result;
}
function markTransfers(transactions: HouseholdTransaction[]): void {
  const used = new Set<string>();
  for (const transaction of transactions) {
    if (used.has(transaction.key) || !/virement|transfer/i.test(transaction.label)) continue;
    const match = transactions.find((candidate) => candidate.key !== transaction.key && !used.has(candidate.key) && candidate.platformAccountId !== transaction.platformAccountId && Math.abs(candidate.allocatedAmount + transaction.allocatedAmount) < .01 && Math.abs(new Date(candidate.date).getTime() - new Date(transaction.date).getTime()) <= 2 * 86_400_000);
    if (match) { transaction.internalTransfer = true; match.internalTransfer = true; used.add(transaction.key); used.add(match.key); }
  }
}

export async function getHouseholdFinance(householdId: string, month: string, actor: RequestActor): Promise<HouseholdFinanceSnapshot> {
  const state = getPlatformState(); const household = state.households.find((item) => item.id === householdId);
  if (!household) throw Object.assign(new Error("Foyer introuvable."), { code: "NOT_FOUND" });
  const memberIds = new Set(state.relations.filter((relation) => relation.type === "member" && (relation.fromId === householdId || relation.toId === householdId)).map((relation) => relation.fromId === householdId ? relation.toId : relation.fromId));
  const members = state.people.filter((person) => memberIds.has(person.id));
  const includedScopes = new Set([householdId, ...members.map((member) => member.id)]);
  const loaded = await loadFinanceTransactions(actor, month);
  const names = new Map([...state.people, ...state.households, ...state.entities].map((scope) => [scope.id, scope.name]));
  const transactions: HouseholdTransaction[] = [];
  for (const transaction of loaded.transactions) {
    const relevant = transaction.allocations.filter((allocation) => includedScopes.has(allocation.scopeId));
    if (!relevant.length) continue;
    transactions.push({ ...transaction, allocatedAmount: relevant.reduce((sum, allocation) => sum + allocation.amount, 0), allocatedScopes: relevant.map((allocation) => ({ ...allocation, name: names.get(allocation.scopeId) ?? "Périmètre" })), internalTransfer: false });
  }
  markTransfers(transactions);
  const active = transactions.filter((transaction) => !transaction.internalTransfer);
  const income = active.filter((transaction) => transaction.allocatedAmount > 0).reduce((sum, transaction) => sum + transaction.allocatedAmount, 0);
  const expenses = active.filter((transaction) => transaction.allocatedAmount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.allocatedAmount), 0);
  const accountIds = directAccountIds(includedScopes); for (const transaction of transactions) accountIds.add(transaction.platformAccountId);
  const accounts = loaded.accounts.filter((account) => accountIds.has(account.id));
  return {
    household: { id: household.id, name: household.name }, month, accounts, transactions, budgets: readBudgets(householdId), categories: PERSONAL_CATEGORIES,
    members: members.map((member) => { const amounts = active.flatMap((transaction) => transaction.allocations.filter((allocation) => allocation.scopeId === member.id).map((allocation) => allocation.amount)); const memberIncome = amounts.filter((amount) => amount > 0).reduce((sum, amount) => sum + amount, 0); const memberExpenses = amounts.filter((amount) => amount < 0).reduce((sum, amount) => sum + Math.abs(amount), 0); return { id: member.id, name: member.name, income: memberIncome, expenses: memberExpenses, net: memberIncome - memberExpenses }; }),
    summary: { balance: accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0), income, expenses, net: income - expenses, internalTransfers: transactions.filter((transaction) => transaction.internalTransfer).length / 2 },
  };
}

export function saveHouseholdBudgets(householdId: string, budgets: Array<{ category: string; monthlyLimit: number }>): PersonalBudget[] {
  const state = getPlatformState(); if (!state.households.some((household) => household.id === householdId)) throw Object.assign(new Error("Foyer introuvable."), { code: "NOT_FOUND" });
  const categories = new Set(PERSONAL_CATEGORIES.map((category) => category.id as string)); const unique = new Map<PersonalCategory, PersonalBudget>();
  for (const budget of budgets) { if (!categories.has(budget.category) || !Number.isFinite(budget.monthlyLimit) || budget.monthlyLimit < 0) throw new Error("Budget du foyer invalide."); const amount = Math.round(budget.monthlyLimit * 100) / 100; if (amount > 0) unique.set(budget.category as PersonalCategory, { category: budget.category as PersonalCategory, monthlyLimit: amount }); }
  const normalized = [...unique.values()]; atomicWriteFileSync(storeFile(householdId), JSON.stringify({ schemaVersion: 1, budgets: normalized }, null, 2)); return normalized;
}
