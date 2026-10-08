import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Transaction } from "../types/index.js";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot } from "./companiesService.js";
import { loadFinanceTransactions } from "./financeAllocationService.js";
import { getPlatformState, type PlatformAccount } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";

export const PERSONAL_CATEGORIES = [
  { id: "personal_income", label: "Revenus professionnels", kind: "income" },
  { id: "salary_income", label: "Salaires", kind: "income" },
  { id: "benefits_income", label: "Prestations et allocations", kind: "income" },
  { id: "refund_income", label: "Remboursements reçus", kind: "income" },
  { id: "investment_income", label: "Revenus financiers", kind: "income" },
  { id: "housing", label: "Logement", kind: "expense" },
  { id: "groceries", label: "Courses alimentaires", kind: "expense" },
  { id: "dining", label: "Restaurants", kind: "expense" },
  { id: "transport", label: "Transport", kind: "expense" },
  { id: "health", label: "Santé", kind: "expense" },
  { id: "insurance", label: "Assurances", kind: "expense" },
  { id: "utilities", label: "Énergie et services", kind: "expense" },
  { id: "subscriptions", label: "Abonnements", kind: "expense" },
  { id: "leisure", label: "Loisirs et sorties", kind: "expense" },
  { id: "shopping", label: "Achats personnels", kind: "expense" },
  { id: "education", label: "Formation et éducation", kind: "expense" },
  { id: "personal_taxes", label: "Impôts personnels", kind: "expense" },
  { id: "savings", label: "Épargne et placements", kind: "expense" },
  { id: "family", label: "Famille", kind: "expense" },
  { id: "pets", label: "Animaux", kind: "expense" },
  { id: "personal_misc", label: "Divers personnel", kind: "both" },
] as const;

export type PersonalCategory = typeof PERSONAL_CATEGORIES[number]["id"];
export interface PersonalBudget { category: PersonalCategory; monthlyLimit: number }
interface PersonalStore { schemaVersion: 1; categories: Record<string, PersonalCategory>; budgets: PersonalBudget[] }

export interface PersonalTransaction extends Transaction {
  key: string;
  sourceWorkspaceId: string;
  sourceAccountId: string;
  accountName: string;
  personalCategory: PersonalCategory;
  internalTransfer: boolean;
  originalAmountTtc?: number;
}

export interface PersonalFinanceSnapshot {
  person: { id: string; name: string };
  month: string;
  accounts: PlatformAccount[];
  transactions: PersonalTransaction[];
  budgets: PersonalBudget[];
  categories: ReadonlyArray<{ id: PersonalCategory; label: string; kind: "income" | "expense" | "both" }>;
  summary: { balance: number; income: number; expenses: number; net: number; internalTransfers: number };
}

function storeFile(personId: string): string { return join(getCompaniesRoot(), "_people", personId, "finance.json"); }
function emptyStore(): PersonalStore { return { schemaVersion: 1, categories: {}, budgets: [] }; }
function readStore(personId: string): PersonalStore {
  const file = storeFile(personId);
  if (!existsSync(file)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as Partial<PersonalStore>;
    return parsed.schemaVersion === 1 && parsed.categories && Array.isArray(parsed.budgets)
      ? { schemaVersion: 1, categories: parsed.categories, budgets: parsed.budgets }
      : emptyStore();
  } catch { return emptyStore(); }
}
function writeStore(personId: string, store: PersonalStore): void { atomicWriteFileSync(storeFile(personId), JSON.stringify(store, null, 2)); }

function personalAccounts(personId: string): PlatformAccount[] {
  const state = getPlatformState();
  const accountIds = new Set(state.relations.filter((relation) =>
    (relation.type === "holder" || relation.type === "uses") &&
    (relation.fromId === personId || relation.toId === personId)
  ).map((relation) => relation.fromId === personId ? relation.toId : relation.fromId));
  return state.accounts.filter((account) => accountIds.has(account.id));
}

function defaultCategory(transaction: Transaction): PersonalCategory {
  if (transaction.amount_ttc > 0) return "personal_income";
  const source = `${transaction.category} ${transaction.label}`.toLowerCase();
  if (/restaurant|food|repas|boulanger|aliment/.test(source)) return /restaurant|repas/.test(source) ? "dining" : "groceries";
  if (/rent|loyer|logement/.test(source)) return "housing";
  if (/transport|travel|sncf|ratp|uber|fuel|carbur/.test(source)) return "transport";
  if (/insurance|assurance|mutuelle/.test(source)) return "insurance";
  if (/énergie|energie|electric|gaz|utilities|engie|edf|eau/.test(source)) return "utilities";
  if (/subscription|abonnement/.test(source)) return "subscriptions";
  if (/tax|impôt|impot/.test(source)) return "personal_taxes";
  return "personal_misc";
}

