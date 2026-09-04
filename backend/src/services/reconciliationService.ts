import type { Transaction } from "../types/index.js";
import { needsTransactionEvidence } from "./transactionEvidenceService.js";

export type ReconciliationIssue = "status" | "category" | "justification";

export function getReconciliationIssues(transaction: Transaction): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  if (transaction.status !== "validated") issues.push("status");
  if (transaction.category === "misc") issues.push("category");
  if (needsTransactionEvidence(transaction)) issues.push("justification");
  return issues;
}

export function isPsd2Transaction(transaction: Transaction): boolean {
  return transaction.id.startsWith("bank_powens_")
    || Boolean(transaction.tags?.includes("bank_import") && transaction.notes?.toLowerCase().includes("psd2"));
}

export function isReadyForValidationAndReconciliation(transaction: Transaction): boolean {
  return transaction.status !== "rejected" && transaction.category !== "misc" && !needsTransactionEvidence(transaction);
}

export function shouldAutoReconcilePsd2(transaction: Transaction): boolean {
  return isPsd2Transaction(transaction) && getReconciliationIssues(transaction).length === 0;
}
