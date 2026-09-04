import type { Transaction } from "../types";

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s/g, "").replace(",", ".");
}

export function matchesTransactionSearch(transaction: Transaction, query: string): boolean {
  const search = normalize(query);
  if (!search) return true;
  const text = normalize(`${transaction.label} ${transaction.category} ${transaction.notes ?? ""} ${transaction.invoiceRef ?? ""}`);
  if (text.includes(search)) return true;
  const signed = transaction.amount_ttc.toFixed(2);
  const absolute = Math.abs(transaction.amount_ttc).toFixed(2);
  return (search.startsWith("-") || search.startsWith("+")) ? signed.includes(search) : absolute.includes(search);
}
