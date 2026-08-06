import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentUrl,
  deletePendingReceipt,
  fetchPendingReceipts,
  linkPendingReceipt,
  uploadPendingReceipt,
  type PendingReceipt,
  type ReceiptOcrProposal,
} from "../../api/client";
import type { Transaction } from "../../types";

interface Props { transactions: Transaction[]; onLinked: (transaction: Transaction, proposal?: ReceiptOcrProposal) => void }
export interface ReceiptMatch { transactionId: string; score: number; confidence: "high" | "medium" | "low" }

function words(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
}

function daysBetween(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

export function suggestReceiptMatches(receipts: PendingReceipt[], transactions: Transaction[]): Record<string, ReceiptMatch> {
  const expenses = transactions.filter((item) => item.amount_ttc < 0 && item.status !== "rejected");
  const matches: Record<string, ReceiptMatch> = {};
  const used = new Set<string>();
  for (const receipt of receipts) {
    const proposal = receipt.ocr.proposal;
    if (!proposal?.amountTtc) continue;
    const supplierWords = words(proposal.supplier ?? "");
    const candidates = expenses.filter((transaction) => !used.has(transaction.id) && Math.abs(Math.abs(transaction.amount_ttc) - proposal.amountTtc) <= 0.05).map((transaction) => {
      let score = 70;
      if (!transaction.attachment) score += 5;
      if (proposal.date) { const days = daysBetween(proposal.date, transaction.date); score += days <= 2 ? 25 : days <= 7 ? 15 : days <= 14 ? 5 : -15; }
      const labelWords = words(transaction.label);
      if ([...supplierWords].some((word) => labelWords.has(word))) score += 20;
      return { transaction, score };
    }).sort((left, right) => right.score - left.score);
    if (!candidates[0] || candidates[0].score < 75 || (candidates[1] && candidates[1].score === candidates[0].score)) continue;
    const best = candidates[0];
    matches[receipt.id] = { transactionId: best.transaction.id, score: best.score, confidence: best.score >= 105 ? "high" : best.score >= 90 ? "medium" : "low" };
    used.add(best.transaction.id);
  }
  return matches;
}

export function PendingReceiptsPanel({ transactions, onLinked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const [targetByReceipt, setTargetByReceipt] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState<{ done: number; total: number } | null>(null);
  const expenses = useMemo(() => transactions.filter((item) => item.amount_ttc < 0 && item.status !== "rejected").sort((a, b) => b.date.localeCompare(a.date)), [transactions]);
  const suggestions = useMemo(() => suggestReceiptMatches(receipts, transactions), [receipts, transactions]);

  useEffect(() => { fetchPendingReceipts().then(setReceipts).catch(() => setError("Impossible de charger les justificatifs en attente.")); }, []);

  async function importFiles(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    if (selected.length === 0) return;
    setError(""); setImportProgress({ done: 0, total: selected.length });
    let done = 0; let failed = 0;
    for (let index = 0; index < selected.length; index += 3) {
      const batch = selected.slice(index, index + 3);
      await Promise.all(batch.map(async (file) => {
        try { const { receipt } = await uploadPendingReceipt(file); setReceipts((current) => [receipt, ...current]); }
        catch { failed += 1; }
        finally { done += 1; setImportProgress({ done, total: selected.length }); }
      }));
    }
    setImportProgress(null);
    if (failed > 0) setError(`${failed} fichier${failed > 1 ? "s n’ont" : " n’a"} pas pu être importé${failed > 1 ? "s" : ""}. Les autres sont conservés.`);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function link(receipt: PendingReceipt, transactionId = targetByReceipt[receipt.id] ?? suggestions[receipt.id]?.transactionId) {
    if (!transactionId) return;
    setBusyId(receipt.id); setError("");
    try {
      const result = await linkPendingReceipt(receipt.id, transactionId);
      setReceipts((current) => current.filter((item) => item.id !== receipt.id));
      onLinked(result.transaction, result.proposal);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Association impossible."); }
    finally { setBusyId(""); }
  }

  async function remove(receipt: PendingReceipt) {
    if (!window.confirm("Supprimer définitivement ce justificatif en attente ?")) return;
    setBusyId(receipt.id); setError("");
    try { await deletePendingReceipt(receipt.id); setReceipts((current) => current.filter((item) => item.id !== receipt.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Suppression impossible."); }
    finally { setBusyId(""); }
  }

  return <section className="shrink-0 border-b border-amber-800/70 bg-amber-950/20 px-4 py-3">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <h2 className="text-xs font-semibold text-amber-300">Justificatifs en attente</h2>
      <span className="rounded-full bg-amber-800/60 px-2 py-0.5 text-[10px] text-amber-100">{receipts.length}</span>
      <span className="text-[10px] text-vscode-muted">Import en lot, OCR puis proposition de rapprochement</span>
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" aria-label="Importer plusieurs justificatifs" onChange={(event) => void importFiles(event.target.files)} />
      <button disabled={Boolean(importProgress)} onClick={() => inputRef.current?.click()} className="ml-auto rounded bg-vscode-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{importProgress ? `Compression et OCR ${importProgress.done}/${importProgress.total}…` : "＋ Importer plusieurs fichiers"}</button>
    </div>
    {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
    {receipts.length === 0 ? <p className="py-2 text-xs text-vscode-muted">Aucun justificatif en attente. Tu peux importer toutes tes pièces en une seule sélection.</p> : <div className="grid max-h-[30rem] grid-cols-1 gap-3 overflow-y-auto pb-1 2xl:grid-cols-2">
      {receipts.map((receipt) => {
        const proposal = receipt.ocr.proposal; const suggestion = suggestions[receipt.id];
        const suggestedTransaction = suggestion ? transactions.find((item) => item.id === suggestion.transactionId) : undefined;
        const target = targetByReceipt[receipt.id] ?? suggestion?.transactionId ?? "";
        return <article key={receipt.id} className="flex min-w-0 gap-3 rounded-lg border border-amber-800/60 bg-vscode-panel p-3">
          <a href={attachmentUrl(receipt.filename)} target="_blank" rel="noreferrer" className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-vscode-border bg-vscode-bg" title="Ouvrir le justificatif">{receipt.mimetype.startsWith("image/") ? <img src={attachmentUrl(receipt.filename)} alt={`Aperçu de ${receipt.originalName}`} className="h-full w-full object-cover" /> : <span className="text-xs text-vscode-muted">PDF</span>}</a>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-medium">{proposal?.supplier || receipt.originalName}</p><p className="mt-0.5 text-[10px] text-vscode-muted">{proposal?.date || new Date(receipt.createdAt).toLocaleDateString("fr-FR")}{proposal?.amountTtc ? ` · ${proposal.amountTtc.toFixed(2)} € TTC` : " · montant à vérifier"}</p></div><button disabled={busyId === receipt.id} onClick={() => void remove(receipt)} className="text-xs text-vscode-muted hover:text-red-400 disabled:opacity-40" aria-label={`Supprimer ${receipt.originalName}`}>Supprimer</button></div>
            <p className={`mt-1 text-[10px] ${receipt.ocr.status === "success" ? "text-green-400" : "text-amber-400"}`}>{receipt.ocr.status === "success" ? "OCR terminé" : "OCR à reprendre ou saisie manuelle"}</p>
            {suggestedTransaction && <div className="mt-2 flex items-center gap-2 rounded border border-green-800/60 bg-green-950/20 px-2 py-1.5"><div className="min-w-0 flex-1"><p className="truncate text-[10px] text-green-300">Proposition {suggestion.confidence} : {suggestedTransaction.date} · {suggestedTransaction.label} · {Math.abs(suggestedTransaction.amount_ttc).toFixed(2)} €</p></div><button disabled={busyId === receipt.id} onClick={() => void link(receipt, suggestedTransaction.id)} className="shrink-0 rounded bg-green-700 px-2 py-1 text-[10px] text-white disabled:opacity-40">Valider</button></div>}
            <div className="mt-2 flex gap-2"><select aria-label={`Transaction pour ${receipt.originalName}`} value={target} onChange={(event) => setTargetByReceipt((current) => ({ ...current, [receipt.id]: event.target.value }))} className="min-w-0 flex-1 rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs"><option value="">Choisir manuellement…</option>{expenses.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.date} · {transaction.label} · {Math.abs(transaction.amount_ttc).toFixed(2)} €</option>)}</select><button disabled={!target || busyId === receipt.id} onClick={() => void link(receipt, target)} className="rounded bg-amber-700 px-3 py-1 text-xs text-white disabled:opacity-40">Associer</button></div>
          </div>
        </article>;
      })}
    </div>}
  </section>;
}
