import type { Transaction } from "../types/index.js";
import type { CompanyProfile } from "./settingsService.js";

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
  if (transaction.tags?.some((tag) => tag.toLowerCase() === "vat_payment")) return true;
  return /\b(tva|ca\s*3|ca\s*12|3514|3310)\b/i.test(transaction.label);
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
  const collected = round2(valid.filter((transaction) => transaction.amount_ttc > 0).reduce((sum, transaction) => sum + Math.abs(transaction.vat), 0));
  const deductible = round2(valid.filter((transaction) => transaction.amount_ttc < 0 && !isVatPayment(transaction)).reduce((sum, transaction) => sum + Math.abs(transaction.vat), 0));
  const payments = round2(valid.filter(isVatPayment).reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0));
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
