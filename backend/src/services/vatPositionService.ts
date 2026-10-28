import type { Transaction } from "../types/index.js";
import type { CompanyProfile } from "./settingsService.js";
import { loadCategoryCatalog, transactionAccountingNature } from "./categoryCatalogService.js";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export interface VatPosition {
  collected: number;
  deductible: number;
  payments: number;
  netLiability: number;
  reserve: number;
  nextDue?: { period: string; label: string; estimatedAmount: number; provisional: boolean };
}

export function isVatPayment(transaction: Transaction): boolean {
  if (transaction.amount_ttc >= 0) return false;
  if (transaction.category === "vat_advance_payment" || transaction.category === "vat_balance_payment") return true;
  if (transaction.accounting_splits?.some((split) => split.category === "vat_advance_payment" || split.category === "vat_balance_payment")) return true;
  if (transaction.tags?.some((tag) => tag.toLowerCase() === "vat_payment")) return true;
  return /\b(tva|ca\s*3|ca\s*12|3514|3310)\b/i.test(transaction.label);
}

export function vatPaymentAmount(transaction: Transaction): number {
  const vatSplits = transaction.accounting_splits?.filter((split) => split.category === "vat_advance_payment" || split.category === "vat_balance_payment");
  if (vatSplits?.length) return round2(vatSplits.reduce((sum, split) => sum + Math.abs(split.amount), 0));
  return isVatPayment(transaction) ? Math.abs(transaction.amount_ttc) : 0;
}

export function vatAdvanceAmount(transaction: Transaction): number {
  if (transaction.amount_ttc >= 0) return 0;
  const splits = transaction.accounting_splits?.filter((split) => split.category === "vat_advance_payment");
  if (splits?.length) return round2(splits.reduce((sum, split) => sum + Math.abs(split.amount), 0));
  return transaction.category === "vat_advance_payment" ? Math.abs(transaction.amount_ttc) : 0;
}

export function computeVatDeclaration(transactions: Transaction[], startDate: string, endDate: string) {
  const valid = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date >= startDate && transaction.date <= endDate);
  const revenue = valid.filter((transaction) => transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment) === "revenue");
  const reverseChargeVat = round2(valid.reduce((sum, transaction) => transaction.vatTreatment === "reverse_charge_purchase" ? sum + Math.abs(transaction.amount_ht) * Math.max(0, Number(transaction.vat_rate) || 20) / 100 : sum, 0));
  const collected = round2(revenue.reduce((sum, transaction) => sum + Math.abs(transaction.vat), 0) + reverseChargeVat);
  const deductibleFromPurchases = round2(valid.reduce((sum, transaction) => {
    const nature = transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment);
    if (nature === "expense" && !isVatPayment(transaction)) return sum + Math.abs(transaction.vat);
    if (nature === "expense_refund") return sum - Math.abs(transaction.vat);
    return sum;
  }, 0));
  const deductible = round2(deductibleFromPurchases + reverseChargeVat);
  const accountByCategory = new Map(loadCategoryCatalog().map((category) => [category.id, category.account.number]));
  const deductibleFixedAssets = round2(valid.reduce((sum, transaction) => {
    const nature = transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment);
    return nature === "expense" && !isVatPayment(transaction) && accountByCategory.get(transaction.category)?.startsWith("2") ? sum + Math.abs(transaction.vat) : sum;
  }, 0));
  const deductibleOther = round2(deductibleFromPurchases - deductibleFixedAssets + reverseChargeVat);
  const rateRows = new Map<number, { rate: number; base: number; tax: number }>();
  for (const transaction of revenue) {
    if (transaction.vatTreatment === "exempt" || transaction.vatTreatment === "outside_scope" || Math.abs(transaction.vat) < 0.005) continue;
    if (transaction.vat_splits?.length) {
      for (const split of transaction.vat_splits) {
        if (split.rate <= 0) continue;
        const row = rateRows.get(split.rate) ?? { rate: split.rate, base: 0, tax: 0 };
        const base = Math.abs(split.amount_ttc) / (1 + split.rate / 100);
        row.base += base; row.tax += Math.abs(split.amount_ttc) - base; rateRows.set(split.rate, row);
      }
    } else {
      const rate = Math.max(0, Number(transaction.vat_rate) || (Math.abs(transaction.amount_ht) ? Math.abs(transaction.vat / transaction.amount_ht) * 100 : 0));
      if (rate <= 0) continue;
      const row = rateRows.get(rate) ?? { rate, base: 0, tax: 0 };
      row.base += Math.abs(transaction.amount_ht); row.tax += Math.abs(transaction.vat); rateRows.set(rate, row);
    }
  }
  const taxableByRate = [...rateRows.values()].map((row) => ({ rate: round2(row.rate), base: round2(row.base), tax: round2(row.tax) })).sort((a, b) => b.rate - a.rate);
  const revenueToReview = revenue.filter((transaction) => Math.abs(transaction.amount_ttc) >= 0.005 && Math.abs(transaction.vat) < 0.005 && !["exempt", "outside_scope"].includes(transaction.vatTreatment ?? ""));
  const excludedRevenue = revenue.filter((transaction) => ["exempt", "outside_scope"].includes(transaction.vatTreatment ?? ""));
  const advances = round2(valid.reduce((sum, transaction) => sum + vatAdvanceAmount(transaction), 0));
  const balancePayments = round2(valid.reduce((sum, transaction) => sum + (transaction.category === "vat_balance_payment" ? vatPaymentAmount(transaction) : 0), 0));
  const netBeforeAdvances = round2(collected - deductible);
  return {
    collected, deductible, deductibleOther, deductibleFixedAssets, reverseChargeVat, advances, balancePayments,
    taxableByRate,
    revenueToReview: { count: revenueToReview.length, amount: round2(revenueToReview.reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0)), transactionIds: revenueToReview.map((transaction) => transaction.id) },
    excludedRevenue: { count: excludedRevenue.length, amount: round2(excludedRevenue.reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0)) },
    netBeforeAdvances, netAfterAdvances: round2(netBeforeAdvances - advances),
  };
}

