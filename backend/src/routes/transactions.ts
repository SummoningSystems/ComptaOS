import { FastifyInstance } from "fastify";
import {
  loadAllTransactions,
  saveTransaction,
  updateTransaction,
  deleteTransaction,
  validateVatSplits,
} from "../services/transactionService.js";
import { Transaction, Category } from "../types/index.js";
import { autoCommit } from "../services/gitService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { learnMerchantRule, loadMerchantRules, merchantPattern } from "../services/settingsService.js";

export async function transactionsRoutes(app: FastifyInstance) {
  // GET /api/transactions
  app.get("/", async (_req, reply) => {
    const txns = await loadAllTransactions();
    return reply.send(txns);
  });

  // GET /api/transactions/smart-categorize — suggestions par pattern matching (sans LLM)
  app.get("/smart-categorize", async (_req, reply) => {
    const txns = await loadAllTransactions();
    const merchantRules = loadMerchantRules();

    /** Tokenise un libellé en mots-clés significatifs */
    function tokenize(label: string): string[] {
      return label
        .toLowerCase()
        .normalize("NFD").replace(/\p{M}/gu, "")   // retire les accents
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 3);
    }

    // 1. Construire keyword → { category: poids } depuis les transactions déjà catégorisées
    const keywordMap = new Map<string, Record<string, number>>();
    for (const t of txns) {
      if (t.category === "misc" || t.status === "rejected") continue;
      for (const token of tokenize(t.label)) {
        if (!keywordMap.has(token)) keywordMap.set(token, {});
        const m = keywordMap.get(token)!;
        m[t.category] = (m[t.category] ?? 0) + 1;
      }
    }

    // 2. Scorer chaque transaction "misc"
    type Suggestion = {
      id: string; label: string; amount_ttc: number;
      suggestedCategory: string; suggestedVatRate?: number; confidenceLevel: "high" | "medium" | "low";
      confidenceScore: number; matchedKeyword: string; reason: string;
    };
    const suggestions: Suggestion[] = [];

    for (const t of txns) {
      if (t.category !== "misc" || t.status === "rejected") continue;

      const learned = merchantRules.find((rule) => rule.pattern === merchantPattern(t.label) && rule.category);
      if (learned?.category) {
        suggestions.push({ id: t.id, label: t.label, amount_ttc: t.amount_ttc, suggestedCategory: learned.category, suggestedVatRate: learned.vatRate, confidenceLevel: "high", confidenceScore: 1, matchedKeyword: learned.pattern, reason: `Règle apprise après validation de « ${learned.sourceLabel} »` });
        continue;
      }

      const votes: Record<string, number> = {};
      let bestToken = "";
      let bestTokenScore = 0;

      for (const token of tokenize(t.label)) {
        const cats = keywordMap.get(token);
        if (!cats) continue;
        for (const [cat, count] of Object.entries(cats)) {
          votes[cat] = (votes[cat] ?? 0) + count;
        }
        const tokenMax = Math.max(...Object.values(cats));
        if (tokenMax > bestTokenScore) { bestTokenScore = tokenMax; bestToken = token; }
      }

      const total = Object.values(votes).reduce((a, b) => a + b, 0);
      if (total === 0) continue;

      const [bestCat, bestCount] = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      const score = bestCount / total;

      suggestions.push({
        id: t.id,
        label: t.label,
        amount_ttc: t.amount_ttc,
        suggestedCategory: bestCat,
        confidenceLevel: score > 0.8 ? "high" : score > 0.5 ? "medium" : "low",
        confidenceScore: parseFloat(score.toFixed(3)),
        matchedKeyword: bestToken,
        reason: `Mot-clé local déjà catégorisé : ${bestToken}`,
      });
    }

    suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return reply.send({ suggestions, learnedPatterns: keywordMap.size + merchantRules.length });
  });

  // POST /api/transactions/smart-categorize/apply — applique les suggestions choisies
  app.post<{ Body: { changes: { id: string; category: Category; vat_rate?: number }[] } }>(
    "/smart-categorize/apply",
    async (req, reply) => {
      const { changes } = req.body;
      if (!Array.isArray(changes) || changes.length === 0) {
        return reply.status(400).send({ error: "changes requis" });
      }
      const results = await Promise.all(
        changes.map(({ id, category, vat_rate }) => updateTransaction(id, { category, ...(vat_rate === undefined ? {} : { vat_rate, vat_splits: [] }) }))
      );
      autoCommit(getWorkspaceRoot(), `catégorisation: ${results.length} transaction(s) mises à jour`).catch(() => {});
      return reply.send({ applied: results.length });
    }
  );

  // POST /api/transactions — crée une transaction
  app.post<{ Body: Transaction }>("/", async (req, reply) => {
    const txn = req.body;
    if (!txn.id || !txn.date || !txn.label) {
      return reply.status(400).send({ error: "id, date et label sont requis" });
    }
    const vatError = validateVatSplits(txn.amount_ttc, txn.vat_splits);
    if (vatError) return reply.status(400).send({ error: vatError });
    await saveTransaction(txn);
    const sign = txn.amount_ttc >= 0 ? "+" : "";
    autoCommit(getWorkspaceRoot(), `ajout: ${txn.label} (${sign}${txn.amount_ttc.toFixed(2)}€)`).catch(() => {});
    return reply.status(201).send(txn);
  });

  // PATCH /api/transactions/:id
  app.patch<{ Params: { id: string }; Body: Partial<Transaction> }>( "/:id", async (req, reply) => {
    if (req.body.vat_splits !== undefined) {
      const current = (await loadAllTransactions()).find((transaction) => transaction.id === req.params.id);
      if (!current) return reply.status(404).send({ error: "Transaction introuvable" });
      const vatError = validateVatSplits(current.amount_ttc, req.body.vat_splits);
      if (vatError) return reply.status(400).send({ error: vatError });
    }
    const updated = await updateTransaction(req.params.id, req.body);
    const learned = learnMerchantRule(updated.label, {
      category: req.body.category && req.body.category !== "misc" ? req.body.category : undefined,
      vatRate: typeof req.body.vat_rate === "number" ? req.body.vat_rate : undefined,
    });
    autoCommit(getWorkspaceRoot(), `maj: ${updated.label}`).catch(() => {});
    return reply.send({ ...updated, learnedRule: learned ? { pattern: learned.pattern, category: learned.category, vatRate: learned.vatRate } : undefined });
  });

  // DELETE /api/transactions/:id
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await deleteTransaction(req.params.id);
    autoCommit(getWorkspaceRoot(), `suppression: ${req.params.id}`).catch(() => {});
    return reply.send({ ok: true });
  });

  // DELETE /api/transactions  — suppression en masse
  // Body: { ids: string[] }
  app.delete<{ Body: { ids: string[] } }>("/", async (req, reply) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return reply.status(400).send({ error: "ids requis (tableau)" });
    }
    await Promise.all(ids.map((id) => deleteTransaction(id)));
    autoCommit(getWorkspaceRoot(), `suppression: ${ids.length} transaction(s)`).catch(() => {});
    return reply.send({ deleted: ids.length });
  });

  // PATCH /api/transactions/bulk-status — changement de statut en masse
  // Body: { ids: string[], status: "validated" | "pending" | "rejected" }
  app.patch<{ Body: { ids: string[]; status: Transaction["status"] } }>(
    "/bulk-status",
    async (req, reply) => {
      const { ids, status } = req.body;
      if (!Array.isArray(ids) || ids.length === 0 || !status) {
        return reply.status(400).send({ error: "ids et status requis" });
      }
      const valid: Transaction["status"][] = ["validated", "pending", "rejected"];
      if (!valid.includes(status)) {
        return reply.status(400).send({ error: "status invalide" });
      }
      const updated = await Promise.all(ids.map((id) => updateTransaction(id, { status })));
      autoCommit(getWorkspaceRoot(), `statut → ${status}: ${ids.length} transaction(s)`).catch(() => {});
      return reply.send({ updated: updated.filter(Boolean).length });
    }
  );
}
