import { lazy, Suspense, useEffect, useState } from "react";
import { fetchAttachmentBlob, type ReceiptOcrProposal } from "../../api/client";
import type { Category, Transaction } from "../../types";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";

const VAT_RATES = [0, 2.1, 5.5, 10, 20];
const PdfPreview = lazy(() => import("../Editor/PdfPreview").then((module) => ({ default: module.PdfPreview })));
const CONFIDENCE_LABELS: Record<ReceiptOcrProposal["confidence"], string> = { high: "élevée", medium: "moyenne", low: "faible" };
interface Props { transaction: Transaction; proposal: ReceiptOcrProposal; onApply: (values: { category: Category; invoiceRef?: string; vatSplits: Array<{ rate: number; amountTtc: number }> }) => Promise<void>; onClose: () => void }

export function ReceiptOcrDialog({ transaction, proposal, onApply, onClose }: Props) {
  const { categories } = useCategoryCatalog();
  const filename = transaction.attachments?.at(-1) ?? transaction.attachment;
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewPdfData, setPreviewPdfData] = useState<Uint8Array>();
  const [previewError, setPreviewError] = useState("");
  const isPdf = filename?.toLowerCase().endsWith(".pdf") ?? false;
  const bankTotal = Math.abs(transaction.amount_ttc);
  const initial = proposal.vatSplits.length ? proposal.vatSplits : [{ rate: 0, amountTtc: bankTotal }];
  const [category, setCategory] = useState<Category>(proposal.category);
  const [invoiceRef, setInvoiceRef] = useState(proposal.invoiceRef ?? "");
  const [splits, setSplits] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!filename) return;
    let active = true;
    let objectUrl = "";
    fetchAttachmentBlob(filename).then(async (blob) => {
      objectUrl = URL.createObjectURL(blob);
      const pdfData = isPdf ? new Uint8Array(await blob.arrayBuffer()) : undefined;
      if (active) { setPreviewUrl(objectUrl); setPreviewPdfData(pdfData); }
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => { if (active) setPreviewError("Impossible d’afficher la pièce justificative."); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [filename, isPdf]);

  const splitTotal = Math.round(splits.reduce((sum, split) => sum + split.amountTtc, 0) * 100) / 100;
  const balanced = Math.abs(splitTotal - bankTotal) < 0.01;
  const receiptMatches = !proposal.amountTtc || Math.abs(proposal.amountTtc - bankTotal) < 0.02;
  const estimatedVat = splits.reduce((sum, split) => sum + split.amountTtc - split.amountTtc / (1 + split.rate / 100), 0);
  function patch(index: number, changes: Partial<(typeof splits)[number]>) { setSplits((current) => current.map((split, row) => row === index ? { ...split, ...changes } : split)); }
  async function apply() { if (!balanced) return; setSaving(true); setError(""); try { await onApply({ category, invoiceRef: invoiceRef.trim() || undefined, vatSplits: splits }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Application impossible"); setSaving(false); } }

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Résultat OCR du justificatif">
    <div className="my-auto max-h-[96dvh] w-full max-w-6xl overflow-y-auto rounded-lg border border-vscode-border bg-vscode-panel p-4 shadow-2xl sm:p-5">
      <div className="flex justify-between gap-3"><div><h2 className="text-sm font-semibold text-vscode-text">Justificatif analysé — vérification requise</h2><p className="mt-1 text-xs text-vscode-muted">{proposal.supplier || "Fournisseur inconnu"}{proposal.date ? ` · ${proposal.date}` : ""} · confiance {CONFIDENCE_LABELS[proposal.confidence]}</p></div><button onClick={onClose} aria-label="Fermer" className="text-vscode-muted">×</button></div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <section className="flex min-h-[360px] max-h-[75dvh] flex-col overflow-hidden rounded border border-vscode-border bg-vscode-bg">
          <div className="flex items-center justify-between border-b border-vscode-border px-3 py-2 text-xs"><span className="truncate text-vscode-muted">{filename ?? "Pièce justificative"}</span>{previewUrl && <a href={previewUrl} target="_blank" rel="noreferrer" className="text-vscode-accent">Ouvrir en grand</a>}</div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">{previewUrl ? isPdf ? previewPdfData ? <Suspense fallback={<p className="text-xs text-vscode-muted">Chargement du lecteur PDF…</p>}><PdfPreview data={previewPdfData} title={filename ?? "Pièce justificative"} /></Suspense> : <p className="text-xs text-vscode-muted">Préparation du PDF…</p> : <img src={previewUrl} alt="Pièce justificative à vérifier" className="max-h-[68dvh] max-w-full object-contain" /> : <p className="text-xs text-vscode-muted">{previewError || "Chargement de la pièce…"}</p>}</div>
        </section>
        <section>
          {!receiptMatches && <p className="rounded border border-amber-700 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">Le justificatif indique {proposal.amountTtc.toFixed(2)} €, mais la banque indique {bankTotal.toFixed(2)} €. Vérifie qu’il s’agit de la bonne pièce.</p>}
          <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-[10px] text-vscode-muted">Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as Category)} className="mt-1 block w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs text-vscode-text">{categories.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label><label className="text-[10px] text-vscode-muted">Référence de la note<input value={invoiceRef} onChange={(event) => setInvoiceRef(event.target.value)} className="mt-1 block w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs text-vscode-text" /></label></div>
          <div className="mt-4"><div className="flex justify-between"><h3 className="text-xs font-semibold text-vscode-text">TVA proposée</h3><span className="text-xs text-vscode-muted">TVA estimée {estimatedVat.toFixed(2)} €</span></div><div className="mt-2 space-y-2">{splits.map((split, index) => <div key={index} className="flex items-center gap-2"><select aria-label={`Taux TVA OCR ${index + 1}`} value={split.rate} onChange={(event) => patch(index, { rate: Number(event.target.value) })} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs text-vscode-text">{VAT_RATES.map((rate) => <option key={rate} value={rate}>{rate} %</option>)}</select><label className="flex items-center gap-1 text-xs text-vscode-muted">TTC<input aria-label={`Montant TTC OCR ${index + 1}`} type="number" min="0" step="0.01" value={split.amountTtc} onChange={(event) => patch(index, { amountTtc: Number(event.target.value) || 0 })} className="w-28 rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-right text-vscode-text" />€</label><button onClick={() => setSplits((current) => current.filter((_, row) => row !== index))} disabled={splits.length === 1} className="text-vscode-muted hover:text-red-400 disabled:opacity-30">×</button></div>)}</div><div className="mt-2 flex items-center gap-3"><button onClick={() => setSplits((current) => [...current, { rate: 0, amountTtc: Math.max(0, Math.round((bankTotal - splitTotal) * 100) / 100) }])} className="text-xs text-vscode-accent">＋ Ajouter un taux</button><span className={`text-xs ${balanced ? "text-green-400" : "text-amber-400"}`}>{balanced ? "Total conforme à la banque" : `Total ${splitTotal.toFixed(2)} € au lieu de ${bankTotal.toFixed(2)} €`}</span></div></div>
          {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
          <div className="mt-5 flex items-center justify-between"><button onClick={onClose} className="text-xs text-vscode-muted hover:text-vscode-text">Fermer et saisir manuellement</button><button onClick={() => void apply()} disabled={!balanced || saving} className="rounded bg-vscode-accent px-4 py-2 text-xs text-white disabled:opacity-40">{saving ? "Application…" : "Appliquer la TVA proposée"}</button></div>
        </section>
      </div>
    </div>
  </div>;
}
