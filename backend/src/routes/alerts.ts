import { FastifyInstance } from "fastify";
import { getTransactionLoadIssues, loadAllTransactions } from "../services/transactionService.js";
import { loadBudgets } from "../services/settingsService.js";

export interface SystemAlert {
  id: string;
  level: "error" | "warn" | "info";
  category: string;
  message: string;
  count?: number;
}

export async function alertsRoutes(app: FastifyInstance) {
  /** GET /api/alerts — liste toutes les alertes actives */
  app.get("/", async (_req, reply) => {
    const alerts: SystemAlert[] = [];
    const transactions = await loadAllTransactions();
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
    const unjustified = validTxns.filter((t) => t.justified === false);
    if (unjustified.length > 0) {
      alerts.push({
        id: "unjustified",
        level: "warn",
        category: "Justificatifs",
        message: `${unjustified.length} transaction${unjustified.length > 1 ? "s" : ""} sans justificatif`,
        count: unjustified.length,
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
      });
    }

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
      });
    }

    return reply.send({ alerts, count: alerts.length });
  });
}
