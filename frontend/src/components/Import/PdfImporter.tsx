import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { uploadInvoicePdf } from "../../api/client";
import { Invoice, Category } from "../../types";

const CATEGORIES: Category[] = [
  "hosting", "software", "salary", "travel", "restaurant",
  "taxes", "equipment", "subscription", "misc",
];

export function PdfImporter() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<Partial<Invoice> | null>(null);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setInvoice(null);
    setRawText("");
    setLoading(true);
    try {
      const result = await uploadInvoicePdf(file);
      setInvoice(result.invoice);
      setRawText(result.rawText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors du traitement";
      setError(msg.includes("503") ? "Le service OCR local est indisponible. Tu peux saisir la facture manuellement." : msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    maxFiles: 1,
  });

  function reset() {
    setInvoice(null);
    setRawText("");
    setError(null);
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-vscode-text text-sm font-semibold">OCR Factures PDF</h2>
        <div className="text-[10px] text-vscode-muted bg-vscode-panel px-2 py-0.5 rounded border border-vscode-border">
          OCR local — aucune facture envoyée à un service payant
        </div>
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Drop zone */}
      {!invoice && (
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors
            ${isDragActive
              ? "border-vscode-accent bg-blue-900/20"
              : "border-vscode-border hover:border-vscode-accent"
            }
          `}
        >
          <input {...getInputProps()} />
          <div className="text-4xl mb-3">📄</div>
          <p className="text-vscode-text text-sm">
            {isDragActive ? "Déposez la facture PDF…" : "Glissez-déposez une facture PDF"}
          </p>
          <p className="text-vscode-muted text-xs mt-1">
            {loading ? "Extraction OCR locale en cours…" : "Extraire avec l’OCR local"}
          </p>
          {loading && (
            <div className="mt-4 flex justify-center gap-1">
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-2 h-2 bg-purple-500 rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>
      )}

      {/* Résultat */}
      {invoice && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-900/30 border border-green-700 text-green-300 text-xs rounded px-3 py-2">
            ✓ Facture extraite avec succès — vérifiez et complétez si nécessaire
          </div>

          <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4 grid grid-cols-2 gap-4">
            {/* Fournisseur */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Fournisseur</label>
              <input
                value={invoice.supplier ?? ""}
                onChange={(e) => setInvoice((i) => ({ ...i, supplier: e.target.value }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              />
            </div>

            {/* Date */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Date</label>
              <input
                type="date"
                value={invoice.date ?? ""}
                onChange={(e) => setInvoice((i) => ({ ...i, date: e.target.value }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
              />
            </div>

            {/* Montant HT */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Montant HT (€)</label>
              <input
                type="number"
                value={invoice.amount_ht ?? 0}
                onChange={(e) => setInvoice((i) => ({ ...i, amount_ht: parseFloat(e.target.value) }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent font-mono"
              />
            </div>

            {/* Montant TTC */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Montant TTC (€)</label>
              <input
                type="number"
                value={invoice.amount_ttc ?? 0}
                onChange={(e) => setInvoice((i) => ({ ...i, amount_ttc: parseFloat(e.target.value) }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent font-mono"
              />
            </div>

            {/* Taux TVA */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Taux TVA</label>
              <select
                value={invoice.vat_rate ?? 20}
                onChange={(e) => setInvoice((i) => ({ ...i, vat_rate: parseFloat(e.target.value) }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none"
              >
                {[0, 5.5, 10, 20].map((r) => <option key={r} value={r}>{r}%</option>)}
              </select>
            </div>

            {/* Catégorie */}
            <div className="flex flex-col gap-1">
              <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Catégorie</label>
              <select
                value={invoice.category ?? "misc"}
                onChange={(e) => setInvoice((i) => ({ ...i, category: e.target.value as Category }))}
                className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>

            {/* Fichier */}
            {invoice.file && (
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-vscode-muted text-[11px] uppercase tracking-wider">Fichier sauvegardé</label>
                <span className="text-vscode-text text-xs font-mono">{invoice.file}</span>
              </div>
            )}
          </div>

          {/* Texte brut OCR */}
          <button
            onClick={() => setShowRaw((v) => !v)}
            className="text-xs text-vscode-muted hover:text-vscode-text text-left"
          >
            {showRaw ? "▾" : "▸"} Texte extrait par OCR
          </button>
          {showRaw && (
            <pre className="bg-vscode-bg border border-vscode-border rounded p-3 text-[11px] text-vscode-muted font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
              {rawText}
            </pre>
          )}

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="text-xs text-vscode-muted hover:text-vscode-text px-3 py-1 border border-vscode-border rounded"
            >
              ← Nouvelle facture
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
