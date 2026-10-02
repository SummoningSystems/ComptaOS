import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { getCompaniesRoot, loadCompanies, resolveCompanyPath } from "./companiesService.js";
import { loadFinanceTransactions, type AllocatedTransaction, type FinanceScope } from "./financeAllocationService.js";
import { actorHasGlobalAccess, getScopeAccess, getVisiblePlatformState, type PlatformState } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";
import type { ManualRecurring } from "./manualRecurringService.js";

export interface PortfolioTransfer {
  id: string;
  kind: "confirmed" | "planned";
  sourceScopeId: string;
  destinationScopeId: string;
  amount: number;
  date: string;
  label: string;
  sourceTransactionKey?: string;
  destinationTransactionKey?: string;
  frequency?: "once" | "monthly";
  endDate?: string;
  createdAt: string;
}

interface TransferStore { schemaVersion: 1; transfers: PortfolioTransfer[] }
export interface ConsolidatedForecastMonth { month: string; openingBalance: number; income: number; expenses: number; transfersIn: number; transfersOut: number; closingBalance: number; recurringItems: Array<{ scopeId: string; label: string; amount: number }> }
export interface PortfolioSnapshot {
  rootScopeId: string;
  scopes: FinanceScope[];
  suggestedScopeIds: string[];
  selectedScopeIds: string[];
  balance: number;
  averageIncome: number;
  averageExpenses: number;
  transfers: PortfolioTransfer[];
  transferCandidates: AllocatedTransaction[];
  forecast: ConsolidatedForecastMonth[];
}

const file = () => join(getCompaniesRoot(), "_portfolio_transfers.json");
const round2 = (value: number) => Math.round(value * 100) / 100;
const scopeList = (state: PlatformState): FinanceScope[] => [...state.people, ...state.households, ...state.entities].map(({ id, name, kind }) => ({ id, name, kind }));
function readStore(): TransferStore { if (!existsSync(file())) return { schemaVersion: 1, transfers: [] }; try { const parsed = JSON.parse(readFileSync(file(), "utf-8")) as Partial<TransferStore>; return { schemaVersion: 1, transfers: Array.isArray(parsed.transfers) ? parsed.transfers : [] }; } catch { return { schemaVersion: 1, transfers: [] }; } }
function writeStore(store: TransferStore): void { atomicWriteFileSync(file(), JSON.stringify(store, null, 2)); }
function assertManage(actor: RequestActor, ids: string[]): void { if (actorHasGlobalAccess(actor)) return; if (ids.some((id) => !["owner", "manager"].includes(getScopeAccess(actor, id) ?? ""))) throw Object.assign(new Error("Droits de gestion requis sur les deux périmètres."), { code: "FORBIDDEN" }); }
function monthAt(offset: number, from = new Date()): string { return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + offset, 1)).toISOString().slice(0, 7); }

function suggestedScopes(state: PlatformState, rootScopeId: string): string[] {
  const allowed = new Set(["family", "spouse", "parent", "child", "member", "owner", "shareholder", "subsidiary", "management"]);
  const known = new Set(scopeList(state).map((scope) => scope.id)); const result = new Set([rootScopeId]); const queue = [rootScopeId];
  while (queue.length) { const id = queue.shift()!; for (const relation of state.relations) { if (!allowed.has(relation.type)) continue; const next = relation.fromId === id ? relation.toId : relation.toId === id ? relation.fromId : undefined; if (next && known.has(next) && !result.has(next)) { result.add(next); queue.push(next); } } }
  return [...result];
}

function recurringForScopes(state: PlatformState, selected: Set<string>): Array<{ scopeId: string; item: ManualRecurring }> {
  const result: Array<{ scopeId: string; item: ManualRecurring }> = [];
  for (const company of loadCompanies()) {
    const scopeId = company.scopeId ?? state.entities.find((entity) => entity.workspaceId === company.id)?.id;
    if (!scopeId || !selected.has(scopeId)) continue;
    const recurringFile = join(resolveCompanyPath(company), "settings", "manual_recurring.json");
    if (!existsSync(recurringFile)) continue;
    try { const items = JSON.parse(readFileSync(recurringFile, "utf-8")) as ManualRecurring[]; for (const item of Array.isArray(items) ? items : []) if (item.active && item.decision !== "cancel") result.push({ scopeId, item }); } catch { /* un dossier illisible n'empêche pas la consolidation */ }
  }
  return result;
}