function markInternalTransfers(transactions: PersonalTransaction[]): void {
  const used = new Set<string>();
  for (const transaction of transactions) {
    if (used.has(transaction.key) || !/virement|transfer/i.test(transaction.label)) continue;
    const date = new Date(transaction.date).getTime();
    const match = transactions.find((candidate) => !used.has(candidate.key) && candidate.key !== transaction.key
      && (candidate.sourceWorkspaceId !== transaction.sourceWorkspaceId || candidate.sourceAccountId !== transaction.sourceAccountId)
      && Math.abs(candidate.amount_ttc + transaction.amount_ttc) < 0.01
      && Math.abs(new Date(candidate.date).getTime() - date) <= 2 * 86_400_000);
    if (match) { transaction.internalTransfer = true; match.internalTransfer = true; used.add(transaction.key); used.add(match.key); }
  }
}

export async function getPersonalFinance(personId: string, month: string, actor: RequestActor): Promise<PersonalFinanceSnapshot> {
  const state = getPlatformState();
  const person = state.people.find((item) => item.id === personId);
  if (!person) throw Object.assign(new Error("Personne introuvable."), { code: "NOT_FOUND" });
  const linkedAccounts = personalAccounts(personId);
  const store = readStore(personId);
  const transactions: PersonalTransaction[] = [];
  const allocated = await loadFinanceTransactions(actor, month);
  for (const transaction of allocated.transactions) {
    const allocation = transaction.allocations.find((item) => item.scopeId === personId);
    if (!allocation) continue;
    const ratio = transaction.amount_ttc === 0 ? 1 : allocation.amount / transaction.amount_ttc;
    transactions.push({ ...transaction, amount_ttc: allocation.amount, amount_ht: Math.round(transaction.amount_ht * ratio * 100) / 100, vat: Math.round(transaction.vat * ratio * 100) / 100, sourceAccountId: transaction.account, personalCategory: store.categories[transaction.key] ?? defaultCategory(transaction), internalTransfer: false, originalAmountTtc: allocation.amount === transaction.amount_ttc ? undefined : transaction.amount_ttc });
  }
  const accountIds = new Set([...linkedAccounts.map((account) => account.id), ...allocated.transactions.filter((transaction) => transaction.allocations.some((item) => item.scopeId === personId)).map((transaction) => transaction.platformAccountId)]);
  const accounts = allocated.accounts.filter((account) => accountIds.has(account.id) && !account.technical);
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  markInternalTransfers(transactions);
  const relevant = transactions.filter((transaction) => !transaction.internalTransfer);
  const income = relevant.filter((transaction) => transaction.amount_ttc > 0).reduce((sum, transaction) => sum + transaction.amount_ttc, 0);
  const expenses = relevant.filter((transaction) => transaction.amount_ttc < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0);
  return {
    person: { id: person.id, name: person.name }, month, accounts, transactions, budgets: store.budgets, categories: PERSONAL_CATEGORIES,
    summary: { balance: accounts.reduce((sum, account) => sum + (account.balance ?? 0), 0), income, expenses, net: income - expenses, internalTransfers: transactions.filter((transaction) => transaction.internalTransfer).length / 2 },
  };
}

function assertCategory(category: string): asserts category is PersonalCategory {
  if (!PERSONAL_CATEGORIES.some((item) => item.id === category)) throw new Error("Catégorie personnelle invalide.");
}

export function setPersonalTransactionCategory(personId: string, key: string, category: string): void {
  const state = getPlatformState();
  if (!state.people.some((person) => person.id === personId)) throw Object.assign(new Error("Personne introuvable."), { code: "NOT_FOUND" });
  assertCategory(category);
  const store = readStore(personId); store.categories[key] = category; writeStore(personId, store);
}

export function savePersonalBudgets(personId: string, budgets: Array<{ category: string; monthlyLimit: number }>): PersonalBudget[] {
  const state = getPlatformState();
  if (!state.people.some((person) => person.id === personId)) throw Object.assign(new Error("Personne introuvable."), { code: "NOT_FOUND" });
  const normalizedByCategory = new Map<PersonalCategory, PersonalBudget>();
  budgets.forEach((budget) => {
    assertCategory(budget.category);
    if (!Number.isFinite(budget.monthlyLimit) || budget.monthlyLimit < 0) throw new Error("Chaque budget doit être un montant positif.");
    const normalized = Math.round(budget.monthlyLimit * 100) / 100;
    if (normalized > 0) normalizedByCategory.set(budget.category, { category: budget.category, monthlyLimit: normalized });
  });
  const normalized = [...normalizedByCategory.values()];
  const store = readStore(personId); store.budgets = normalized; writeStore(personId, store); return normalized;
}
