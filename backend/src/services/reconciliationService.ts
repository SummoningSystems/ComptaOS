import type { Transaction } from "../types/index.js";

export type ReconciliationIssue = "status" | "category" | "justification";

export function getReconciliationIssues(transaction: Transaction): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  if (transaction.status !== "validated") issues.push("status");
  if (transaction.category === "misc") issues.push("category");
  if (
    transaction.amount_ttc < 0 &&
    !transaction.justified &&
    !transaction.attachment &&
    !transaction.invoiceRef
  ) {
    issues.push("justification");
  }
  return issues;
}
