import { useEffect, useRef, useState, useCallback } from "react";
import { searchWorkspace, SearchResult } from "../../api/search";
import { useAppStore } from "../../stores/appStore";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
}

const FILE_ICONS: Record<string, string> = {
  yaml: "📋", yml: "📋", md: "📝", json: "{ }", csv: "📊", pdf: "📄",
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Met en évidence les occurrences de `query` dans `text`. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-yellow-400/30 text-yellow-300 rounded px-0.5">{p}</mark>
          : p
      )}
    </>
  );
}

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const { categories } = useCategoryCatalog();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openTab } = useAppStore();

  const debouncedQuery = useDebounce(query, 200);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!debouncedQuery.trim()) { setResults([]); return; }
    setLoading(true);
    searchWorkspace(debouncedQuery)
      .then((r) => { setResults(r); setSelectedIdx(0); })
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  const handleSelect = useCallback((result: SearchResult) => {
    if (result.type === "file" && result.filePath) {
      openTab({
        id: `file:${result.filePath}`,
        title: result.fileName ?? result.filePath,
        type: "editor",
        path: result.filePath,
      });
    } else if (result.type === "transaction") {
      openTab({ id: "transactions", title: "Transactions", type: "transactions" });
    }
    onClose();
  }, [openTab, onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[selectedIdx]) { handleSelect(results[selectedIdx]); }
  }

  if (!open) return null;

  const transactions = results.filter((r) => r.type === "transaction");
  const files = results.filter((r) => r.type === "file");

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[600px] bg-vscode-sidebar border border-vscode-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-vscode-border">
          <span className="text-vscode-muted text-sm">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Rechercher transactions, fichiers…"
            className="flex-1 bg-transparent text-vscode-text text-sm focus:outline-none placeholder-vscode-muted"
          />
          {loading && <span className="text-vscode-muted text-xs animate-pulse">…</span>}
          <kbd className="text-[10px] text-vscode-muted bg-vscode-border px-1.5 py-0.5 rounded">Échap</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {results.length === 0 && query.trim() && !loading && (
            <div className="text-vscode-muted text-xs px-4 py-6 text-center">
              Aucun résultat pour « {query} »
            </div>
          )}

          {query.trim() === "" && (
            <div className="text-vscode-muted text-xs px-4 py-6 text-center">
              Tapez pour rechercher dans le workspace
            </div>
          )}

          {/* Transactions */}
          {transactions.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-vscode-muted bg-vscode-panel border-b border-vscode-border">
                Transactions
              </div>
              {transactions.map((r, i) => {
                const globalIdx = i;
                return (
                  <ResultRow
                    key={r.transaction?.id}
                    selected={selectedIdx === globalIdx}
                    onClick={() => handleSelect(r)}
                  >
                    <span className="text-vscode-muted shrink-0 text-xs w-20">{r.transaction?.date}</span>
                    <span className="flex-1 truncate text-xs">
                      <Highlight text={r.transaction?.label ?? ""} query={query} />
                    </span>
                    <span className={`text-xs font-mono shrink-0 ${(r.transaction?.amount_ttc ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {(r.transaction?.amount_ttc ?? 0) >= 0 ? "+" : ""}
                      {r.transaction?.amount_ttc?.toFixed(2)} €
                    </span>
                    <span className="text-vscode-muted text-[10px] shrink-0 ml-2">{categories.find((category) => category.id === r.transaction?.category)?.label ?? r.transaction?.category}</span>
                  </ResultRow>
                );
              })}
            </>
          )}

          {/* Files */}
          {files.length > 0 && (
            <>
              <div className="px-4 py-1.5 text-[10px] uppercase tracking-widest text-vscode-muted bg-vscode-panel border-b border-vscode-border">
                Fichiers
              </div>
              {files.map((r, i) => {
                const globalIdx = transactions.length + i;
                return (
                  <ResultRow
                    key={r.filePath}
                    selected={selectedIdx === globalIdx}
                    onClick={() => handleSelect(r)}
                  >
                    <span className="shrink-0 text-sm">{FILE_ICONS[r.extension ?? ""] ?? "📄"}</span>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs truncate">
                        <Highlight text={r.fileName ?? ""} query={query} />
                      </span>
                      {r.excerpt && (
                        <span className="text-[10px] text-vscode-muted truncate">
                          <Highlight text={r.excerpt} query={query} />
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-vscode-muted shrink-0 ml-2 font-mono truncate max-w-[200px]">
                      {r.filePath}
                    </span>
                  </ResultRow>
                );
              })}
            </>
          )}
        </div>

        {results.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-1.5 border-t border-vscode-border text-[10px] text-vscode-muted">
            <span>↑↓ naviguer</span>
            <span>↵ ouvrir</span>
            <span>{results.length} résultat{results.length !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultRow({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2 cursor-pointer ${
        selected ? "bg-vscode-highlight" : "hover:bg-vscode-border"
      }`}
    >
      {children}
    </div>
  );
}
