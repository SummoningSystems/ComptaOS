import { Category, ManualRecurring, Transaction } from "../../types";

export type Frequency = "mensuel" | "trimestriel" | "annuel";
export interface RecurringPattern {
  key: string; label: string; category: Category; amount: number; frequency: Frequency;
  lastDate: string; nextPayment: string; occurrences: number; confidence: "forte" | "moyenne"; trendPercent: number;
}
export interface ForecastMonth { month: string; expenses: number; revenue: number; balance: number; items: Array<{ key: string; label: string; amount: number }> }

export const monthlyEquivalent = (amount: number, frequency: Frequency) => amount / (frequency === "mensuel" ? 1 : frequency === "trimestriel" ? 3 : 12);
export const annualEquivalent = (amount: number, frequency: Frequency) => monthlyEquivalent(amount, frequency) * 12;

function normalizeVendor(label: string): string {
  const ignored = new Set(["cb", "carte", "payment", "paiement", "prelevement", "prlv", "sepa", "facture", "achat", "par", "web"]);
  return label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\d+/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word.length >= 3 && !ignored.has(word)).slice(0, 4).join(" ");
}
export const addCalendarMonths = (date: string, count: number) => { const [year, month, day] = date.split("-").map(Number); const target = new Date(Date.UTC(year, month - 1 + count, 1)); const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate(); return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`; };
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

export function detectRecurring(transactions: Transaction[], today = new Date().toISOString().slice(0, 10)): RecurringPattern[] {
  const groups = new Map<string, Transaction[]>();
  for (const transaction of transactions) { if (transaction.amount_ttc >= 0 || transaction.status === "rejected") continue; const key = normalizeVendor(transaction.label); if (!key) continue; groups.set(key, [...(groups.get(key) ?? []), transaction]); }
  const result: RecurringPattern[] = [];
  for (const [key, entries] of groups) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    const intervals = sorted.slice(1).map((entry, index) => daysBetween(sorted[index].date, entry.date));
    const averageInterval = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const frequency: Frequency | null = averageInterval >= 20 && averageInterval <= 45 ? "mensuel" : averageInterval >= 70 && averageInterval <= 110 ? "trimestriel" : averageInterval >= 320 && averageInterval <= 410 ? "annuel" : null;
    if (!frequency) continue;
    const amounts = sorted.map((entry) => Math.abs(entry.amount_ttc)); const amount = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    const intervalSpread = Math.max(...intervals) - Math.min(...intervals); const amountSpread = (Math.max(...amounts) - Math.min(...amounts)) / Math.max(amount, 0.01);
    const step = frequency === "mensuel" ? 1 : frequency === "trimestriel" ? 3 : 12; let nextPayment = addCalendarMonths(sorted.at(-1)!.date, step); while (nextPayment < today) nextPayment = addCalendarMonths(nextPayment, step);
    result.push({ key, label: sorted.at(-1)!.label, category: sorted.at(-1)!.category, amount: Math.round(amount * 100) / 100, frequency, lastDate: sorted.at(-1)!.date, nextPayment, occurrences: sorted.length, confidence: intervalSpread <= 10 && amountSpread <= 0.2 ? "forte" : "moyenne", trendPercent: amounts.length > 1 ? Math.round(((amounts.at(-1)! - amounts[0]) / Math.max(amounts[0], 0.01)) * 100) : 0 });
  }
  return result.sort((a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency));
}

export function removeManualDuplicates(patterns: RecurringPattern[], manual: ManualRecurring[]): RecurringPattern[] {
  const manualKeys = manual.map((item) => normalizeVendor(item.label));
  return patterns.filter((pattern) => !manualKeys.some((key) => key === pattern.key || key.includes(pattern.key) || pattern.key.includes(key)));
}

export function scenarioAmount(item: ManualRecurring): number {
  if (!item.active || item.decision === "cancel") return 0;
  if (item.decision === "reduce" && typeof item.simulatedAmount === "number") return Math.max(0, item.simulatedAmount);
  return item.amount;
}

export function buildForecast(items: Array<{ id: string; label: string; amount: number; frequency: Frequency; nextPayment: string; active: boolean }>, transactions: Transaction[], monthsAhead: number, startBalance: number, today = new Date().toISOString().slice(0, 10)): ForecastMonth[] {
  const monthStarts = Array.from({ length: monthsAhead }, (_, index) => addCalendarMonths(today.slice(0, 7) + "-01", index));
  const recentStart = addCalendarMonths(today.slice(0, 7) + "-01", -3);
  const revenueByMonth = new Map<string, number>(); transactions.filter((entry) => entry.amount_ttc > 0 && entry.status !== "rejected" && entry.date >= recentStart).forEach((entry) => revenueByMonth.set(entry.date.slice(0, 7), (revenueByMonth.get(entry.date.slice(0, 7)) ?? 0) + entry.amount_ttc));
  const averageRevenue = [...revenueByMonth.values()].reduce((sum, value) => sum + value, 0) / Math.max(revenueByMonth.size, 1);
  let balance = startBalance;
  return monthStarts.map((start) => {
    const month = start.slice(0, 7); const occurrences: ForecastMonth["items"] = [];
    for (const item of items.filter((entry) => entry.active && entry.amount > 0)) { const step = item.frequency === "mensuel" ? 1 : item.frequency === "trimestriel" ? 3 : 12; let cursor = item.nextPayment; let safety = 0; while (cursor.slice(0, 7) < month && safety++ < 120) cursor = addCalendarMonths(cursor, step); if (cursor.slice(0, 7) === month) occurrences.push({ key: item.id, label: item.label, amount: item.amount }); }
    const expenses = occurrences.reduce((sum, item) => sum + item.amount, 0); balance += averageRevenue - expenses;
    return { month, expenses: Math.round(expenses * 100) / 100, revenue: Math.round(averageRevenue * 100) / 100, balance: Math.round(balance * 100) / 100, items: occurrences };
  });
}
