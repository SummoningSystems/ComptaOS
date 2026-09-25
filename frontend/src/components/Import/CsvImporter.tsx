import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import * as XLSX from "xlsx";
import {useWorkspaceApi} from '../../api/WorkspaceApi';
import { CsvMappingConfig, Transaction } from "../../types";

type Step = "drop" | "mapping" | "preview" | "done";

export function CsvImporter() {
 const {previewCsv,importCsv,fetchSmartSuggestions,applySmartCategories}=useWorkspaceApi();

  const [step, setStep] = useState<Step>("drop");
  const [rawContent, setRawContent] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [samples, setSamples] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Partial<CsvMappingConfig>>({});
  const [imported, setImported] = useState<Transaction[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [autoCatCount, setAutoCatCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      let text: string;
      const isXlsx = file.name.toLowerCase().endsWith(".xlsx") || file.name.toLowerCase().endsWith(".xls");
      if (isXlsx) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        text = XLSX.utils.sheet_to_csv(ws, { FS: "," });
      } else {
        text = await file.text();
      }
      setRawContent(text);
      const preview = await previewCsv(text);
      setColumns(preview.columns);
      setSamples(preview.samples);
      // Auto-mapping heuristique
      const lower = preview.columns.map((c) => c.toLowerCase());
      setMapping({
        date: preview.columns[lower.findIndex((c) => c.includes("date"))] ?? preview.columns[0],
        label: preview.columns[lower.findIndex((c) => c.includes("lib") || c.includes("label") || c.includes("desc"))] ?? preview.columns[1],
        amount: preview.columns[lower.findIndex((c) => c.includes("mont") || c.includes("amount") || c.includes("solde"))] ?? preview.columns[2],
        notes: preview.columns[lower.findIndex((c) => c.includes("tiers") || c.includes("contre") || c.includes("bénéf") || c.includes("benef") || c.includes("comment"))] || undefined,        status_col: preview.columns[lower.findIndex((c) => c.includes("\u00e9tat") || c.includes("etat") || c.includes("status"))] || undefined,
        category_col: preview.columns[lower.findIndex((c) => c.includes("types de d\u00e9penses") || c.includes("cat\u00e9gorie") || c.includes("categorie"))] || undefined,      });
      setStep("mapping");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de la lecture");
    } finally {
      setLoading(false);
    }
  }, [previewCsv]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "text/csv": [".csv"],
      "text/plain": [".csv", ".txt"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
      "application/vnd.ms-excel": [".xls"],
    },
    maxFiles: 1,
  });

  async function handleImport() {
    if (!mapping.date || !mapping.label || (!mapping.amount && !mapping.debit)) {
      setError("Veuillez mapper au minimum : date, libellé et montant");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await importCsv(rawContent, mapping as CsvMappingConfig);
      setImported(result.transactions);
      setSkipped(result.skipped ?? 0);
      // Auto-catégorisation: appliquer les patterns high-confidence sur les nouvelles transactions "misc"
      const newMiscIds = new Set(result.transactions.filter((t) => t.category === "misc").map((t) => t.id));
      if (newMiscIds.size > 0) {
        try {
          const { suggestions } = await fetchSmartSuggestions();
          const toApply = suggestions.filter((s) => newMiscIds.has(s.id) && s.confidenceLevel === "high");
          if (toApply.length > 0) {
            await applySmartCategories(toApply.map((s) => ({ id: s.id, category: s.suggestedCategory })));
            setAutoCatCount(toApply.length);
          }
        } catch {
          // La smart-catégorisation est non bloquante
        }
      }
      setStep("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erreur lors de l'import");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setStep("drop");
    setRawContent("");
    setColumns([]);
    setSamples([]);
    setMapping({});
    setImported([]);      setSkipped(0);    setError(null);    setAutoCatCount(0);
  }

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      <h2 className="text-vscode-text text-sm font-semibold">Import bancaire CSV</h2>

      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 text-xs rounded px-3 py-2">
          {error}
        </div>
      )}

      {/* Step 1 — Drop */}
      {step === "drop" && (
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
          <div className="text-4xl mb-3">📊</div>
          <p className="text-vscode-text text-sm">
            {isDragActive ? "Déposez le fichier ici…" : "Glissez-déposez un fichier CSV ou XLSX"}
          </p>
          <p className="text-vscode-muted text-xs mt-1">ou cliquez pour sélectionner (.csv, .xlsx)</p>
          {loading && <p className="text-vscode-muted text-xs mt-3">Analyse en cours…</p>}
        </div>
      )}

      {/* Step 2 — Mapping */}
      {step === "mapping" && (
        <div className="flex flex-col gap-4">
          <p className="text-vscode-muted text-xs">
            {columns.length} colonnes détectées. Associez chaque champ requis à une colonne du CSV.
          </p>

          {/* Presets */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-vscode-muted uppercase tracking-wide">Preset :</span>
            <button
              onClick={() => setMapping({
                date: "Date",
                label: "Libellé",
                amount: "Montant",
                notes: "Tiers",
                status_col: "État",
                category_col: "Types de dépenses / revenus",
              })}
              className="text-[10px] px-2 py-0.5 rounded border border-vscode-accent text-vscode-accent hover:bg-vscode-accent hover:text-white transition-colors"
            >
              🏦 Legalstart / Swan
            </button>
          </div>

          {/* Prévisualisation */}
          <div className="overflow-x-auto rounded border border-vscode-border">
            <table className="text-xs w-full">
              <thead className="bg-vscode-panel">
                <tr>
                  {columns.map((c) => (
                    <th key={c} className="text-left px-2 py-1.5 text-vscode-muted">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {samples.map((row, i) => (
                  <tr key={i} className="border-t border-vscode-border">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1 text-vscode-text">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mapping fields */}
          <div className="grid grid-cols-2 gap-4">
            {(["date", "label", "amount", "debit", "credit", "notes", "status_col", "category_col"] as const).map((field) => (
              <div key={field} className="flex flex-col gap-1">
                <label className="text-vscode-muted text-xs">
                  {field}{["date", "label"].includes(field) ? " *" : ""}
                  {field === "notes" && <span className="ml-1 text-[10px] opacity-60">(tiers / contrepartie)</span>}
                  {field === "status_col" && <span className="ml-1 text-[10px] opacity-60">(filtre 'Transaction rejet\u00e9e')</span>}
                  {field === "category_col" && <span className="ml-1 text-[10px] opacity-60">(cat\u00e9gorie Penylane)</span>}
                </label>
                <select
                  value={mapping[field] ?? ""}
                  onChange={(e) =>
                    setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))
                  }
                  className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
                >
                  <option value="">— ignorer —</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={reset}
              className="text-xs text-vscode-muted hover:text-vscode-text px-3 py-1 border border-vscode-border rounded"
            >
              ← Retour
            </button>
            <button
              onClick={handleImport}
              disabled={loading}
              className="text-xs bg-vscode-accent hover:bg-blue-600 disabled:opacity-50 text-white px-4 py-1 rounded"
            >
              {loading ? "Import en cours…" : "Importer"}
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Done */}
      {step === "done" && (
        <div className="flex flex-col gap-4">
          <div className="bg-green-900/40 border border-green-700 text-green-300 text-sm rounded px-4 py-3">
            ✓ {imported.length} transaction{imported.length !== 1 ? "s" : ""} importée{imported.length !== 1 ? "s" : ""} avec succès
            {skipped > 0 && <span className="text-yellow-300 ml-3">⚠️ {skipped} doublon{skipped > 1 ? "s" : ""} ignoré{skipped > 1 ? "s" : ""}</span>}
            {autoCatCount > 0 && (
              <span className="ml-3 inline-flex items-center gap-1 text-purple-300">
                ✨ {autoCatCount} auto-catégorisée{autoCatCount > 1 ? "s" : ""} (high confidence)
              </span>
            )}
          </div>

          <div className="overflow-x-auto rounded border border-vscode-border max-h-80">
            <table className="text-xs w-full">
              <thead className="sticky top-0 bg-vscode-panel border-b border-vscode-border">
                <tr>
                  {["Date", "Libellé", "Montant TTC", "Statut"].map((h) => (
                    <th key={h} className="text-left px-2 py-1.5 text-vscode-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {imported.map((t) => (
                  <tr key={t.id} className="border-t border-vscode-border">
                    <td className="px-2 py-1 text-vscode-muted">{t.date}</td>
                    <td className="px-2 py-1 max-w-xs truncate">{t.label}</td>
                    <td className={`px-2 py-1 font-mono ${t.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {t.amount_ttc.toFixed(2)} €
                    </td>
                    <td className="px-2 py-1 text-yellow-400">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            onClick={reset}
            className="text-xs text-vscode-muted hover:text-vscode-text px-3 py-1 border border-vscode-border rounded w-fit"
          >
            Importer un autre fichier
          </button>
        </div>
      )}
    </div>
  );
}