function recurringAmount(item: ManualRecurring, month: string): number {
  const interval = item.frequency === "mensuel" ? 1 : item.frequency === "trimestriel" ? 3 : 12;
  const start = new Date(`${item.nextPayment}T00:00:00Z`); const target = new Date(`${month}-01T00:00:00Z`);
  if (item.endPayment && `${month}-01` > item.endPayment) return 0;
  const difference = (target.getUTCFullYear() - start.getUTCFullYear()) * 12 + target.getUTCMonth() - start.getUTCMonth();
  return difference >= 0 && difference % interval === 0 ? round2(item.decision === "reduce" && item.simulatedAmount !== undefined ? item.simulatedAmount : item.amount) : 0;
}

function plannedOccurs(transfer: PortfolioTransfer, month: string): boolean {
  if (transfer.kind !== "planned" || month < transfer.date.slice(0, 7) || (transfer.endDate && month > transfer.endDate.slice(0, 7))) return false;
  if (transfer.frequency !== "monthly") return month === transfer.date.slice(0, 7);
  return true;
}

export async function getPortfolioSnapshot(actor: RequestActor, rootScopeId: string, horizon: number, selectedInput?: string[], candidateMonth = monthAt(0)): Promise<PortfolioSnapshot> {
  const state = getVisiblePlatformState(actor); const allScopes = scopeList(state); const available = new Set(allScopes.map((scope) => scope.id));
  if (!available.has(rootScopeId)) throw Object.assign(new Error("Périmètre de consolidation inaccessible."), { code: "NOT_FOUND" });
  const suggestedScopeIds = suggestedScopes(state, rootScopeId); const selectedScopeIds = (selectedInput?.length ? selectedInput : suggestedScopeIds).filter((id, index, list) => available.has(id) && list.indexOf(id) === index);
  if (!selectedScopeIds.includes(rootScopeId)) selectedScopeIds.unshift(rootScopeId);
  const selected = new Set(selectedScopeIds); const store = readStore(); const visibleTransfers = store.transfers.filter((transfer) => available.has(transfer.sourceScopeId) && available.has(transfer.destinationScopeId));
  const relatedAccounts = new Set(state.relations.filter((relation) => selected.has(relation.fromId) || selected.has(relation.toId)).flatMap((relation) => state.accounts.some((account) => account.id === relation.fromId) ? [relation.fromId] : state.accounts.some((account) => account.id === relation.toId) ? [relation.toId] : []));
  const balance = round2(state.accounts.filter((account) => relatedAccounts.has(account.id)).reduce((sum, account) => sum + (account.balance ?? 0), 0));
  const confirmedKeys = new Set(visibleTransfers.filter((transfer) => transfer.kind === "confirmed" && selected.has(transfer.sourceScopeId) && selected.has(transfer.destinationScopeId)).flatMap((transfer) => [transfer.sourceTransactionKey, transfer.destinationTransactionKey].filter(Boolean) as string[]));
  let incomeTotal = 0; let expenseTotal = 0;
  for (const offset of [-3, -2, -1]) { const loaded = await loadFinanceTransactions(actor, monthAt(offset)); for (const transaction of loaded.transactions) { if (confirmedKeys.has(transaction.key)) continue; const amount = transaction.allocations.filter((allocation) => selected.has(allocation.scopeId)).reduce((sum, allocation) => sum + allocation.amount, 0); if (amount > 0) incomeTotal += amount; else expenseTotal += Math.abs(amount); } }
  const averageIncome = round2(incomeTotal / 3); const averageExpenses = round2(expenseTotal / 3); const recurring = recurringForScopes(state, selected); const forecast: ConsolidatedForecastMonth[] = []; let running = balance;
  for (let offset = 0; offset < Math.min(36, Math.max(1, horizon)); offset += 1) {
    const month = monthAt(offset); const recurringItems = recurring.map(({ scopeId, item }) => ({ scopeId, label: item.label, amount: recurringAmount(item, month) })).filter((item) => item.amount > 0);
    const expenses = round2(recurringItems.reduce((sum, item) => sum + item.amount, 0)); let transfersIn = 0; let transfersOut = 0;
    for (const transfer of visibleTransfers) if (plannedOccurs(transfer, month)) { const source = selected.has(transfer.sourceScopeId); const destination = selected.has(transfer.destinationScopeId); if (source && !destination) transfersOut += transfer.amount; if (destination && !source) transfersIn += transfer.amount; }
    const openingBalance = running; running = round2(running + averageIncome - expenses + transfersIn - transfersOut); forecast.push({ month, openingBalance, income: averageIncome, expenses, transfersIn: round2(transfersIn), transfersOut: round2(transfersOut), closingBalance: running, recurringItems });
  }
  const candidates = (await loadFinanceTransactions(actor, candidateMonth)).transactions.filter((transaction) => transaction.allocations.some((allocation) => selected.has(allocation.scopeId)));
  return { rootScopeId, scopes: allScopes, suggestedScopeIds, selectedScopeIds, balance, averageIncome, averageExpenses, transfers: visibleTransfers.filter((transfer) => selected.has(transfer.sourceScopeId) || selected.has(transfer.destinationScopeId)), transferCandidates: candidates, forecast };
}

