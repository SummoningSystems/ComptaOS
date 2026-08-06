import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { Tab } from "../../types";

const TAB_ICONS: Record<string, string> = {
  dashboard: "▣", editor: "📄", import: "📥", transactions: "📋", ocr: "🔍", reports: "📊",
  recurring: "🔄", invoices: "🧾", quotes: "📋", plugins: "🧩", pricing: "⭐", banking: "🏦",
  settings: "⚙️", tiers: "🏢", vat: "💰", budgets: "🎯", spreadsheets: "🧭", history: "🕐",
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, closeTabs, reorderTabs } = useAppStore();
  const dragIdRef = useRef<string | null>(null);
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const menuRef = useRef<HTMLDivElement>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { tabRefs.current[activeTabId ?? ""]?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [activeTabId]);
  useEffect(() => {
    function closeMenu(event: MouseEvent) { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); }
    window.addEventListener("mousedown", closeMenu);
    return () => window.removeEventListener("mousedown", closeMenu);
  }, []);

  function popOut(tab: Tab) {
    const url = `${window.location.origin}${window.location.pathname}?view=${tab.type}`;
    window.open(url, `comptaos_${tab.type}`, "popup,width=1400,height=900");
  }

  function requestClose(ids: string[]) {
    const targets = tabs.filter((tab) => ids.includes(tab.id));
    const dirtyCount = targets.filter((tab) => tab.dirty).length;
    if (dirtyCount > 0 && !window.confirm(`${dirtyCount} fichier${dirtyCount > 1 ? "s ont" : " a"} des modifications non sauvegardées. Fermer quand même ?`)) return;
    closeTabs(ids);
    setMenuOpen(false);
  }

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);

  return <div className="flex h-9 shrink-0 border-b border-vscode-border bg-vscode-panel">
    <div className="flex min-w-0 flex-1 items-end overflow-x-auto">
      {tabs.map((tab) => <div
        key={tab.id}
        ref={(node) => { tabRefs.current[tab.id] = node; }}
        draggable
        onClick={() => setActiveTab(tab.id)}
        onMouseDown={(event) => { if (event.button === 1) { event.preventDefault(); requestClose([tab.id]); } }}
        onDragStart={(event) => { dragIdRef.current = tab.id; event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => { event.preventDefault(); if (dragIdRef.current !== tab.id) setDragOverId(tab.id); }}
        onDragLeave={() => setDragOverId((current) => current === tab.id ? null : current)}
        onDrop={(event) => { event.preventDefault(); if (dragIdRef.current && dragIdRef.current !== tab.id) reorderTabs(dragIdRef.current, tab.id); dragIdRef.current = null; setDragOverId(null); }}
        onDragEnd={() => { dragIdRef.current = null; setDragOverId(null); }}
        className={`group flex h-full w-44 min-w-36 max-w-56 flex-none cursor-pointer select-none items-center gap-1.5 border-r border-vscode-border px-3 text-xs whitespace-nowrap ${activeTabId === tab.id ? "border-t border-t-vscode-accent bg-vscode-bg text-vscode-text" : "bg-vscode-panel text-vscode-muted hover:text-vscode-text"} ${dragOverId === tab.id ? "border-l-2 border-l-vscode-accent" : ""}`}
      >
        <span className="shrink-0 text-[10px]">{TAB_ICONS[tab.type] ?? "📄"}</span>
        <span className="min-w-0 flex-1 truncate" title={tab.title}>{tab.title}</span>
        {tab.dirty && <span className="shrink-0 text-[8px] text-yellow-400" title="Modifications non sauvegardées">●</span>}
        <button onClick={(event) => { event.stopPropagation(); popOut(tab); }} className="shrink-0 rounded px-0.5 text-[10px] text-vscode-muted opacity-0 hover:text-vscode-accent group-hover:opacity-100" title="Ouvrir dans une fenêtre séparée">↗</button>
        <button onClick={(event) => { event.stopPropagation(); requestClose([tab.id]); }} className="shrink-0 rounded px-0.5 text-vscode-muted hover:text-white" title="Fermer">×</button>
      </div>)}
    </div>
    <div ref={menuRef} className="relative flex h-full shrink-0 items-center border-l border-vscode-border px-1">
      <button onClick={() => setMenuOpen((open) => !open)} className="rounded px-2 py-1 text-sm text-vscode-muted hover:bg-vscode-border hover:text-vscode-text" title="Gérer les onglets" aria-label="Gérer les onglets">…</button>
      {menuOpen && <div className="absolute right-1 top-8 z-50 w-72 overflow-hidden rounded border border-vscode-border bg-vscode-panel shadow-2xl">
        <div className="max-h-72 overflow-y-auto py-1">
          {tabs.map((tab) => <button key={tab.id} onClick={() => { setActiveTab(tab.id); setMenuOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-vscode-border ${tab.id === activeTabId ? "text-white" : "text-vscode-muted"}`}><span>{TAB_ICONS[tab.type] ?? "📄"}</span><span className="min-w-0 flex-1 truncate">{tab.title}</span>{tab.dirty && <span className="text-yellow-400">●</span>}</button>)}
        </div>
        <div className="border-t border-vscode-border p-1 text-xs">
          <button disabled={!activeTabId || tabs.length <= 1} onClick={() => requestClose(tabs.filter((tab) => tab.id !== activeTabId).map((tab) => tab.id))} className="block w-full rounded px-2 py-1 text-left text-vscode-muted hover:bg-vscode-border hover:text-vscode-text disabled:opacity-30">Fermer les autres</button>
          <button disabled={activeIndex < 0 || activeIndex === tabs.length - 1} onClick={() => requestClose(tabs.slice(activeIndex + 1).map((tab) => tab.id))} className="block w-full rounded px-2 py-1 text-left text-vscode-muted hover:bg-vscode-border hover:text-vscode-text disabled:opacity-30">Fermer à droite</button>
          <button disabled={tabs.length === 0} onClick={() => requestClose(tabs.map((tab) => tab.id))} className="block w-full rounded px-2 py-1 text-left text-vscode-muted hover:bg-vscode-border hover:text-vscode-text disabled:opacity-30">Tout fermer</button>
        </div>
      </div>}
    </div>
  </div>;
}
