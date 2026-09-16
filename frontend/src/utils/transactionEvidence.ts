import type { Transaction } from "../types";

export function hasTransactionEvidence(transaction: Transaction): boolean {
  const attachments = new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])].filter(Boolean));
  return transaction.justified === true || attachments.size > 0 || Boolean(transaction.invoiceRef?.trim());
}

export function needsTransactionEvidence(transaction: Transaction): boolean {
  const isSupplierRefund = transaction.amount_ttc > 0 && (transaction.accountingTreatment === "expense_refund" || transaction.accountingTreatment === "supplier_advance_refund" || transaction.category === "supplier_advance_refund");
  return transaction.status !== "rejected" && (transaction.amount_ttc < 0 || isSupplierRefund) && !hasTransactionEvidence(transaction);
}
