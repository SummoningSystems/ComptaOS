import { FastifyInstance } from "fastify";
import { getTransactionLoadIssues, loadAllTransactions } from "../services/transactionService.js";
import { loadBudgets } from "../services/settingsService.js";
import { loadPendingReceipts } from "../services/receiptInboxService.js";
import { needsTransactionEvidence } from "../services/transactionEvidenceService.js";

export interface SystemAlert {
  id: string;
  level: "error" | "warn" | "info";
  category: string;
  message: string;
  count?: number;
  action?: { label: string; tab: "transactions" | "reconcile" | "vat" | "treasury" | "budgets" | "export"; filter?: "unjustified" | "misc" | "duplicates" | "receipt-inbox" };
}

export async function alertsRoutes(app: FastifyInstance) {
  /** GET /api/alerts — liste toutes les alertes actives */
  app.get("/", async (_req, reply) => {
    const alerts: SystemAlert[] = [];
    const [transactions, pendingReceipts] = await Promise.all([loadAllTransactions(), loadPendingReceipts()]);
    const loadIssues = getTransactionLoadIssues();
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    const validTxns = transactions.filter((t) => t.status !== "rejected");

    if (loadIssues.length > 0) {
      alerts.push({
        id: "transaction_files_invalid",
        level: "error",
        category: "Intégrité des données",
        message: `${loadIssues.length} fichier${loadIssues.length > 1 ? "s" : ""} de transaction illisible${loadIssues.length > 1 ? "s" : ""}. Consultez les logs avant de poursuivre.`,
        count: loadIssues.length,
      });
    }

    // 1. Transactions non justifiées
    const unjustified = validTxns.filter(needsTransactionEvidence);
    if (unjustified.length > 0) {
      alerts.push({
        id: "unjustified",
        level: "warn",
        category: "Justificatifs",
        message: `${unjustified.length} transaction${unjustified.length > 1 ? "s" : ""} sans justificatif`,
        count: unjustified.length,
        action: { label: "Ajouter les justificatifs", tab: "transactions", filter: "unjustified" },
      });
    }

    // 2. Transactions non catégorisées
    const uncategorized = validTxns.filter((t) => t.category === "misc");
    if (uncategorized.length > 0) {
      alerts.push({
        id: "uncategorized",
        level: "info",
        category: "Catégorisation",
        message: `${uncategorized.length} transaction${uncategorized.length > 1 ? "s" : ""} en catégorie "misc" — utilisez Smart Catégoriser`,
        count: uncategorized.length,
        action: { label: "Catégoriser", tab: "transactions", filter: "misc" },
      });
    }

    if (pendingReceipts.length > 0) {
      alerts.push({ id: "pending_receipts", level: "warn", category: "Justificatifs", message: `${pendingReceipts.length} justificatif${pendingReceipts.length > 1 ? "s" : ""} en attente de rapprochement`, count: pendingReceipts.length, action: { label: "Rapprocher", tab: "transactions", filter: "receipt-inbox" } });
      const ocrFailures = pendingReceipts.filter((receipt) => receipt.ocr.status !== "success");
      if (ocrFailures.length > 0) alerts.push({ id: "ocr_review", level: "warn", category: "OCR", message: `${ocrFailures.length} justificatif${ocrFailures.length > 1 ? "s" : ""} à relire ou saisir manuellement`, count: ocrFailures.length, action: { label: "Vérifier", tab: "transactions" } });
    }

    const vatMissing = validTxns.filter((transaction) => transaction.amount_ttc < 0 && transaction.vat === 0 && transaction.category !== "salary" && transaction.category !== "taxes");
    if (vatMissing.length > 0) alerts.push({ id: "vat_missing", level: "warn", category: "TVA", message: `${vatMissing.length} dépense${vatMissing.length > 1 ? "s" : ""} sans TVA renseignée`, count: vatMissing.length, action: { label: "Contrôler la TVA", tab: "vat" } });

    const duplicateKeys = new Map<string, number>();
    for (const transaction of validTxns) {
      const key = `${transaction.date}|${transaction.label.trim().toLowerCase()}|${transaction.amount_ttc.toFixed(2)}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
    }
    const duplicateCount = Array.from(duplicateKeys.values()).filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
    if (duplicateCount > 0) alerts.push({ id: "duplicates", level: "error", category: "Doublons", message: `${duplicateCount} transactions potentiellement en doublon`, count: duplicateCount, action: { label: "Examiner", tab: "transactions", filter: "duplicates" } });

    // 3. Budgets dépassés ce mois-ci
    const budgets = await Promise.resolve(loadBudgets()).catch(() => [] as { category: string; monthlyLimit: number }[]);
    const thisMonthExpenses: Record<string, number> = {};
    for (const t of validTxns.filter((t) => t.date.startsWith(currentMonth) && t.amount_ttc < 0)) {
      thisMonthExpenses[t.category] = (thisMonthExpenses[t.category] ?? 0) + Math.abs(t.amount_ttc);
    }
    for (const budget of budgets) {
      const spent = thisMonthExpenses[budget.category] ?? 0;
      if (spent > budget.monthlyLimit) {
        alerts.push({
          id: `budget_${budget.category}`,
          level: "error",
          category: "Budgets",
          message: `Budget "${budget.category}" dépassé ce mois : ${spent.toFixed(2)} € / ${budget.monthlyLimit.toFixed(2)} € limite`,
        });
      } else if (spent > budget.monthlyLimit * 0.8) {
        alerts.push({
          id: `budget_warn_${budget.category}`,
          level: "warn",
          category: "Budgets",
          message: `Budget "${budget.category}" à ${Math.round((spent / budget.monthlyLimit) * 100)}% ce mois (${spent.toFixed(2)} € / ${budget.monthlyLimit.toFixed(2)} €)`,
        });
      }
    }

    // 4. Trésorerie négative ou faible
    const treasury = validTxns.reduce((s, t) => s + t.amount_ttc, 0);
    const recentMonths = [...new Set(validTxns.map((t) => t.date.slice(0, 7)))].sort().slice(-3);
    const avgExp = recentMonths.length > 0
      ? recentMonths.reduce((s, m) => s + validTxns.filter((t) => t.date.startsWith(m) && t.amount_ttc < 0).reduce((a, t) => a + Math.abs(t.amount_ttc), 0), 0) / recentMonths.length
      : 0;
    const runway = avgExp > 0 ? treasury / avgExp : 999;

    if (treasury < 0) {
      alerts.push({ id: "treasury_negative", level: "error", category: "Trésorerie", message: `Trésorerie négative : ${treasury.toFixed(2)} €` });
    } else if (runway < 2 && runway < 999) {
      alerts.push({ id: "treasury_low", level: "error", category: "Trésorerie", message: `Runway critique : ${runway.toFixed(1)} mois de trésorerie` });
    } else if (runway < 4 && runway < 999) {
      alerts.push({ id: "treasury_warn", level: "warn", category: "Trésorerie", message: `Runway faible : ${runway.toFixed(1)} mois de trésorerie` });
    }

    // 5. TVA à reverser importante
    const vatDue = validTxns.reduce((s, t) => {
      if (t.amount_ttc > 0) return s + t.vat;
      return s - t.vat;
    }, 0);
    if (vatDue > 1000) {
      alerts.push({ id: "vat_due", level: "info", category: "TVA", message: `TVA collectée estimée : ${vatDue.toFixed(2)} € — pensez à provisionner` });
    }

    // 6. Transactions non réconciliées
    const unreconciled = validTxns.filter((t) => !t.reconciled);
    if (unreconciled.length > 20) {
      alerts.push({
        id: "unreconciled",
        level: "info",
        category: "Rapprochement",
        message: `${unreconciled.length} transactions non réconciliées avec le relevé bancaire`,
        count: unreconciled.length,
        action: { label: "Rapprocher", tab: "reconcile" },
      });
    }

    return reply.send({ alerts, count: alerts.length });
  });
}
