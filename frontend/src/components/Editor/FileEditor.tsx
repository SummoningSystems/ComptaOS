import { useEffect, useRef, useState } from "react";
import { fetchFileContent, rawFileUrl, saveFileContent } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
import { PdfPreview } from "./PdfPreview";

interface FileEditorProps {
  tabId: string;
  path: string;
}

export function FileEditor({ tabId, path }: FileEditorProps) {
  const { markDirty } = useAppStore();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalRef = useRef<string>("");
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  const previewKind = extension === "pdf" ? "pdf" : ["jpg", "jpeg", "png", "webp", "gif"].includes(extension) ? "image" : null;

  useEffect(() => {
    if (previewKind) { setLoading(false); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchFileContent(path)
      .then((text) => {
        if (cancelled) return;
        setContent(text);
        originalRef.current = text;
        markDirty(tabId, false);
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de lire le fichier");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [path, previewKind]);

  function handleChange(value: string) {
    setContent(value);
    markDirty(tabId, value !== originalRef.current);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveFileContent(path, content);
      originalRef.current = content;
      markDirty(tabId, false);
    } catch {
      setError("Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  // Ctrl+S / Cmd+S
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content]);

  if (previewKind) {
    const url = rawFileUrl(path);
    return <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-vscode-border bg-vscode-panel px-3 py-1">
        <span className="truncate text-xs text-vscode-muted">{path}</span>
        <a href={url} target="_blank" rel="noreferrer" className="rounded bg-vscode-accent px-2 py-0.5 text-xs text-white">Ouvrir / télécharger</a>
      </div>
      {previewKind === "pdf"
        ? <PdfPreview url={url} title={`Aperçu de ${path}`} />
        : <div className="min-h-0 flex-1 overflow-auto bg-black/20 p-4"><img src={url} alt={`Aperçu de ${path}`} className="mx-auto max-h-full max-w-full object-contain" /></div>}
    </div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Chargement…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1 bg-vscode-panel border-b border-vscode-border shrink-0">
        <span className="text-vscode-muted text-xs truncate">{path}</span>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-vscode-accent hover:bg-blue-600 disabled:opacity-50 text-white px-2 py-0.5 rounded transition-colors"
        >
          {saving ? "Sauvegarde…" : "Sauvegarder"}
        </button>
      </div>

      <textarea
        aria-label={`Contenu de ${path}`}
        value={content}
        onChange={(event) => handleChange(event.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none overflow-auto whitespace-pre border-0 bg-vscode-bg p-3 font-mono text-[13px] leading-5 text-vscode-text outline-none"
      />
    </div>
  );
}
