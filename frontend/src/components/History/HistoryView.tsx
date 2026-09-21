import { useEffect, useMemo, useState } from "react";
import {GitCommit} from '../../api/client';
import {useWorkspaceApi} from '../../api/WorkspaceApi';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

type CommitCategory = "all" | "init" | "import" | "ajout" | "maj" | "suppression" | "catégorisation" | "autre";

const CATEGORIES: { id: CommitCategory; label: string; icon: string; color: string }[] = [
  { id: "all",           label: "Tous",           icon: "📋", color: "text-vscode-text   border-vscode-border" },
  { id: "init",          label: "Init",           icon: "🏁", color: "text-purple-300   border-purple-700" },
  { id: "import",        label: "Import",         icon: "📥", color: "text-blue-300     border-blue-700" },
  { id: "ajout",         label: "Ajout",          icon: "➕", color: "text-green-300    border-green-700" },
  { id: "maj",           label: "Modif",          icon: "✏️", color: "text-yellow-300   border-yellow-700" },
  { id: "suppression",   label: "Suppression",    icon: "🗑", color: "text-red-300      border-red-700" },
  { id: "catégorisation",label: "Catégorisation", icon: "🏷", color: "text-orange-300   border-orange-700" },
  { id: "autre",         label: "Autre",          icon: "📝", color: "text-vscode-muted border-vscode-border" },
];

function getCategory(message: string): CommitCategory {
  const m = message.toLowerCase();
  if (m.startsWith("init"))         return "init";
  if (m.startsWith("import"))       return "import";
  if (m.startsWith("ajout"))        return "ajout";
  if (m.startsWith("maj") || m.startsWith("mise à jour")) return "maj";
  if (m.startsWith("suppression"))  return "suppression";
  if (m.startsWith("catég"))        return "catégorisation";
  return "autre";
}

function commitIcon(message: string): string {
  const cat = getCategory(message);
  return CATEGORIES.find((c) => c.id === cat)?.icon ?? "📝";
}

function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div className="font-mono text-[11px] leading-5 overflow-x-auto">
      {lines.map((line, i) => {
        let cls = "text-vscode-muted";
        if (line.startsWith("+") && !line.startsWith("+++")) cls = "text-green-400 bg-green-900/20";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "text-red-400 bg-red-900/20";
        else if (line.startsWith("@@")) cls = "text-blue-400 bg-blue-900/20";
        else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) cls = "text-vscode-muted";
        else if (line.startsWith("commit ") || line.startsWith("Author:") || line.startsWith("Date:")) cls = "text-yellow-300";
        return (
          <div key={i} className={`px-3 whitespace-pre ${cls}`}>{line || " "}</div>
        );
      })}
    </div>
  );
}

