import type { ManualRecurring, Transaction } from "../../types";
import { addCalendarMonths, scenarioAmount } from "../Recurring/recurringModel";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export interface RunwayMonth {
  month: string;
  expenses: number;
  expectedRevenue: number;
  realisticBalance: number;
  zeroRevenueBalance: number;
  items: Array<{ id: string; label: string; amount: number }>;
}

export interface CashRunwayProjection {
  months: RunwayMonth[];
  averageRevenue: number;
  totalCommittedExpenses: number;
  investmentCapacity: number;
  zeroRevenueRunwayMonths: number | null;
}

function averageRecentRevenue(transactions: Transaction[], today: string): number {
  const start = addCalendarMonths(`${today.slice(0, 7)}-01`, -3);
  const months = [0, 1, 2].map((offset) => addCalendarMonths(start, offset).slice(0, 7));
  const byMonth = new Map(months.map((month) => [month, 0]));
  for (const transaction of transactions) {
    if (transaction.status === "rejected" || transaction.amount_ttc <= 0 || transaction.date < start || transaction.date > today) continue;
    const month = transaction.date.slice(0, 7);
    if (!byMonth.has(month)) continue;
    byMonth.set(month, (byMonth.get(month) ?? 0) + transaction.amount_ttc);
  }
  return round2([...byMonth.values()].reduce((sum, value) => sum + value, 0) / 3);
}

export function buildCashRunwayProjection(options: {
  recurring: ManualRecurring[];
  transactions: Transaction[];
  startBalance: number;
  monthsAhead: number;
  investment: number;
  safetyReserve: number;
  today?: string;
}): CashRunwayProjection {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const averageRevenue = averageRecentRevenue(options.transactions, today);
  let realisticBalance = options.startBalance - Math.max(0, options.investment);
  let zeroRevenueBalance = realisticBalance;
  const months: RunwayMonth[] = [];
  for (let index = 0; index < options.monthsAhead; index += 1) {
    const month = addCalendarMonths(`${today.slice(0, 7)}-01`, index).slice(0, 7);
    const items: RunwayMonth["items"] = [];
    for (const recurring of options.recurring) {
      const amount = scenarioAmount(recurring);
      if (!recurring.active || amount <= 0) continue;
      const step = recurring.frequency === "mensuel" ? 1 : recurring.frequency === "trimestriel" ? 3 : 12;
      let cursor = recurring.nextPayment;
      let safety = 0;
      while (cursor.slice(0, 7) < month && safety++ < 120) cursor = addCalendarMonths(cursor, step);
      if (cursor.slice(0, 7) === month) items.push({ id: recurring.id, label: recurring.label, amount });
    }
    const expenses = round2(items.reduce((sum, item) => sum + item.amount, 0));
    realisticBalance = round2(realisticBalance + averageRevenue - expenses);
    zeroRevenueBalance = round2(zeroRevenueBalance - expenses);
    months.push({ month, expenses, expectedRevenue: averageRevenue, realisticBalance, zeroRevenueBalance, items });
  }
  const totalCommittedExpenses = round2(months.reduce((sum, month) => sum + month.expenses, 0));
  const investmentCapacity = round2(Math.max(0, options.startBalance - totalCommittedExpenses - Math.max(0, options.safetyReserve)));
  const failureIndex = months.findIndex((month) => month.zeroRevenueBalance < options.safetyReserve);
  return { months, averageRevenue, totalCommittedExpenses, investmentCapacity, zeroRevenueRunwayMonths: failureIndex < 0 ? null : failureIndex };
}
