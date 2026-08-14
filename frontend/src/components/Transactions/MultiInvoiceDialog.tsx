import { useMemo, useRef, useState } from "react";
import {
  analyzePendingReceipt,
  attachmentUrl,
  deletePendingReceipt,
  linkPendingReceiptGroup,
  updatePendingReceiptOcr,
  uploadPendingReceipt,
  type PendingReceipt,
  type ReceiptOcrProposal,
} from "../../api/client";
import type { Transaction } from "../../types";
import { PendingReceiptEditor } from "./PendingReceiptEditor";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

interface Props {
  transaction: Transaction;
  onComplete: (transaction: Transaction) => void;
  onClose: () => void;
}

export function MultiInvoiceDialog({ transaction, onComplete, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const [editing, setEditing] = useState<PendingReceipt | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bankTotal = Math.abs(transaction.amount_ttc);
  const documentedTotal = round2(transaction.attachment_details?.reduce((sum, detail) => sum + Math.abs(detail.amount_ttc ?? 0), 0) ?? 0);
  const newTotal = useMemo(() => round2(receipts.reduce((sum, receipt) => sum + Math.abs(receipt.ocr.proposal?.amountTtc ?? 0), 0)), [receipts]);
  const combinedTotal = round2(documentedTotal + newTotal);
  const difference = round2(bankTotal - combinedTotal);
  const allAnalyzed = receipts.length > 0 && receipts.every((receipt) => receipt.ocr.status === "success" && (receipt.ocr.proposal?.amountTtc ?? 0) > 0);
  const balanced = allAnalyzed && Math.abs(difference) <= 0.05;

  async function importFiles(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    if (!selected.length) return;
    setBusy(true); setError(""); setProgress({ done: 0, total: selected.length, current: "Stockage…" });
    for (const file of selected) {
      try {
        setProgress((current) => ({ ...current, current: `Stockage de ${file.name}` }));
        const { receipt } = await uploadPendingReceipt(file, { skipOcr: true });
        setProgress((current) => ({ ...current, current: `OCR de ${file.name}` }));
        const analyzed = await analyzePendingReceipt(receipt.id);
        setReceipts((current) => [...current, analyzed]);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Analyse impossible pour ${file.name}`);
      } finally {
        setProgress((current) => ({ ...current, done: current.done + 1 }));
      }
    }
    setBusy(false); setProgress({ done: 0, total: 0, current: "" });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function saveCorrection(proposal: ReceiptOcrProposal) {
    if (!editing) return;
    const updated = await updatePendingReceiptOcr(editing.id, proposal);
    setReceipts((current) => current.map((receipt) => receipt.id === updated.id ? updated : receipt));
    setEditing(null);
  }

  async function remove(receipt: PendingReceipt) {
    setBusy(true); setError("");
    try { await deletePendingReceipt(receipt.id); setReceipts((current) => current.filter((item) => item.id !== receipt.id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Suppression impossible"); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!balanced) return;
    setBusy(true); setError("");
    try {
      const result = await linkPendingReceiptGroup(receipts.map((receipt) => receipt.id), transaction.id, { reasons: ["validation manuelle multi-factures", `total ${combinedTotal.toFixed(2)} €`] });
      onComplete(result.transaction);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Association multiple impossible"); setBusy(false); }
  }

  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/75 p-3" role="dialog" aria-modal="true" aria-label="Associer plusieurs factures">
    <div className="mx-auto my-4 max-w-5xl rounded-lg border border-vscode-border bg-vscode-panel p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold">Multi-factures</h2><p className="mt-1 text-xs text-vscode-muted">{transaction.date} · {transaction.label}</p><p className="mt-1 text-sm">Transaction bancaire : <strong>{bankTotal.toFixed(2)} €</strong></p></div><button onClick={onClose} aria-label="Fermer">×</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-2"><input ref={inputRef} aria-label="Fichiers multi-factures" type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(event) => void importFiles(event.target.files)} /><button disabled={busy} onClick={() => inputRef.current?.click()} className="rounded bg-vscode-accent px-3 py-2 text-xs text-white disabled:opacity-40">＋ Ajouter plusieurs factures</button><span className="text-xs text-vscode-muted">Chaque fichier est stocké et analysé séparément.</span></div>
      {progress.total > 0 && <div className="mt-3 rounded border border-vscode-border bg-vscode-bg p-3"><div className="flex justify-between text-xs"><span className="truncate">{progress.current}</span><span>{progress.done}/{progress.total}</span></div><div className="mt-2 h-2 overflow-hidden rounded bg-vscode-border"><div className="h-full bg-vscode-accent transition-all" style={{ width: `${Math.round(progress.done / progress.total * 100)}%` }} /></div></div>}
      <div className="mt-4 grid gap-3 md:grid-cols-2">{receipts.map((receipt, index) => { const proposal = receipt.ocr.proposal; return <article key={receipt.id} className="rounded border border-vscode-border bg-vscode-bg p-3"><div className="flex justify-between gap-3"><div className="min-w-0"><strong className="text-xs">Facture {index + 1}</strong><p className="truncate text-[10px] text-vscode-muted">{receipt.originalName}</p></div><div className="flex gap-2"><a href={attachmentUrl(receipt.filename)} target="_blank" rel="noreferrer" className="text-xs text-vscode-accent">Voir</a><button disabled={busy} onClick={() => void remove(receipt)} className="text-xs text-red-400">Retirer</button></div></div>{proposal ? <div className="mt-3 text-xs"><p><strong>{proposal.supplier || "Fournisseur inconnu"}</strong>{proposal.invoiceRef ? ` · ${proposal.invoiceRef}` : ""}</p><div className="mt-2 grid grid-cols-3 gap-2"><span>HT<br/><strong>{proposal.amountHt.toFixed(2)} €</strong></span><span>TVA<br/><strong>{(proposal.amountVat ?? proposal.amountTtc - proposal.amountHt).toFixed(2)} €</strong></span><span>TTC<br/><strong>{proposal.amountTtc.toFixed(2)} €</strong></span></div><div className="mt-2 flex flex-wrap gap-1">{proposal.vatSplits.length ? proposal.vatSplits.map((split, row) => <span key={`${split.rate}-${row}`} className="rounded bg-vscode-border px-2 py-1 text-[10px]">{split.rate} % · {split.amountTtc.toFixed(2)} € TTC</span>) : <span className="text-amber-400">TVA non ventilée</span>}</div><button onClick={() => setEditing(receipt)} className="mt-3 text-xs text-vscode-accent">Vérifier ou corriger cette facture</button></div> : <div className="mt-3"><p className="text-xs text-amber-400">OCR en échec ou incomplet</p><button onClick={() => setEditing(receipt)} className="mt-2 text-xs text-vscode-accent">Saisir cette facture manuellement</button></div>}</article>; })}</div>
      {!receipts.length && <p className="mt-6 rounded border border-dashed border-vscode-border p-8 text-center text-xs text-vscode-muted">Sélectionne les deux factures Amazon en une seule fois.</p>}
      <div className="mt-5 rounded border border-vscode-border bg-vscode-bg p-4"><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><span>Déjà documenté<br/><strong>{documentedTotal.toFixed(2)} €</strong></span><span>Nouvelles factures<br/><strong>{newTotal.toFixed(2)} €</strong></span><span>Total couvert<br/><strong>{combinedTotal.toFixed(2)} €</strong></span><span>Écart<br/><strong className={Math.abs(difference) <= 0.05 ? "text-green-400" : "text-amber-400"}>{difference.toFixed(2)} €</strong></span></div><p className={`mt-3 text-xs ${balanced ? "text-green-400" : "text-amber-400"}`}>{balanced ? "Les factures couvrent exactement la transaction. La ventilation TVA peut être consolidée." : !allAnalyzed ? "Toutes les factures doivent être analysées ou corrigées avant validation." : "Le total des factures doit correspondre au montant bancaire."}</p></div>
      {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded border border-vscode-border px-3 py-2 text-xs">Fermer — conserver en attente</button><button disabled={!balanced || busy} onClick={() => void apply()} className="rounded bg-purple-700 px-4 py-2 text-xs text-white disabled:opacity-40">Associer et consolider les factures</button></div>
    </div>
    {editing && <PendingReceiptEditor receipt={editing} onSave={saveCorrection} onClose={() => setEditing(null)} />}
  </div>;
}
