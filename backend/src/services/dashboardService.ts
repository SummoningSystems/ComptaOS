import { loadAllTransactions } from "./transactionService.js";
import { loadManualRecurring } from "./manualRecurringService.js";
import { DashboardData } from "../types/index.js";
import { getConnections } from "./bankingService.js";
import { needsTransactionEvidence } from "./transactionEvidenceService.js";
import { loadCompanyProfile } from "./settingsService.js";
import { computeVatPosition } from "./vatPositionService.js";

function addMonths(isoDate: string, count: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + count, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

function recurringScenarioAmount(item: ReturnType<typeof loadManualRecurring>[number]): number {
  if (!item.active || item.decision === "cancel") return 0;
  if (item.decision === "reduce" && typeof item.simulatedAmount === "number") return Math.max(0, item.simulatedAmount);
  return item.amount;
}

export function buildDashboardForecast(
  recurring: ReturnType<typeof loadManualRecurring>,
  transactions: Awaited<ReturnType<typeof loadAllTransactions>>,
  startBalance: number,
  today = new Date().toISOString().slice(0, 10),
  monthsAhead = 24,
) {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const recentMonths = [3, 2, 1].map((offset) => addMonths(currentMonth, -offset).slice(0, 7));
  const revenueByMonth = new Map(recentMonths.map((month) => [month, 0]));
  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (transaction.status !== "rejected" && transaction.amount_ttc > 0 && revenueByMonth.has(month)) {
      revenueByMonth.set(month, (revenueByMonth.get(month) ?? 0) + transaction.amount_ttc);
    }
  }
  const averageRevenue = [...revenueByMonth.values()].reduce((sum, amount) => sum + amount, 0) / 3;
  let balance = startBalance;
  let zeroRevenueBalance = startBalance;

  return Array.from({ length: monthsAhead }, (_, index) => {
    const month = addMonths(currentMonth, index + 1).slice(0, 7);
    const items: { id: string; label: string; amount: number }[] = [];
    for (const item of recurring) {
      const amount = recurringScenarioAmount(item);
      if (amount <= 0) continue;
      const step = item.frequency === "mensuel" ? 1 : item.frequency === "trimestriel" ? 3 : 12;
      let dueDate = item.nextPayment;
      let safety = 0;
      while (dueDate.slice(0, 7) < month && safety++ < 120) dueDate = addMonths(dueDate, step);
      if (dueDate.slice(0, 7) === month) items.push({ id: item.id, label: item.label, amount });
    }
    const expenses = items.reduce((sum, item) => sum + item.amount, 0);
    balance += averageRevenue - expenses;
    zeroRevenueBalance -= expenses;
    return { month, balance: parseFloat(balance.toFixed(2)), zeroRevenueBalance: parseFloat(zeroRevenueBalance.toFixed(2)), expenses: parseFloat(expenses.toFixed(2)), revenue: parseFloat(averageRevenue.toFixed(2)), projected: true, items };
  });
}

