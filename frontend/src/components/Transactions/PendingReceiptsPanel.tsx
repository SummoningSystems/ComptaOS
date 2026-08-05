import { useEffect, useMemo, useState } from "react";
import {
  attachmentUrl,
  deletePendingReceipt,
  fetchPendingReceipts,
  linkPendingReceipt,
  type PendingReceipt,
  type ReceiptOcrProposal,
} from "../../api/client";
import type { Transaction } from "../../types";

interface Props {
  transactions: Transaction[];
  onLinked: (transaction: Transaction, proposal?: ReceiptOcrProposal) => void;
}

export function PendingReceiptsPanel({ transactions, onLinked }: Props) {
  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const [targetByReceipt, setTargetByReceipt] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const expenses = useMemo(
    () => transactions.filter((item) => item.amount_ttc < 0 && item.status !== "rejected").sort((a, b) => b.date.localeCompare(a.date)),
    [transactions],
  );

  useEffect(() => {
    fetchPendingReceipts().then(setReceipts).catch(() => setError("Impossible de charger les justificatifs en attente."));
  }, []);

  if (receipts.length === 0 && !error) return null;

  async function link(receipt: PendingReceipt) {
    const transactionId = targetByReceipt[receipt.id];
    if (!transactionId) return;
    setBusyId(receipt.id); setError("");
    try {
      const result = await linkPendingReceipt(receipt.id, transactionId);
      setReceipts((current) => current.filter((item) => item.id !== receipt.id));
      onLinked(result.transaction, result.proposal);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Association impossible.");
    } finally { setBusyId(""); }
  }

  async function remove(receipt: PendingReceipt) {
    if (!window.confirm("Supprimer définitivement ce justificatif en attente ?")) return;
    setBusyId(receipt.id); setError("");
    try {
      await deletePendingReceipt(receipt.id);
      setReceipts((current) => current.filter((item) => item.id !== receipt.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suppression impossible.");
    } finally { setBusyId(""); }
  }

  return <section className="shrink-0 border-b border-amber-800/70 bg-amber-950/20 px-4 py-3">
    <div className="mb-2 flex items-center gap-2">
      <h2 className="text-xs font-semibold text-amber-300">Justificatifs en attente</h2>
      <span className="rounded-full bg-amber-800/60 px-2 py-0.5 text-[10px] text-amber-100">{receipts.length}</span>
      <span className="text-[10px] text-vscode-muted">Photographiés avant l’arrivée de la transaction bancaire</span>
    </div>
    {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
    <div className="flex gap-3 overflow-x-auto pb-1">
      {receipts.map((receipt) => {
        const proposal = receipt.ocr.proposal;
        const target = targetByReceipt[receipt.id] ?? "";
        return <article key={receipt.id} className="flex min-w-[430px] max-w-xl gap-3 rounded-lg border border-amber-800/60 bg-vscode-panel p-3">
          <a href={attachmentUrl(receipt.filename)} target="_blank" rel="noreferrer" className="flex h-24 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-vscode-border bg-vscode-bg" title="Ouvrir le justificatif">
            {receipt.mimetype.startsWith("image/") ? <img src={attachmentUrl(receipt.filename)} alt={`Aperçu de ${receipt.originalName}`} className="h-full w-full object-cover" /> : <span className="text-xs text-vscode-muted">PDF</span>}
          </a>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0"><p className="truncate text-xs font-medium">{proposal?.supplier || receipt.originalName}</p><p className="mt-0.5 text-[10px] text-vscode-muted">{new Date(receipt.createdAt).toLocaleString("fr-FR")}{proposal?.amountTtc ? ` · ${proposal.amountTtc.toFixed(2)} € TTC` : " · montant à vérifier"}</p></div>
              <button disabled={busyId === receipt.id} onClick={() => void remove(receipt)} className="text-xs text-vscode-muted hover:text-red-400 disabled:opacity-40" aria-label={`Supprimer ${receipt.originalName}`}>Supprimer</button>
            </div>
            <p className={`mt-1 text-[10px] ${receipt.ocr.status === "success" ? "text-green-400" : "text-amber-400"}`}>{receipt.ocr.status === "success" ? "OCR terminé" : "OCR à reprendre ou saisie manuelle"}</p>
            <div className="mt-2 flex gap-2">
              <select aria-label={`Transaction pour ${receipt.originalName}`} value={target} onChange={(event) => setTargetByReceipt((current) => ({ ...current, [receipt.id]: event.target.value }))} className="min-w-0 flex-1 rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs">
                <option value="">Choisir la transaction…</option>
                {expenses.map((transaction) => <option key={transaction.id} value={transaction.id}>{transaction.date} · {transaction.label} · {Math.abs(transaction.amount_ttc).toFixed(2)} €</option>)}
              </select>
              <button disabled={!target || busyId === receipt.id} onClick={() => void link(receipt)} className="rounded bg-amber-700 px-3 py-1 text-xs text-white disabled:opacity-40">{busyId === receipt.id ? "Association…" : "Associer"}</button>
            </div>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
