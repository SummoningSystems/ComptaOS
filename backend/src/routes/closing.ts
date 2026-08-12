import { FastifyInstance } from "fastify";
import { loadAllTransactions } from "../services/transactionService.js";
import { loadPendingReceipts } from "../services/receiptInboxService.js";
import { getConnections } from "../services/bankingService.js";
import { buildAccountingPreview } from "../services/accountingExportService.js";
import { loadAccountingConfig } from "../services/settingsService.js";

type Step = { id: string; label: string; status: "done" | "warning" | "blocked"; detail: string; count?: number; action?: "banking" | "transactions" | "vat" | "reconcile" | "export" };

export async function closingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { month?: string } }>("/", async (req, reply) => {
    const month = req.query.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply.status(400).send({ error: "Mois invalide" });
    const [transactions, receipts, connections] = await Promise.all([loadAllTransactions(), loadPendingReceipts(), getConnections().catch(() => [])]);
    const active = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date.startsWith(month));
    const expenses = active.filter((transaction) => transaction.amount_ttc < 0);
    const unjustified = expenses.filter((transaction) => transaction.justified === false || (![...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])].length && !transaction.invoiceRef));
    const uncategorized = active.filter((transaction) => transaction.category === "misc");
    const vatMissing = expenses.filter((transaction) => transaction.vat === 0 && !["salary", "taxes"].includes(transaction.category));
    const unreconciled = active.filter((transaction) => transaction.reconciled !== true);
    const unvalidated = active.filter((transaction) => transaction.status !== "validated");
    const lastBankSync = connections.flatMap((connection) => connection.accounts).map((account) => account.lastSyncAt).filter((date): date is string => !!date).sort().at(-1);
    const bankFresh = lastBankSync ? Date.now() - Date.parse(lastBankSync) < 7 * 86_400_000 : false;
    const preview = buildAccountingPreview(transactions, loadAccountingConfig(), month.slice(0, 4));
    const blockers = preview.anomalies.filter((anomaly) => anomaly.severity === "blocking" && (!anomaly.transactionId || active.some((transaction) => transaction.id === anomaly.transactionId)));
    const steps: Step[] = [
      { id: "bank", label: "Banque synchronisée", status: bankFresh ? "done" : "warning", detail: lastBankSync ? `Dernière synchronisation : ${lastBankSync}` : "Aucune synchronisation bancaire trouvée", action: "banking" },
      { id: "receipts", label: "Justificatifs présents", status: unjustified.length === 0 && receipts.length === 0 ? "done" : "blocked", detail: unjustified.length ? `${unjustified.length} dépense(s) du mois à justifier` : receipts.length ? `${receipts.length} pièce(s) encore en attente` : "Toutes les dépenses sont documentées", count: unjustified.length + receipts.length, action: "transactions" },
      { id: "categories", label: "Catégorisation terminée", status: uncategorized.length === 0 ? "done" : "blocked", detail: uncategorized.length ? `${uncategorized.length} opération(s) en catégorie misc` : "Toutes les opérations sont catégorisées", count: uncategorized.length, action: "transactions" },
      { id: "vat", label: "TVA contrôlée", status: vatMissing.length === 0 ? "done" : "warning", detail: vatMissing.length ? `${vatMissing.length} dépense(s) sans TVA` : "Aucune TVA manquante détectée", count: vatMissing.length, action: "vat" },
      { id: "validation", label: "Opérations validées", status: unvalidated.length === 0 ? "done" : "blocked", detail: unvalidated.length ? `${unvalidated.length} opération(s) encore pending` : "Toutes les opérations sont validées", count: unvalidated.length, action: "transactions" },
      { id: "reconcile", label: "Rapprochement terminé", status: unreconciled.length === 0 ? "done" : "blocked", detail: unreconciled.length ? `${unreconciled.length} opération(s) non rapprochée(s)` : "Toutes les opérations sont rapprochées", count: unreconciled.length, action: "reconcile" },
      { id: "export", label: "Dossier comptable exportable", status: blockers.length === 0 && unvalidated.length === 0 && unreconciled.length === 0 ? "done" : "blocked", detail: blockers.length ? `${blockers.length} anomalie(s) comptable(s) bloquante(s)` : "Le dossier expert-comptable peut être généré", count: blockers.length, action: "export" },
    ];
    return reply.send({ month, transactionCount: active.length, completed: steps.filter((step) => step.status === "done").length, total: steps.length, ready: steps.every((step) => step.status === "done"), steps });
  });
}
