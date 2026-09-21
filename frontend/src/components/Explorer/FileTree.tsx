import { useCallback, useEffect, useState } from "react";
import { FileNode } from "../../types";
import { useAppStore } from "../../stores/appStore";
import { fetchFileTree } from "../../api/client";

interface FileTreeNodeProps {
  node: FileNode;
  depth: number;
}

function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const { openTab, activeTabId } = useAppStore();
  const [open, setOpen] = useState(false);

  const isActive = activeTabId === `file:${node.path}`;

  function handleClick() {
    if (node.type === "directory") {
      setOpen((o) => !o);
    } else {
      openTab({
        id: `file:${node.path}`,
        title: node.name,
        type: "editor",
        path: node.path,
      });
    }
  }

  const paddingLeft = depth * 12 + 8;

  return (
    <div>
      <div
        onClick={handleClick}
        style={{ paddingLeft }}
        className={`
          flex items-center gap-1.5 py-0.5 pr-2 cursor-pointer select-none text-xs rounded-sm
          ${isActive ? "bg-vscode-highlight text-white" : "hover:bg-vscode-border text-vscode-text"}
        `}
      >
        {node.type === "directory" ? (
          <span className="text-[10px] text-vscode-muted w-3 shrink-0">
            {open ? "▾" : "▸"}
          </span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="text-[11px] shrink-0">{fileIcon(node)}</span>
        <span className="truncate">{node.name}</span>
      </div>

      {node.type === "directory" && open && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode key={child.path} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function fileIcon(node: FileNode): string {
  if (node.type === "directory") return "📁";
  switch (node.extension) {
    case "yaml":
    case "yml":
      return "📋";
    case "md":
      return "📝";
    case "json":
      return "{ }";
    case "csv":
      return "📊";
    case "pdf":
      return "📄";
    default:
      return "📄";
  }
}

export function FileTree() {
  const { fileTree, setFileTree } = useAppStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tree = await fetchFileTree();
      setFileTree(tree);
    } catch {
      setError("Impossible de charger le workspace");
    } finally {
      setLoading(false);
    }
  }, [setFileTree]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-widest text-vscode-muted border-b border-vscode-border shrink-0">
        <span>Explorer</span>
        <button
          onClick={load}
          title="Rafraîchir"
          className="hover:text-vscode-text transition-colors"
        >
          ↺
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="text-vscode-muted text-xs px-3 py-2">Chargement…</div>
        )}
        {error && (
          <div className="text-red-400 text-xs px-3 py-2">{error}</div>
        )}
        {!loading && !error && fileTree.length === 0 && (
          <div className="text-vscode-muted text-xs px-3 py-2">
            Workspace vide
          </div>
        )}
        {fileTree.map((node) => (
          <FileTreeNode key={node.path} node={node} depth={0} />
        ))}
      </div>
    </div>
  );
}
