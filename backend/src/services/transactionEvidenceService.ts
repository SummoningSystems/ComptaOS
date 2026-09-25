import type { Transaction } from "../types/index.js";
import { transactionAccountingNature } from "./categoryCatalogService.js";

export function hasTransactionEvidence(transaction: Transaction): boolean {
  const attachments = new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])].filter(Boolean));
  return transaction.justified === true || !!transaction.documentIds?.length || attachments.size > 0 || Boolean(transaction.invoiceRef?.trim());
}

export function needsTransactionEvidence(transaction: Transaction): boolean {
  const nature = transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment);
  return transaction.status !== "rejected" && ["expense", "expense_refund", "supplier_advance_refund"].includes(nature) && !hasTransactionEvidence(transaction);
}
