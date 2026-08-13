import { useEffect, useMemo, useRef, useState } from "react";
import {
  attachmentUrl,
  deletePendingReceipt,
  fetchPendingReceipts,
  fetchPendingReceiptBatchOcr,
  linkPendingReceipt,
  rotatePendingReceipt,
  transformPendingReceipt,
  updatePendingReceiptOcr,
  startPendingReceiptBatchOcr,
  uploadPendingReceipt,
  type PendingReceipt,
  type ReceiptOcrProposal,
  type BatchOcrProgress,
} from "../../api/client";
import { PendingReceiptEditor } from "./PendingReceiptEditor";
import type { Transaction } from "../../types";

interface Props { transactions: Transaction[]; onLinked: (transaction: Transaction, proposal?: ReceiptOcrProposal) => void }
export interface ReceiptMatch { transactionId: string; score: number; confidence: "high" | "medium" | "low"; reasons: string[] }
export interface ReceiptGroupMatch { receiptIds: string[]; transactionId: string; total: number; score: number; reasons: string[] }
const euros = (value: number) => `${value.toFixed(2)} €`;
const transactionLabel = (transaction: Transaction) => `${transaction.date} · ${transaction.label} · ${Math.abs(transaction.amount_ttc).toFixed(2)} €${(transaction.attachments?.length ?? (transaction.attachment ? 1 : 0)) ? ` · ${transaction.attachments?.length ?? 1} pièce(s)` : ""}`;

function words(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
}

