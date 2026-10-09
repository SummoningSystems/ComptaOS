const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function customerReceivableAmounts(amountHt: number, vatRate: number) {
  const ht = Math.max(0, Number(amountHt) || 0);
  const rate = Math.max(0, Number(vatRate) || 0);
  const vat = round(ht * rate / 100);
  return { ht: round(ht), vat, ttc: round(ht + vat) };
}

function periodMonths(startDate: string, endDate: string) {
  const [sy, sm, rawStartDay] = startDate.split("-").map(Number);
  const [ey, em, rawEndDay] = endDate.split("-").map(Number);
  const startDay = Math.min(rawStartDay, 30);
  const endDay = Math.min(rawEndDay, 30);
  return Math.max(0, (ey - sy) * 12 + em - sm + (endDay - startDay + 1) / 30);
}

export function depreciationSuggestion(input: {
  grossValue: number;
  usefulLifeYears: number;
  openingAccumulatedDepreciation: number;
  inServiceDate: string;
  periodStart: string;
  periodEnd: string;
}) {
  const grossValue = round(Math.max(0, Number(input.grossValue) || 0));
  const usefulLifeYears = Math.max(0, Number(input.usefulLifeYears) || 0);
  const opening = round(Math.min(grossValue, Math.max(0, Number(input.openingAccumulatedDepreciation) || 0)));
  if (!grossValue || !usefulLifeYears || !input.inServiceDate || input.inServiceDate > input.periodEnd) return { annual: 0, months: 0, amount: 0, closingAccumulated: opening, netBookValue: round(grossValue - opening) };
  const effectiveStart = input.inServiceDate > input.periodStart ? input.inServiceDate : input.periodStart;
  const months = periodMonths(effectiveStart, input.periodEnd);
  const annual = round(grossValue / usefulLifeYears);
  const amount = round(Math.min(grossValue - opening, annual * months / 12));
  return { annual, months: round(months), amount, closingAccumulated: round(opening + amount), netBookValue: round(grossValue - opening - amount) };
}