export async function createPortfolioTransfer(actor: RequestActor, input: Omit<PortfolioTransfer, "id" | "createdAt">): Promise<PortfolioTransfer> {
  const state = getVisiblePlatformState(actor); const available = new Set(scopeList(state).map((scope) => scope.id));
  if (!available.has(input.sourceScopeId) || !available.has(input.destinationScopeId) || input.sourceScopeId === input.destinationScopeId) throw new Error("Choisis deux périmètres différents et accessibles.");
  if (!Number.isFinite(input.amount) || input.amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !input.label?.trim()) throw new Error("Montant, date et libellé valides requis.");
  assertManage(actor, [input.sourceScopeId, input.destinationScopeId]);
  if (input.kind === "confirmed") {
    if (!input.sourceTransactionKey || !input.destinationTransactionKey) throw new Error("Les deux mouvements bancaires sont requis.");
    const month = input.date.slice(0, 7); const loaded = await loadFinanceTransactions(actor, month); const source = loaded.transactions.find((item) => item.key === input.sourceTransactionKey); const destination = loaded.transactions.find((item) => item.key === input.destinationTransactionKey);
    if (!source || !destination || source.amount_ttc >= 0 || destination.amount_ttc <= 0 || Math.abs(Math.abs(source.amount_ttc) - destination.amount_ttc) >= .01 || Math.abs(destination.amount_ttc - input.amount) >= .01) throw new Error("Les deux mouvements doivent être opposés et du même montant.");
    if (!source.allocations.some((allocation) => allocation.scopeId === input.sourceScopeId) || !destination.allocations.some((allocation) => allocation.scopeId === input.destinationScopeId)) throw new Error("Les mouvements ne correspondent pas aux périmètres choisis.");
  }
  const transfer: PortfolioTransfer = { ...input, amount: round2(input.amount), label: input.label.trim(), frequency: input.kind === "planned" ? input.frequency ?? "once" : undefined, id: `transfer_${randomUUID()}`, createdAt: new Date().toISOString() };
  const store = readStore(); if (transfer.kind === "confirmed" && store.transfers.some((item) => item.sourceTransactionKey === transfer.sourceTransactionKey || item.destinationTransactionKey === transfer.destinationTransactionKey)) throw new Error("Un de ces mouvements est déjà relié à un transfert.");
  store.transfers.push(transfer); writeStore(store); return transfer;
}

export function deletePortfolioTransfer(actor: RequestActor, id: string): void { const store = readStore(); const transfer = store.transfers.find((item) => item.id === id); if (!transfer) throw Object.assign(new Error("Transfert introuvable."), { code: "NOT_FOUND" }); assertManage(actor, [transfer.sourceScopeId, transfer.destinationScopeId]); store.transfers = store.transfers.filter((item) => item.id !== id); writeStore(store); }
