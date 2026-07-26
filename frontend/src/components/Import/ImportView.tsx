import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { api } from "../../api/client";
import { CsvImporter } from "./CsvImporter";

type ImportTab = "csv" | "ofx" | "qif";

interface ImportResult {
  imported: number;
  skipped: number;
}

function FileImporter({
  format,
  accept,
  endpoint,
}: {
  format: "OFX" | "QIF";
  accept: Record<string, string[]>;
  endpoint: string;
}) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept, multiple: false });

  async function handleImport() {
    if (!content.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data } = await api.post<ImportResult>(endpoint, { content });
      setResult(data);
      setContent("");
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (e as { message?: string })?.message ??
        "Erreur inconnue";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto mt-8 space-y-4">
      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          isDragActive ? "border-vscode-accent bg-vscode-accent/10" : "border-vscode-border hover:border-vscode-accent/50"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-vscode-muted text-sm">
          {isDragActive
            ? `Déposez le fichier ${format}…`
            : `Glissez-déposez un fichier ${format} ici, ou cliquez pour parcourir`}
        </p>
        <p className="text-vscode-muted text-xs mt-1">Format supporté : .{format.toLowerCase()}</p>
      </div>

      {/* Ou coller le contenu */}
      <div>
        <label className="text-vscode-muted text-xs block mb-1">Ou coller le contenu {format} directement :</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder={`Collez ici le contenu ${format}…`}
          className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs font-mono px-3 py-2 rounded resize-y focus:outline-none focus:border-vscode-accent"
        />
      </div>

      {content.trim() && (
        <button
          onClick={handleImport}
          disabled={loading}
          className="flex items-center gap-1.5 bg-vscode-accent hover:bg-blue-600 text-white text-xs px-4 py-2 rounded disabled:opacity-50"
        >
          {loading ? "Import en cours…" : `⚡ Importer le fichier ${format}`}
        </button>
      )}

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-xs px-4 py-3 rounded">
          {error}
        </div>
      )}

      {result && (
        <div className="bg-green-900/20 border border-green-700 text-green-300 text-xs px-4 py-3 rounded">
          ✅ {result.imported} transaction{result.imported > 1 ? "s" : ""} importée{result.imported > 1 ? "s" : ""}
          {result.skipped > 0 && <span className="text-vscode-muted ml-2">({result.skipped} doublon{result.skipped > 1 ? "s" : ""} ignoré{result.skipped > 1 ? "s" : ""})</span>}
        </div>
      )}
    </div>
  );
}

export function ImportView() {
  const [activeTab, setActiveTab] = useState<ImportTab>("csv");

  const TABS: { id: ImportTab; label: string; desc: string }[] = [
    { id: "csv",  label: "CSV / Excel", desc: "Importez un fichier CSV ou XLSX avec mapping des colonnes" },
    { id: "ofx",  label: "OFX / OFC",   desc: "Format bancaire Open Financial Exchange" },
    { id: "qif",  label: "QIF",          desc: "Quicken Interchange Format" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tabs */}
      <div className="flex items-end gap-0 px-4 border-b border-vscode-border bg-vscode-panel shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-xs border-b-2 transition-colors ${
              activeTab === t.id
                ? "text-vscode-text border-vscode-accent"
                : "text-vscode-muted border-transparent hover:text-vscode-text"
            }`}
          >
            {t.label}
          </button>
        ))}
        <p className="ml-auto text-[10px] text-vscode-muted pb-2">
          {TABS.find((t) => t.id === activeTab)?.desc}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === "csv" && <CsvImporter />}
        {activeTab === "ofx" && (
          <FileImporter
            format="OFX"
            accept={{ "application/x-ofx": [".ofx", ".ofc"] }}
            endpoint="/import/ofx"
          />
        )}
        {activeTab === "qif" && (
          <FileImporter
            format="QIF"
            accept={{ "application/x-qif": [".qif"] }}
            endpoint="/import/qif"
          />
        )}
      </div>
    </div>
  );
}