/** Construit les données agrégées pour le dashboard. */
export async function computeDashboard(requestedYear?: string): Promise<DashboardData> {
  let recurring: ReturnType<typeof loadManualRecurring> = [];
  try { recurring = loadManualRecurring(); } catch { /* ignore */ }
  const [transactions, connections] = await Promise.all([
    loadAllTransactions(),
    getConnections().catch(() => []),
  ]);
  const availableYears = Array.from(new Set(transactions
    .filter((transaction) => transaction.status !== "rejected")
    .map((transaction) => transaction.date.slice(0, 4))))
    .filter((year) => /^\d{4}$/.test(year))
    .sort((a, b) => b.localeCompare(a));
  const currentYear = requestedYear ?? availableYears[0] ?? new Date().getFullYear().toString();

  const monthlyMap: Record<string, { revenue: number; expenses: number }> = {};
  const categoryMap: Record<string, number> = {};
  const accountSet = new Set<string>();
  let vatEstimate = 0;
  let transactionFlow = 0;
  let accountingRevenue = 0;
  let accountingExpenses = 0;

  for (const txn of transactions) {
    if (txn.status === "rejected") continue;
    transactionFlow += txn.amount_ttc;
    if (txn.account) accountSet.add(txn.account);
    if (!txn.date.startsWith(currentYear)) continue;
    const month = txn.date.slice(0, 7); // YYYY-MM
    if (!monthlyMap[month]) monthlyMap[month] = { revenue: 0, expenses: 0 };

    if (txn.amount_ttc >= 0) {
      monthlyMap[month].revenue += txn.amount_ttc;
      accountingRevenue += txn.amount_ht;
    } else {
      monthlyMap[month].expenses += Math.abs(txn.amount_ttc);
      accountingExpenses += Math.abs(txn.amount_ht);
    }

    if (txn.amount_ttc < 0) {
      categoryMap[txn.category] = (categoryMap[txn.category] ?? 0) + Math.abs(txn.amount_ttc);
      vatEstimate -= txn.vat;
    } else {
      vatEstimate += txn.vat;
    }

  }

  const months = Object.keys(monthlyMap).sort();
  const totalRevenue  = months.reduce((s, m) => s + monthlyMap[m].revenue,  0);
  const totalExpenses = months.reduce((s, m) => s + monthlyMap[m].expenses, 0);
  const netResult = accountingRevenue - accountingExpenses;
  const isEstimate = netResult > 0 ? netResult * 0.25 : 0;

  // Runway : trésorerie / moyenne dépenses 3 derniers mois
  const bankAccounts = connections.flatMap((connection) => connection.accounts)
    .filter((account): account is typeof account & { balance: number } =>
      typeof account.balance === "number" && Number.isFinite(account.balance)
    )
    .map((account) => ({
      id: String(account.id),
      name: account.name ?? `Compte ${account.id}`,
      currency: account.currency ?? "EUR",
      balance: parseFloat(account.balance.toFixed(2)),
      updated_at: account.balanceUpdatedAt,
    }));
  const bankBalance = bankAccounts.length > 0
    ? bankAccounts.reduce((sum, account) => sum + account.balance, 0)
    : undefined;
  const treasury = bankBalance ?? transactionFlow;
  const companyProfile = loadCompanyProfile();
  const vatPosition = computeVatPosition(transactions, companyProfile);
  const spendableCash = treasury - vatPosition.reserve;
  const bankBalanceUpdatedAt = bankAccounts
    .map((account) => account.updated_at)
    .filter((date): date is string => !!date)
    .sort()
    .at(-1);

  const recentMonths = months.slice(-3);
  const avgMonthlyExpenses = recentMonths.length > 0
    ? recentMonths.reduce((s, m) => s + monthlyMap[m].expenses, 0) / recentMonths.length
    : 0;
  const runwayMonths = avgMonthlyExpenses > 0
    ? parseFloat((spendableCash / avgMonthlyExpenses).toFixed(1))
    : 999;

  const miscCount = transactions.filter(
    (t) => t.date.startsWith(currentYear) && t.category === "misc" && t.status !== "rejected"
  ).length;
  const unjustifiedCount = transactions.filter(
    (t) => t.date.startsWith(currentYear) && needsTransactionEvidence(t)
  ).length;

  // ── Solde cumulé par mois ──────────────────────────────────────────────────
  const yearFlow = totalRevenue - totalExpenses;
  let cumulative = treasury - yearFlow;
  const monthly_balance = months.map((m) => {
    cumulative += monthlyMap[m].revenue - monthlyMap[m].expenses;
    return { month: m, amount: parseFloat(cumulative.toFixed(2)) };
  });

  // ── Prévisions 6 mois à partir des frais récurrents + moyenne revenus ─────
  const forecast = buildDashboardForecast(recurring, transactions, spendableCash);

  return {
    monthly_revenue:  months.map((m) => ({ month: m, amount: parseFloat(monthlyMap[m].revenue.toFixed(2)) })),
    monthly_expenses: months.map((m) => ({ month: m, amount: parseFloat(monthlyMap[m].expenses.toFixed(2)) })),
    vat_estimate:     parseFloat(vatEstimate.toFixed(2)),
    vat_collected: vatPosition.collected,
    vat_deductible: vatPosition.deductible,
    vat_payments: vatPosition.payments,
    vat_reserve: vatPosition.reserve,
    spendable_cash: parseFloat(spendableCash.toFixed(2)),
    vat_regime: companyProfile.vatRegime,
    next_vat_due: vatPosition.nextDue ? { period: vatPosition.nextDue.period, label: vatPosition.nextDue.label, estimated_amount: vatPosition.nextDue.estimatedAmount, provisional: vatPosition.nextDue.provisional } : undefined,
    treasury:         parseFloat(treasury.toFixed(2)),
    transaction_flow: parseFloat(transactionFlow.toFixed(2)),
    bank_balance: bankBalance === undefined ? undefined : parseFloat(bankBalance.toFixed(2)),
    bank_balance_updated_at: bankBalanceUpdatedAt,
    balance_difference: bankBalance === undefined ? undefined : parseFloat((bankBalance - transactionFlow).toFixed(2)),
    bank_accounts: bankAccounts,
    accounting_result: parseFloat(netResult.toFixed(2)),
    accounting_revenue: parseFloat(accountingRevenue.toFixed(2)),
    accounting_expenses: parseFloat(accountingExpenses.toFixed(2)),
    available_years: availableYears,
    top_categories:   Object.entries(categoryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, amount]) => ({ category, amount: parseFloat(amount.toFixed(2)) })),
    net_result:        parseFloat(netResult.toFixed(2)),
    is_estimate:       parseFloat(isEstimate.toFixed(2)),
    runway_months:     runwayMonths,
    misc_count:        miscCount,
    unjustified_count: unjustifiedCount,
    current_year:      currentYear,
    monthly_balance,
    forecast,
    accounts:          Array.from(accountSet).sort(),
  };
}
