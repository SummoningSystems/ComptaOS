import { loadAllTransactions } from "./transactionService.js";
import { loadManualRecurring } from "./manualRecurringService.js";
import { DashboardData } from "../types/index.js";
import { getConnections } from "./bankingService.js";
import { needsTransactionEvidence } from "./transactionEvidenceService.js";
import { loadCompanyProfile } from "./settingsService.js";
import { computeVatPosition } from "./vatPositionService.js";

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
  const avgMonthlyRevenue = recentMonths.length > 0
    ? recentMonths.reduce((s, m) => s + monthlyMap[m].revenue, 0) / recentMonths.length
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
  const forecast: { month: string; balance: number; projected: boolean }[] = [];
  // Reprendre le dernier solde connu
  let forecastBalance = spendableCash;
  const now = new Date();
  // Charges récurrentes mensuelles issues du service
  const monthlyRecurringExpenses = recurring
    .filter((r) => r.active)
    .reduce((sum, r) => {
      const monthly =
        r.frequency === "mensuel" ? r.amount
        : r.frequency === "trimestriel" ? r.amount / 3
        : r.amount / 12;
      return sum + monthly;
    }, 0);

  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    forecastBalance += avgMonthlyRevenue - (monthlyRecurringExpenses || avgMonthlyExpenses);
    forecast.push({ month: key, balance: parseFloat(forecastBalance.toFixed(2)), projected: true });
  }

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
