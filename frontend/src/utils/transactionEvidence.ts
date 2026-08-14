import type { Transaction } from "../types";

export function hasTransactionEvidence(transaction: Transaction): boolean {
  const attachments = new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])].filter(Boolean));
  return transaction.justified === true || attachments.size > 0 || Boolean(transaction.invoiceRef?.trim());
}

export function needsTransactionEvidence(transaction: Transaction): boolean {
  return transaction.status !== "rejected" && transaction.amount_ttc < 0 && !hasTransactionEvidence(transaction);
}
