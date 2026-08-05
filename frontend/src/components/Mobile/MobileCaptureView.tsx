import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTransactions, updateTransaction, uploadAttachment, type ReceiptOcrProposal } from "../../api/client";
import type { Category, Transaction } from "../../types";
import { ReceiptOcrDialog } from "../Transactions/ReceiptOcrDialog";

interface Props { onOpenDesktop: () => void; onLogout?: () => Promise<void> }

export function MobileCaptureView({ onOpenDesktop, onLogout }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ocrReview, setOcrReview] = useState<{ transaction: Transaction; proposal: ReceiptOcrProposal } | null>(null);

  useEffect(() => {
    fetchTransactions().then((items) => {
      const expenses = items.filter((item) => item.amount_ttc < 0 && item.status !== "rejected").sort((a, b) => b.date.localeCompare(a.date));
      setTransactions(expenses);
      setSelectedId(expenses.find((item) => !item.attachment)?.id ?? expenses[0]?.id ?? "");
    }).catch(() => setError("Impossible de charger les transactions.")).finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return transactions.filter((item) => !normalized || `${item.label} ${item.date} ${Math.abs(item.amount_ttc).toFixed(2)}`.toLowerCase().includes(normalized)).slice(0, 40);
  }, [transactions, query]);
  const selected = transactions.find((item) => item.id === selectedId);

  async function capture(file?: File) {
    if (!file || !selected) return;
    setUploading(true); setError(""); setMessage("Compression et analyse locale en cours…");
    try {
      const result = await uploadAttachment(selected.id, file);
      setTransactions((items) => items.map((item) => item.id === selected.id ? result.transaction : item));
      if (result.ocr.status === "success" && result.ocr.proposal) {
        setOcrReview({ transaction: result.transaction, proposal: result.ocr.proposal });
        setMessage("Photo enregistrée. Vérifie maintenant les informations proposées.");
      } else setMessage("Photo enregistrée. L’OCR n’a pas proposé de TVA ; la saisie manuelle reste disponible dans l’interface complète.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Envoi impossible."); setMessage("");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function apply(values: { category: Category; invoiceRef?: string; vatSplits: Array<{ rate: number; amountTtc: number }> }) {
    if (!ocrReview) return;
    const updated = await updateTransaction(ocrReview.transaction.id, { category: values.category, invoiceRef: values.invoiceRef, vat_splits: values.vatSplits.map((split) => ({ rate: split.rate, amount_ttc: -Math.abs(split.amountTtc) })) });
    setTransactions((items) => items.map((item) => item.id === updated.id ? updated : item));
    setOcrReview(null); setMessage("Justificatif et TVA enregistrés.");
  }

  return <div className="min-h-[100dvh] bg-vscode-bg text-vscode-text">
    <header className="sticky top-0 z-20 border-b border-vscode-border bg-vscode-panel/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-lg items-center justify-between gap-3"><div><p className="text-sm font-semibold">ComptaOS</p><p className="text-[11px] text-vscode-muted">Ajouter un justificatif</p></div><button onClick={onOpenDesktop} className="rounded border border-vscode-border px-3 py-2 text-xs text-vscode-muted">Interface complète</button></div></header>
    <main className="mx-auto max-w-lg space-y-4 px-4 py-5 pb-28">
      <section className="rounded-xl border border-vscode-border bg-vscode-panel p-4"><h1 className="text-lg font-semibold">Photographier une facture</h1><p className="mt-1 text-sm text-vscode-muted">Choisis d’abord la dépense bancaire correspondante.</p><input aria-label="Rechercher une transaction" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Restaurant, montant, date…" className="mt-4 w-full rounded-lg border border-vscode-border bg-vscode-bg px-3 py-3 text-base outline-none focus:border-vscode-accent" /></section>
      {loading && <p className="py-8 text-center text-sm text-vscode-muted">Chargement…</p>}
      {!loading && visible.length === 0 && <p className="rounded-xl border border-vscode-border p-5 text-center text-sm text-vscode-muted">Aucune dépense trouvée.</p>}
      <div className="space-y-2">{visible.map((item) => <button key={item.id} onClick={() => { setSelectedId(item.id); setMessage(""); setError(""); }} className={`w-full rounded-xl border p-4 text-left ${selectedId === item.id ? "border-vscode-accent bg-blue-950/30" : "border-vscode-border bg-vscode-panel"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-vscode-muted">{item.date}{item.attachment ? " · 📎 justificatif présent" : " · à justifier"}</p></div><strong className="whitespace-nowrap text-sm">{Math.abs(item.amount_ttc).toFixed(2)} €</strong></div></button>)}</div>
      {message && <p role="status" className="rounded-lg border border-green-800 bg-green-950/30 p-3 text-sm text-green-300">{message}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-800 bg-red-950/30 p-3 text-sm text-red-300">{error}</p>}
      {onLogout && <button onClick={() => void onLogout()} className="w-full py-3 text-sm text-vscode-muted">Se déconnecter</button>}
    </main>
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-vscode-border bg-vscode-panel/95 p-4 backdrop-blur"><div className="mx-auto max-w-lg"><input ref={inputRef} className="sr-only" type="file" accept="image/*" capture="environment" aria-label="Prendre une photo du justificatif" onChange={(event) => void capture(event.target.files?.[0])} /><button disabled={!selected || uploading} onClick={() => inputRef.current?.click()} className="w-full rounded-xl bg-vscode-accent px-5 py-4 text-base font-semibold text-white shadow-lg disabled:opacity-40">{uploading ? "Analyse en cours…" : selected ? "📷 Prendre la photo" : "Choisir une transaction"}</button></div></div>
    {ocrReview && <ReceiptOcrDialog transaction={ocrReview.transaction} proposal={ocrReview.proposal} onApply={apply} onClose={() => setOcrReview(null)} />}
  </div>;
}