export function filterTransactions(transactions: Transaction[], query: string): Transaction[] {
  const normalized = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(",", ".");
  if (!normalized) return transactions.slice(0, 8);
  return transactions.filter((transaction) => `${transaction.date} ${transaction.label} ${Math.abs(transaction.amount_ttc).toFixed(2)}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(normalized)).slice(0, 8);
}

function daysBetween(left: string, right: string): number {
  return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

export function suggestReceiptMatches(receipts: PendingReceipt[], transactions: Transaction[]): Record<string, ReceiptMatch> {
  const expenses = transactions.filter((item) => item.amount_ttc < 0 && item.status !== "rejected");
  const matches: Record<string, ReceiptMatch> = {};
  for (const receipt of receipts) {
    const proposal = receipt.ocr.proposal;
    if (!proposal?.amountTtc) continue;
    const supplierWords = words(proposal.supplier ?? "");
    const candidates = expenses.filter((transaction) => {
      const documented = transaction.attachment_details?.reduce((sum, item) => sum + Math.abs(item.amount_ttc ?? 0), 0) ?? 0;
      const remaining = Math.max(0, Math.abs(transaction.amount_ttc) - documented);
      return remaining > 0 && Math.abs(remaining - proposal.amountTtc) <= 0.05;
    }).map((transaction) => {
      let score = 75; const reasons = ["montant restant identique"];
      const days = proposal.date ? daysBetween(proposal.date, transaction.date) : Number.POSITIVE_INFINITY;
      if (proposal.date) { score += days <= 2 ? 25 : days <= 7 ? 15 : days <= 14 ? 5 : -15; if (days <= 14) reasons.push(`date à ${Math.round(days)} jour(s)`); }
      const labelWords = words(transaction.label);
      if ([...supplierWords].some((word) => labelWords.has(word))) { score += 20; reasons.push("fournisseur reconnu"); }
      return { transaction, score, days, reasons };
    }).sort((left, right) => right.score - left.score || left.days - right.days || right.transaction.date.localeCompare(left.transaction.date));
    if (!candidates[0] || candidates[0].score < 75) continue;
    const best = candidates[0];
    matches[receipt.id] = { transactionId: best.transaction.id, score: best.score, confidence: best.score >= 105 ? "high" : best.score >= 90 ? "medium" : "low", reasons: best.reasons };
  }
  return matches;
}

export function suggestReceiptGroups(receipts: PendingReceipt[], transactions: Transaction[]): ReceiptGroupMatch[] {
  const usable = receipts.filter((receipt) => (receipt.ocr.proposal?.amountTtc ?? 0) > 0);
  const expenses = transactions.filter((transaction) => transaction.amount_ttc < 0 && transaction.status !== "rejected");
  const groups: ReceiptGroupMatch[] = [];
  for (let left = 0; left < usable.length; left++) for (let right = left + 1; right < usable.length; right++) {
    const first = usable[left]; const second = usable[right];
    const total = (first.ocr.proposal?.amountTtc ?? 0) + (second.ocr.proposal?.amountTtc ?? 0);
    const candidate = expenses.find((transaction) => {
      const documented = transaction.attachment_details?.reduce((sum, detail) => sum + Math.abs(detail.amount_ttc ?? 0), 0) ?? 0;
      return Math.abs(Math.max(0, Math.abs(transaction.amount_ttc) - documented) - total) <= 0.05;
    });
    if (!candidate) continue;
    const dates = [first.ocr.proposal?.date, second.ocr.proposal?.date].filter(Boolean) as string[];
    const maxDays = dates.length ? Math.max(...dates.map((date) => daysBetween(date, candidate.date))) : Infinity;
    const score = 90 + (maxDays <= 7 ? 15 : 0);
    groups.push({ receiptIds: [first.id, second.id], transactionId: candidate.id, total, score, reasons: ["somme des 2 justificatifs égale au débit", ...(maxDays <= 7 ? ["dates proches"] : [])] });
  }
  return groups.sort((left, right) => right.score - left.score);
}

export function PendingReceiptsPanel({ transactions, onLinked }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [receipts, setReceipts] = useState<PendingReceipt[]>([]);
  const [targetByReceipt, setTargetByReceipt] = useState<Record<string, string>>({});
  const [searchByReceipt, setSearchByReceipt] = useState<Record<string, string>>({});
  const [focusedSearch, setFocusedSearch] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [importProgress, setImportProgress] = useState<({ phase: "stockage"; done: number; total: number } | ({ phase: "ocr" } & BatchOcrProgress)) | null>(null);
  const [lastBatch, setLastBatch] = useState<BatchOcrProgress | null>(null);
  const [editingReceipt, setEditingReceipt] = useState<PendingReceipt | null>(null);
  const expenses = useMemo(() => transactions.filter((item) => item.amount_ttc < 0 && item.status !== "rejected").sort((a, b) => b.date.localeCompare(a.date)), [transactions]);
  const suggestions = useMemo(() => suggestReceiptMatches(receipts, transactions), [receipts, transactions]);
  const groupSuggestions = useMemo(() => suggestReceiptGroups(receipts, transactions), [receipts, transactions]);
  const quality = useMemo(() => ({ successful: receipts.filter((item) => item.ocr.status === "success").length, corrected: receipts.filter((item) => item.ocr.validatedAt).length, failed: receipts.filter((item) => item.ocr.status === "error").length }), [receipts]);

  useEffect(() => {
    Promise.all([fetchPendingReceipts(), fetchPendingReceiptBatchOcr()]).then(([items, progress]) => { setReceipts(items); if (progress.running) void monitorBatch(progress); }).catch(() => setError("Impossible de charger les justificatifs en attente."));
  }, []);

  async function monitorBatch(initial: BatchOcrProgress) {
    let progress = initial; let refreshedAt = -1;
    while (true) {
      setImportProgress({ phase: "ocr", ...progress });
      if (progress.done !== refreshedAt) { refreshedAt = progress.done; setReceipts(await fetchPendingReceipts()); }
      if (!progress.running) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      progress = await fetchPendingReceiptBatchOcr();
    }
    setLastBatch(progress); setImportProgress(null);
  }

  async function analyzeReceipts(items: PendingReceipt[]) {
    if (!items.length) return;
    setLastBatch(null);
    await monitorBatch(await startPendingReceiptBatchOcr(items.map((item) => item.id)));
  }

  async function importFiles(files: FileList | null) {
    const selected = files ? Array.from(files) : [];
    if (selected.length === 0) return;
    setError(""); setImportProgress({ phase: "stockage", done: 0, total: selected.length });
    let done = 0; let failed = 0;
    const uploaded: PendingReceipt[] = [];
    for (let index = 0; index < selected.length; index += 3) {
      const batch = selected.slice(index, index + 3);
      await Promise.all(batch.map(async (file) => {
        try { const { receipt } = await uploadPendingReceipt(file, { skipOcr: true }); uploaded.push(receipt); setReceipts((current) => [receipt, ...current]); }
        catch { failed += 1; }
        finally { done += 1; setImportProgress({ phase: "stockage", done, total: selected.length }); }
      }));
    }
    if (failed > 0) setError(`${failed} fichier${failed > 1 ? "s n’ont" : " n’a"} pas pu être importé${failed > 1 ? "s" : ""}. Les autres sont conservés.`);
    if (inputRef.current) inputRef.current.value = "";
    if (uploaded.length > 0) await analyzeReceipts(uploaded);
    else setImportProgress(null);
  }

  async function retryIncompleteOcr() {
    const incomplete = receipts.filter((receipt) => receipt.ocr.status !== "success");
    if (incomplete.length > 0) await analyzeReceipts(incomplete);
  }

  async function rotate(receipt: PendingReceipt, degrees: -90 | 90 | 180) {
    setBusyId(receipt.id); setError("");
    try {
      const updated = await rotatePendingReceipt(receipt.id, degrees);
      setReceipts((current) => current.map((item) => item.id === updated.id ? updated : item));
      await analyzeReceipts([updated]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Rotation impossible."); }
    finally { setBusyId(""); }
  }

  async function transform(receipt: PendingReceipt, operation: "enhance" | "crop") {
    setBusyId(receipt.id); setError("");
    try { const updated = await transformPendingReceipt(receipt.id, operation); setReceipts((current) => current.map((item) => item.id === updated.id ? updated : item)); await analyzeReceipts([updated]); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Préparation impossible."); } finally { setBusyId(""); }
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

  async function saveCorrection(proposal: ReceiptOcrProposal) {
    if (!editingReceipt) return;
    const updated = await updatePendingReceiptOcr(editingReceipt.id, proposal);
    setReceipts((current) => current.map((item) => item.id === updated.id ? updated : item));
    setEditingReceipt(null);
  }

  async function linkGroup(group: ReceiptGroupMatch) {
    setBusyId(group.receiptIds.join("+")); setError("");
    try {
      for (const receiptId of group.receiptIds) {
        const receipt = receipts.find((item) => item.id === receiptId);
        if (!receipt) continue;
        const result = await linkPendingReceipt(receipt.id, group.transactionId);
        onLinked(result.transaction, result.proposal);
      }
      setReceipts((current) => current.filter((item) => !group.receiptIds.includes(item.id)));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Association groupée impossible."); }
    finally { setBusyId(""); }
  }

  async function validateHighConfidence() {
    const entries = Object.entries(suggestions).filter(([, suggestion]) => suggestion.confidence === "high");
    setBusyId("batch-high"); setError("");
    try {
      for (const [receiptId, suggestion] of entries) {
        const receipt = receipts.find((item) => item.id === receiptId); if (!receipt) continue;
        const result = await linkPendingReceipt(receipt.id, suggestion.transactionId); onLinked(result.transaction, result.proposal);
        setReceipts((current) => current.filter((item) => item.id !== receiptId));
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Validation groupée interrompue."); }
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
      <span className="rounded border border-vscode-border px-2 py-0.5 text-[10px] text-vscode-muted">OCR {quality.successful}/{receipts.length} · corrigés {quality.corrected} · échecs {quality.failed}</span>
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" aria-label="Importer plusieurs justificatifs" onChange={(event) => void importFiles(event.target.files)} />
      {receipts.some((receipt) => receipt.ocr.status !== "success") && <button disabled={Boolean(importProgress)} onClick={() => void retryIncompleteOcr()} className="ml-auto rounded border border-amber-700 px-3 py-1.5 text-xs text-amber-300 disabled:opacity-50">Relancer les OCR incomplets</button>}
      <button disabled={Boolean(importProgress)} onClick={() => inputRef.current?.click()} className={`${receipts.some((receipt) => receipt.ocr.status !== "success") ? "" : "ml-auto"} rounded bg-vscode-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50`}>{importProgress ? `${importProgress.phase === "stockage" ? "Stockage" : "OCR"} ${importProgress.done}/${importProgress.total}…` : "＋ Importer plusieurs fichiers"}</button>
      {Object.values(suggestions).some((suggestion) => suggestion.confidence === "high") && <button disabled={Boolean(busyId)} onClick={() => void validateHighConfidence()} className="rounded bg-green-700 px-3 py-1.5 text-xs text-white disabled:opacity-40">Valider les rapprochements fiables</button>}
    </div>
    {importProgress && <div className="mb-3 rounded border border-vscode-border bg-vscode-panel p-2"><div className="mb-1 flex justify-between gap-3 text-[10px] text-vscode-muted"><span className="truncate">{importProgress.phase === "ocr" ? `OCR : ${importProgress.currentName || "préparation…"}` : "Compression et stockage des fichiers"}</span><span className="shrink-0">{importProgress.done}/{importProgress.total}{importProgress.phase === "ocr" ? ` · ${importProgress.succeeded} réussi(s) · ${importProgress.failed} échec(s)` : ""}</span></div><div className="h-2 overflow-hidden rounded-full bg-vscode-bg"><div className="h-full bg-vscode-accent transition-all duration-500" style={{ width: `${importProgress.total ? Math.round(importProgress.done / importProgress.total * 100) : 0}%` }} /></div>{importProgress.phase === "ocr" && <p className="mt-1 text-[10px] text-vscode-muted">Certains PDF peuvent prendre jusqu’à une minute. Le traitement continue côté serveur même si tu changes d’onglet.</p>}</div>}
    {!importProgress && lastBatch && lastBatch.total > 0 && <p className="mb-2 text-[10px] text-vscode-muted">Dernière relance terminée : {lastBatch.succeeded} réussi(s), {lastBatch.failed} échec(s) sur {lastBatch.total}.</p>}
    {error && <p role="alert" className="mb-2 text-xs text-red-400">{error}</p>}
    {groupSuggestions.map((group) => { const transaction = transactions.find((item) => item.id === group.transactionId); return transaction ? <div key={group.receiptIds.join("+")} className="mb-2 flex items-center gap-3 rounded border border-purple-700 bg-purple-950/25 px-3 py-2 text-xs"><div className="min-w-0 flex-1"><strong className="text-purple-300">Rapprochement multiple proposé</strong><p className="truncate text-vscode-muted">2 justificatifs = {euros(group.total)} → {transaction.date} · {transaction.label}. {group.reasons.join(" ; ")}.</p></div><button disabled={Boolean(busyId)} onClick={() => void linkGroup(group)} className="rounded bg-purple-700 px-3 py-1 text-white disabled:opacity-40">Associer les 2</button></div> : null; })}
    {receipts.length === 0 ? <p className="py-2 text-xs text-vscode-muted">Aucun justificatif en attente. Tu peux importer toutes tes pièces en une seule sélection.</p> : <div className="grid max-h-[30rem] grid-cols-1 gap-3 overflow-y-auto pb-1 2xl:grid-cols-2">
      {receipts.map((receipt) => {
        const proposal = receipt.ocr.proposal; const suggestion = suggestions[receipt.id];
        const suggestedTransaction = suggestion ? transactions.find((item) => item.id === suggestion.transactionId) : undefined;
        const target = targetByReceipt[receipt.id] ?? suggestion?.transactionId ?? "";
        const amountVat = proposal ? proposal.amountVat ?? Math.max(0, proposal.amountTtc - proposal.amountHt) : 0;
        const selectedTransaction = target ? transactions.find((item) => item.id === target) : undefined;
        const searchValue = searchByReceipt[receipt.id] ?? (selectedTransaction ? transactionLabel(selectedTransaction) : "");
        const searchResults = filterTransactions(expenses, searchValue);
        return <article key={receipt.id} className="flex min-w-0 gap-3 rounded-lg border border-amber-800/60 bg-vscode-panel p-3">
          <div className="w-20 shrink-0"><a href={attachmentUrl(receipt.filename)} target="_blank" rel="noreferrer" className="flex h-24 w-20 items-center justify-center overflow-hidden rounded border border-vscode-border bg-vscode-bg" title="Ouvrir le justificatif">{receipt.mimetype.startsWith("image/") ? <img src={`${attachmentUrl(receipt.filename)}?v=${encodeURIComponent(receipt.ocr.message ?? receipt.createdAt)}`} alt={`Aperçu de ${receipt.originalName}`} className="h-full w-full object-cover" /> : <span className="text-xs text-vscode-muted">PDF</span>}</a>{receipt.mimetype.startsWith("image/") && <div className="mt-1 flex justify-center gap-1"><button disabled={busyId === receipt.id || Boolean(importProgress)} onClick={() => void rotate(receipt, -90)} className="rounded border border-vscode-border px-1.5 py-0.5 text-xs disabled:opacity-40" title="Tourner à gauche" aria-label={`Tourner ${receipt.originalName} à gauche`}>↶</button><button disabled={busyId === receipt.id || Boolean(importProgress)} onClick={() => void rotate(receipt, 90)} className="rounded border border-vscode-border px-1.5 py-0.5 text-xs disabled:opacity-40" title="Tourner à droite" aria-label={`Tourner ${receipt.originalName} à droite`}>↷</button></div>}</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-medium">{proposal?.supplier || receipt.originalName}</p><p className="mt-0.5 text-[10px] text-vscode-muted">{proposal?.date || new Date(receipt.createdAt).toLocaleDateString("fr-FR")}{proposal?.amountTtc ? ` · ${proposal.amountTtc.toFixed(2)} € TTC` : " · montant à vérifier"}</p>{proposal?.invoiceRef && <p className="mt-0.5 truncate text-[10px] text-blue-300">Référence : {proposal.invoiceRef}</p>}</div><button disabled={busyId === receipt.id} onClick={() => void remove(receipt)} className="text-xs text-vscode-muted hover:text-red-400 disabled:opacity-40" aria-label={`Supprimer ${receipt.originalName}`}>Supprimer</button></div>
            <div className="mt-1 flex flex-wrap items-center gap-2"><p className={`text-[10px] ${receipt.ocr.validatedAt ? "text-blue-300" : receipt.ocr.status === "success" ? "text-green-400" : "text-amber-400"}`}>{receipt.ocr.validatedAt ? "Vérifié manuellement" : receipt.ocr.status === "success" ? "OCR terminé" : "OCR à reprendre ou saisie manuelle"}</p>{receipt.ocr.status !== "success" && !importProgress && <button onClick={() => void analyzeReceipts([receipt])} className="text-[10px] text-vscode-accent hover:underline">Relancer</button>}<button onClick={() => setEditingReceipt(receipt)} className="text-[10px] text-vscode-accent hover:underline">Vérifier / corriger</button>{receipt.mimetype.startsWith("image/") && <><button disabled={busyId === receipt.id} onClick={() => void transform(receipt, "enhance")} className="text-[10px] text-vscode-accent hover:underline disabled:opacity-40">Contraste + OCR</button><button disabled={busyId === receipt.id} onClick={() => void transform(receipt, "crop")} className="text-[10px] text-vscode-accent hover:underline disabled:opacity-40">Recadrer + OCR</button></>}</div>
            {proposal && <div className="mt-1.5 rounded bg-vscode-bg/60 px-2 py-1.5 text-[10px] text-vscode-muted"><p>HT {euros(proposal.amountHt)} · TVA {euros(amountVat)} · TTC {euros(proposal.amountTtc)}</p>{proposal.vatSplits.map((split, index) => { const splitHt = split.amountHt ?? split.amountTtc / (1 + split.rate / 100); const splitVat = split.amountVat ?? split.amountTtc - splitHt; return <p key={`${split.rate}-${index}`} className="mt-0.5 text-vscode-text">TVA {split.rate} % : HT {euros(splitHt)} · TVA {euros(splitVat)} · TTC {euros(split.amountTtc)}</p>; })}</div>}
            {suggestedTransaction && <div className="mt-2 flex items-center gap-2 rounded border border-green-800/60 bg-green-950/20 px-2 py-1.5"><div className="min-w-0 flex-1"><p className="truncate text-[10px] text-green-300">Proposition {suggestion.confidence} ({suggestion.score}) : {suggestedTransaction.date} · {suggestedTransaction.label} · {Math.abs(suggestedTransaction.amount_ttc).toFixed(2)} €</p><p className="truncate text-[10px] text-vscode-muted">{suggestion.reasons.join(" · ")}</p></div><button disabled={busyId === receipt.id} onClick={() => void link(receipt, suggestedTransaction.id)} className="shrink-0 rounded bg-green-700 px-2 py-1 text-[10px] text-white disabled:opacity-40">Valider</button></div>}
            {proposal?.amountTtc && !suggestedTransaction && <p className="mt-2 rounded border border-vscode-border bg-vscode-bg/50 px-2 py-1.5 text-[10px] text-vscode-muted">Aucune transaction du même montant.</p>}
            <div className="mt-2 flex gap-2"><div className="relative min-w-0 flex-1"><input aria-label={`Rechercher une transaction pour ${receipt.originalName}`} value={searchValue} onFocus={() => setFocusedSearch(receipt.id)} onBlur={() => window.setTimeout(() => setFocusedSearch((current) => current === receipt.id ? "" : current), 120)} onChange={(event) => { setSearchByReceipt((current) => ({ ...current, [receipt.id]: event.target.value })); setTargetByReceipt((current) => ({ ...current, [receipt.id]: "" })); }} placeholder="Rechercher par nom, montant ou date…" className="w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs" />{focusedSearch === receipt.id && <div className="absolute bottom-full z-30 mb-1 max-h-48 w-full overflow-y-auto rounded border border-vscode-border bg-vscode-panel shadow-xl">{searchResults.length ? searchResults.map((transaction) => <button key={transaction.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { setTargetByReceipt((current) => ({ ...current, [receipt.id]: transaction.id })); setSearchByReceipt((current) => ({ ...current, [receipt.id]: transactionLabel(transaction) })); setFocusedSearch(""); }} className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-vscode-border">{transactionLabel(transaction)}</button>) : <p className="px-2 py-2 text-xs text-vscode-muted">Aucune transaction trouvée</p>}</div>}</div><button disabled={!target || busyId === receipt.id} onClick={() => void link(receipt, target)} className="rounded bg-amber-700 px-3 py-1 text-xs text-white disabled:opacity-40">Associer</button></div>
          </div>
        </article>;
      })}
    </div>}
    {editingReceipt && <PendingReceiptEditor receipt={editingReceipt} onSave={saveCorrection} onClose={() => setEditingReceipt(null)} />}
  </section>;
}
