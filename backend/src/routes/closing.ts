import { FastifyInstance } from "fastify";
import { loadAllTransactions } from "../services/transactionService.js";
import { loadPendingReceipts } from "../services/receiptInboxService.js";
import { getConnections } from "../services/bankingService.js";
import { buildAccountingPreview } from "../services/accountingExportService.js";
import { loadAccountingConfig } from "../services/settingsService.js";
import { activeClosing, closeMonth, loadClosings, reopenMonth } from "../services/closingService.js";
import { autoCommit } from "../services/gitService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { needsTransactionEvidence } from "../services/transactionEvidenceService.js";

type Step = { id: string; label: string; status: "done" | "warning" | "blocked"; detail: string; count?: number; action?: "banking" | "transactions" | "vat" | "reconcile" | "export"; filter?: "unjustified" | "misc" | "pending" };

async function checklist(month: string) {
  const [transactions, receipts, connections, closing] = await Promise.all([loadAllTransactions(), loadPendingReceipts(), getConnections().catch(() => []), activeClosing(month)]);
  const active = transactions.filter((transaction) => transaction.status !== "rejected" && transaction.date.startsWith(month));
  const expenses = active.filter((transaction) => transaction.amount_ttc < 0);
  const unjustified = expenses.filter(needsTransactionEvidence);
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
    { id: "receipts", label: "Justificatifs présents", status: unjustified.length === 0 && receipts.length === 0 ? "done" : "blocked", detail: unjustified.length ? `${unjustified.length} dépense(s) du mois à justifier` : receipts.length ? `${receipts.length} pièce(s) encore en attente` : "Toutes les dépenses sont documentées", count: unjustified.length + receipts.length, action: "transactions", filter: "unjustified" },
    { id: "categories", label: "Catégorisation terminée", status: uncategorized.length === 0 ? "done" : "blocked", detail: uncategorized.length ? `${uncategorized.length} opération(s) en catégorie misc` : "Toutes les opérations sont catégorisées", count: uncategorized.length, action: "transactions", filter: "misc" },
    { id: "vat", label: "TVA contrôlée", status: vatMissing.length === 0 ? "done" : "warning", detail: vatMissing.length ? `${vatMissing.length} dépense(s) sans TVA` : "Aucune TVA manquante détectée", count: vatMissing.length, action: "vat" },
    { id: "validation", label: "Opérations validées", status: unvalidated.length === 0 ? "done" : "blocked", detail: unvalidated.length ? `${unvalidated.length} opération(s) encore pending` : "Toutes les opérations sont validées", count: unvalidated.length, action: "transactions", filter: "pending" },
    { id: "reconcile", label: "Rapprochement terminé", status: unreconciled.length === 0 ? "done" : "blocked", detail: unreconciled.length ? `${unreconciled.length} opération(s) non rapprochée(s)` : "Toutes les opérations sont rapprochées", count: unreconciled.length, action: "reconcile" },
    { id: "export", label: "Dossier comptable exportable", status: blockers.length === 0 && unvalidated.length === 0 && unreconciled.length === 0 ? "done" : "blocked", detail: blockers.length ? `${blockers.length} anomalie(s) comptable(s) bloquante(s)` : "Le dossier expert-comptable peut être généré", count: blockers.length, action: "export" },
  ];
  return { month, transactionCount: active.length, completed: steps.filter((step) => step.status === "done").length, total: steps.length, ready: steps.every((step) => step.status === "done"), steps, closing };
}

export async function closingRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { month?: string } }>("/", async (req, reply) => {
    const month = req.query.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply.status(400).send({ error: "Mois invalide" });
    return reply.send(await checklist(month));
  });
  app.get("/history", async () => loadClosings());
  app.post<{ Body: { month: string } }>("/close", async (req, reply) => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.body?.month ?? "")) return reply.status(400).send({ error: "Mois invalide" });
    const state = await checklist(req.body?.month);
    if (!state.ready) return reply.status(409).send({ error: "Tous les contrôles doivent être terminés avant la clôture.", steps: state.steps });
    try { const record = await closeMonth(state.month, await loadAllTransactions()); await autoCommit(getWorkspaceRoot(), `clôture mensuelle: ${state.month} (${record.fingerprint.slice(0, 12)})`).catch(() => {}); return reply.status(201).send(record); }
    catch (error) { return reply.status(409).send({ error: error instanceof Error ? error.message : "Clôture impossible" }); }
  });
  app.post<{ Body: { month: string; reason: string } }>("/reopen", async (req, reply) => {
    try { const record = await reopenMonth(req.body?.month, req.body?.reason ?? ""); await autoCommit(getWorkspaceRoot(), `réouverture clôture: ${record.month} - ${record.reopenReason}`).catch(() => {}); return reply.send(record); }
    catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : "Réouverture impossible" }); }
  });
}
