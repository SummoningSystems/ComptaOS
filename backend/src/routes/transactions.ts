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

const CATEGORY_PCG: Record<Category, [string, string]> = {
  hosting:      ["616200", "Hébergement web"],
  software:     ["615600", "Logiciels"],
  salary:       ["641100", "Salaires"],
  travel:       ["625100", "Voyages et déplacements"],
  restaurant:   ["625700", "Réceptions"],
  food:         ["606000", "Achats non stockés"],
  taxes:        ["447900", "Impôts et taxes"],
  equipment:    ["218300", "Matériel informatique"],
  subscription: ["622600", "Abonnements"],
  rent:         ["613200", "Loyers"],
  legal:        ["622200", "Honoraires"],
  insurance:    ["616000", "Primes d'assurance"],
  misc:         ["628800", "Charges diverses"],
};

export async function transactionsRoutes(app: FastifyInstance) {
  // GET /api/transactions
  app.get("/", async (_req, reply) => {
    const txns = await loadAllTransactions();
    return reply.send(txns);
  });

  // GET /api/transactions/fec?year=2025 — export Fichier des Écritures Comptables
  app.get<{ Querystring: { year?: string } }>("/fec", async (req, reply) => {
    const year = req.query.year ?? new Date().getFullYear().toString();
    const txns = (await loadAllTransactions())
      .filter((t) => t.date.startsWith(year) && t.status !== "rejected")
      .sort((a, b) => a.date.localeCompare(b.date));

    const BANK_NUM = "512100";
    const BANK_LIB = "Compte bancaire";
    const REV_NUM  = "706000";
    const REV_LIB  = "Prestations de services";

    const fmt     = (n: number) => Math.abs(n).toFixed(2);
    const fmtDate = (d: string) => d.replace(/-/g, "");
    const esc     = (s: string) => s.replace(/[|\r\n]/g, " ").slice(0, 99);

    const header = "JournalCode|JournalLib|EcritureNum|EcritureDate|CompteNum|CompteLib|CompAuxNum|CompAuxLib|PieceRef|PieceDate|EcritureLib|Debit|Credit|EcritureLet|DateLet|ValidDate|Montantdevise|Idevise";
    const lines: string[] = [header];

    let num = 1;
    for (const t of txns) {
      const date  = fmtDate(t.date);
      const label = esc(t.label);
      const ref   = t.invoiceRef ?? t.id;
      const [catNum, catLib] = CATEGORY_PCG[t.category] ?? ["628800", "Charges diverses"];
      const abs   = fmt(t.amount_ttc);
      const n     = String(num).padStart(6, "0");

      if (t.amount_ttc < 0) {
        // Dépense: débit compte de charge, crédit banque
        lines.push(`AC|Achats|${n}|${date}|${catNum}|${catLib}|||${ref}|${date}|${label}|${abs}|0.00||||${abs}|EUR`);
        lines.push(`AC|Achats|${n}|${date}|${BANK_NUM}|${BANK_LIB}|||${ref}|${date}|${label}|0.00|${abs}||||${abs}|EUR`);
      } else {
        // Recette: débit banque, crédit produit
        lines.push(`VT|Ventes|${n}|${date}|${BANK_NUM}|${BANK_LIB}|||${ref}|${date}|${label}|${abs}|0.00||||${abs}|EUR`);
        lines.push(`VT|Ventes|${n}|${date}|${REV_NUM}|${REV_LIB}|||${ref}|${date}|${label}|0.00|${abs}||||${abs}|EUR`);
      }
      num++;
    }

    const content = lines.join("\r\n") + "\r\n";
    return reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="FEC_${year}.txt"`)
      .send(content);
  });

  // GET /api/transactions/smart-categorize — suggestions par pattern matching (sans LLM)
  app.get("/smart-categorize", async (_req, reply) => {
    const txns = await loadAllTransactions();

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
      suggestedCategory: string; confidenceLevel: "high" | "medium" | "low";
      confidenceScore: number; matchedKeyword: string;
    };
    const suggestions: Suggestion[] = [];

    for (const t of txns) {
      if (t.category !== "misc" || t.status === "rejected") continue;

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
      });
    }

    suggestions.sort((a, b) => b.confidenceScore - a.confidenceScore);
    return reply.send({ suggestions, learnedPatterns: keywordMap.size });
  });

  // POST /api/transactions/smart-categorize/apply — applique les suggestions choisies
  app.post<{ Body: { changes: { id: string; category: Category }[] } }>(
    "/smart-categorize/apply",
    async (req, reply) => {
      const { changes } = req.body;
      if (!Array.isArray(changes) || changes.length === 0) {
        return reply.status(400).send({ error: "changes requis" });
      }
      const results = await Promise.all(
        changes.map(({ id, category }) => updateTransaction(id, { category }))
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
    autoCommit(getWorkspaceRoot(), `maj: ${updated.label}`).catch(() => {});
    return reply.send(updated);
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