function simplifiedNextDue(profile: CompanyProfile, now: Date) {
  const year = now.getFullYear();
  const reference = Math.max(0, Number(profile.vatReferenceAmount) || 0);
  const month = now.getMonth() + 1;
  if (month <= 7) return { period: `${year}-07`, label: "Acompte simplifié de juillet (55 % de N-1)", estimatedAmount: round2(reference * 0.55), provisional: true };
  if (month <= 12) return { period: `${year}-12`, label: "Acompte simplifié de décembre (40 % de N-1)", estimatedAmount: round2(reference * 0.4), provisional: true };
  return undefined;
}

export function computeVatPosition(transactions: Transaction[], profile: CompanyProfile, now = new Date()): VatPosition {
  const year = String(now.getFullYear());
  const valid = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date.startsWith(year));
  const collected = round2(valid.filter((transaction) => transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment) === "revenue").reduce((sum, transaction) => sum + Math.abs(transaction.vat), 0));
  const deductible = round2(valid.reduce((sum, transaction) => {
    const nature = transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment);
    if (nature === "expense" && !isVatPayment(transaction)) return sum + Math.abs(transaction.vat);
    if (nature === "expense_refund") return sum - Math.abs(transaction.vat);
    return sum;
  }, 0));
  const payments = round2(valid.reduce((sum, transaction) => sum + vatPaymentAmount(transaction), 0));
  const opening = Number.isFinite(profile.vatOpeningBalance) ? Math.max(0, Number(profile.vatOpeningBalance)) : 0;
  const netLiability = round2(Math.max(0, opening + collected - deductible - payments));
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const nextDue = profile.vatRegime === "simplified_ca12" ? simplifiedNextDue(profile, now) : profile.vatRegime === "monthly_ca3"
    ? { period: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}`, label: "Prochaine déclaration CA3 mensuelle", estimatedAmount: netLiability, provisional: true }
    : profile.vatRegime === "quarterly_ca3"
      ? { period: `T${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`, label: "Prochaine déclaration CA3 trimestrielle", estimatedAmount: netLiability, provisional: true }
      : undefined;
  const scheduledReserve = profile.vatRegime === "simplified_ca12" ? nextDue?.estimatedAmount ?? 0 : 0;
  return { collected, deductible, payments, netLiability, reserve: round2(Math.max(netLiability, scheduledReserve)), nextDue };
}
