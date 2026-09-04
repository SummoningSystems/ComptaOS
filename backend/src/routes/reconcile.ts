import { FastifyInstance } from "fastify";
import { loadAllTransactions, updateTransaction } from "../services/transactionService.js";
import { autoCommit } from "../services/gitService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { getReconciliationIssues, isReadyForValidationAndReconciliation } from "../services/reconciliationService.js";

export async function reconcileRoutes(app: FastifyInstance) {
  /** GET /api/reconcile — liste les transactions non réconciliées */
  app.get<{ Querystring: { month?: string } }>("/", async (req, reply) => {
    const { month } = req.query;
    const all = await loadAllTransactions();
    const filtered = all.filter((t) => {
      if (t.status === "rejected") return false;
      if (month && !t.date.startsWith(month)) return false;
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date));

    const reconciled = filtered.filter((t) => t.reconciled).length;
    const total = filtered.length;

    return reply.send({
      transactions: filtered.map((transaction) => ({
        ...transaction,
        reconciliation_issues: getReconciliationIssues(transaction),
      })),
      reconciled,
      total,
      pending: total - reconciled,
    });
  });

  /** PATCH /api/reconcile/:id — toggle réconciliation d'une transaction */
  app.patch<{ Params: { id: string }; Body: { reconciled: boolean } }>("/:id", async (req, reply) => {
    const { reconciled } = req.body;
    if (reconciled) {
      const transaction = (await loadAllTransactions()).find((item) => item.id === req.params.id);
      if (!transaction) return reply.status(404).send({ error: "Transaction introuvable" });
      const issues = getReconciliationIssues(transaction);
      if (issues.length > 0) {
        return reply.status(409).send({ error: "Transaction à compléter avant rapprochement", issues });
      }
    }
    const updated = await updateTransaction(req.params.id, { reconciled });
    autoCommit(getWorkspaceRoot(), `rapprochement: ${req.params.id} ${reconciled ? "✓" : "annulé"}`).catch(() => {});
    return reply.send(updated);
  });

  /** POST /api/reconcile/bulk — réconciliation en masse */
  app.post<{ Body: { ids: string[]; reconciled: boolean } }>("/bulk", async (req, reply) => {
    const { ids, reconciled } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids requis" });
    }
    if (reconciled) {
      const transactions = await loadAllTransactions();
      const blocked = ids.flatMap((id) => {
        const transaction = transactions.find((item) => item.id === id);
        const issues = transaction ? getReconciliationIssues(transaction) : ["introuvable"];
        return issues.length > 0 ? [{ id, issues }] : [];
      });
      if (blocked.length > 0) {
        return reply.status(409).send({ error: "Certaines transactions sont à compléter", blocked });
      }
    }
    const results = await Promise.all(ids.map((id) => updateTransaction(id, { reconciled })));
    autoCommit(getWorkspaceRoot(), `rapprochement: ${ids.length} transaction(s) ${reconciled ? "validées" : "annulées"}`).catch(() => {});
    return reply.send({ updated: results.length });
  });

  app.post<{ Body: { month: string } }>("/ready", async (req, reply) => {
    const month = req.body?.month;
    if (!/^\d{4}-\d{2}$/.test(month ?? "")) return reply.status(400).send({ error: "Mois invalide" });
    const ready = (await loadAllTransactions()).filter((transaction) => transaction.date.startsWith(month) && !transaction.reconciled && isReadyForValidationAndReconciliation(transaction));
    const results = await Promise.all(ready.map((transaction) => updateTransaction(transaction.id, { status: "validated", reconciled: true })));
    if (results.length) autoCommit(getWorkspaceRoot(), `rapprochement: ${results.length} opération(s) prête(s) validée(s)`).catch(() => {});
    return reply.send({ updated: results.length });
  });
}