export function HistoryView() {
 const {fetchGitLog,fetchGitDiff}=useWorkspaceApi();

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [initialized, setInitialized] = useState(true);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeCategory, setActiveCategory] = useState<CommitCategory>("all");

  // Comptage par catégorie
  const counts = useMemo(() => {
    const map: Partial<Record<CommitCategory, number>> = { all: commits.length };
    for (const c of commits) {
      const cat = getCategory(c.message);
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return map;
  }, [commits]);

  async function loadLog() {
    setLoading(true);
    try {
      const res = await fetchGitLog();
      setCommits(res.commits);
      setInitialized(res.initialized);
      if (res.commits.length > 0 && !selected) {
        handleSelect(res.commits[0].hash);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(hash: string) {
    setSelected(hash);
    setDiff(null);
    setDiffLoading(true);
    try {
      const d = await fetchGitDiff(hash);
      setDiff(d);
    } finally {
      setDiffLoading(false);
    }
  }

  // Load the initial history once; subsequent refreshes use the explicit reload action.
  useEffect(() => { void loadLog(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let list = commits;
    if (activeCategory !== "all") {
      list = list.filter((c) => getCategory(c.message) === activeCategory);
    }
    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((c) => c.message.toLowerCase().includes(q) || c.shortHash.includes(q));
    }
    return list;
  }, [commits, activeCategory, filter]);

  if (!initialized && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-vscode-muted gap-3">
        <span className="text-4xl">📭</span>
        <p className="text-sm">Dépôt Git pas encore initialisé.</p>
        <p className="text-xs">Redémarrez le backend pour l'initialiser automatiquement.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Liste des commits ── */}
      <div className="w-80 shrink-0 flex flex-col border-r border-vscode-border">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-vscode-border shrink-0">
          <span className="text-vscode-text text-xs font-semibold flex-1">Historique</span>
          <button
            onClick={loadLog}
            title="Rafraîchir"
            className="text-vscode-muted hover:text-vscode-text text-xs px-1"
          >
            ↺
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-vscode-border shrink-0">
          <input
            type="text"
            placeholder="Filtrer…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded focus:outline-none focus:border-vscode-accent"
          />
        </div>

        {/* Catégories */}
        <div className="px-2 py-2 border-b border-vscode-border shrink-0 flex flex-wrap gap-1">
          {CATEGORIES.filter((cat) => cat.id === "all" || (counts[cat.id] ?? 0) > 0).map((cat) => {
            const count = counts[cat.id] ?? 0;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] transition-colors ${
                  isActive
                    ? `${cat.color} bg-vscode-panel font-semibold`
                    : "text-vscode-muted border-vscode-border/50 hover:border-vscode-border hover:text-vscode-text"
                }`}
                title={cat.label}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
                <span className={`rounded-full px-1 py-px text-[9px] ${isActive ? "bg-white/10" : "bg-vscode-border/40"}`}>
                  {cat.id === "all" ? commits.length : count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Commits */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-20 text-vscode-muted text-xs">
              Chargement…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="flex items-center justify-center h-20 text-vscode-muted text-xs">
              Aucun commit
            </div>
          )}
          {filtered.map((c) => (
            <button
              key={c.hash}
              onClick={() => handleSelect(c.hash)}
              className={`w-full text-left px-3 py-2.5 border-b border-vscode-border/40 transition-colors ${
                selected === c.hash
                  ? "bg-vscode-accent/20 border-l-2 border-l-vscode-accent"
                  : "hover:bg-vscode-panel border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-sm">{commitIcon(c.message)}</span>
                <span className="font-mono text-[10px] text-vscode-muted">{c.shortHash}</span>
                {c.filesChanged > 0 && (
                  <span className="ml-auto text-[10px] text-vscode-muted">{c.filesChanged} fichier{c.filesChanged > 1 ? "s" : ""}</span>
                )}
              </div>
              <p className="text-xs text-vscode-text leading-tight line-clamp-2">{c.message}</p>
              <p className="text-[10px] text-vscode-muted mt-1">{formatDate(c.date)}</p>
            </button>
          ))}
        </div>

        {/* Footer stat */}
        {!loading && commits.length > 0 && (
          <div className="px-3 py-1.5 border-t border-vscode-border shrink-0">
            <p className="text-[10px] text-vscode-muted">{commits.length} commit{commits.length > 1 ? "s" : ""}</p>
          </div>
        )}
      </div>

      {/* ── Diff panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selected && !diffLoading && (
          <div className="flex flex-col items-center justify-center h-full text-vscode-muted gap-2">
            <span className="text-4xl">🔍</span>
            <p className="text-sm">Sélectionnez un commit pour voir le diff.</p>
          </div>
        )}

        {diffLoading && (
          <div className="flex items-center justify-center h-full text-vscode-muted text-xs">
            Chargement du diff…
          </div>
        )}

        {diff !== null && !diffLoading && (
          <>
            {/* Diff header */}
            {selected && (() => {
              const c = commits.find((x) => x.hash === selected);
              return c ? (
                <div className="flex items-center gap-3 px-4 py-2.5 border-b border-vscode-border shrink-0 bg-vscode-panel">
                  <span className="text-base">{commitIcon(c.message)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-vscode-text truncate">{c.message}</p>
                    <p className="text-[10px] text-vscode-muted">{formatDate(c.date)} · {c.shortHash}</p>
                  </div>
                </div>
              ) : null;
            })()}

            {/* Diff content */}
            <div className="flex-1 overflow-auto bg-vscode-bg">
              {diff ? (
                <DiffViewer diff={diff} />
              ) : (
                <div className="flex items-center justify-center h-full text-vscode-muted text-xs">
                  Aucun changement dans ce commit.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
