import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../../stores/appStore";
import type { TabType } from "../../types";

interface Command {
  id: string;
  label: string;
  icon: string;
  action: () => void;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openTab } = useAppStore();

  const NAV_COMMANDS: Command[] = [
    { id: "dashboard",    icon: "📊", label: "Ouvrir Dashboard",        action: () => openTab({ id: "dashboard",    title: "Dashboard",    type: "dashboard" as TabType }) },
    { id: "transactions", icon: "💳", label: "Ouvrir Transactions",     action: () => openTab({ id: "transactions", title: "Transactions", type: "transactions" as TabType }) },
    { id: "treasury",     icon: "💰", label: "Ouvrir Trésorerie",       action: () => openTab({ id: "treasury",     title: "Trésorerie",  type: "treasury" as TabType }) },
    { id: "import",       icon: "📥", label: "Ouvrir Import",           action: () => openTab({ id: "import",       title: "Import",      type: "import" as TabType }) },
    { id: "invoices",     icon: "🧾", label: "Ouvrir Factures",         action: () => openTab({ id: "invoices",     title: "Factures",    type: "invoices" as TabType }) },
    { id: "reports",      icon: "📈", label: "Ouvrir Rapports",         action: () => openTab({ id: "reports",      title: "Rapports",    type: "reports" as TabType }) },
    { id: "journal",      icon: "📒", label: "Ouvrir Journal",          action: () => openTab({ id: "journal",      title: "Journal",     type: "journal" as TabType }) },
    { id: "reconcile",    icon: "🔗", label: "Ouvrir Rapprochement",    action: () => openTab({ id: "reconcile",    title: "Rapprochement", type: "reconcile" as TabType }) },
    { id: "templates",    icon: "📋", label: "Ouvrir Modèles",          action: () => openTab({ id: "templates",    title: "Modèles",     type: "templates" as TabType }) },
    { id: "alerts",       icon: "🔔", label: "Ouvrir Alertes",          action: () => openTab({ id: "alerts",       title: "Alertes",     type: "alerts" as TabType }) },
    { id: "budgets",      icon: "🎯", label: "Ouvrir Budgets",          action: () => openTab({ id: "budgets",      title: "Budgets",     type: "budgets" as TabType }) },
    { id: "settings",     icon: "⚙️", label: "Ouvrir Paramètres",       action: () => openTab({ id: "settings",     title: "Paramètres",  type: "settings" as TabType }) },
    { id: "recurring",    icon: "🔁", label: "Ouvrir Frais récurrents", action: () => openTab({ id: "recurring",    title: "Récurrents",  type: "recurring" as TabType }) },
    { id: "vat",          icon: "🧮", label: "Ouvrir TVA",              action: () => openTab({ id: "vat",          title: "TVA",         type: "vat" as TabType }) },
    { id: "tiers",        icon: "👥", label: "Ouvrir Tiers",            action: () => openTab({ id: "tiers",        title: "Tiers",       type: "tiers" as TabType }) },
    { id: "history",      icon: "📜", label: "Ouvrir Historique git",   action: () => openTab({ id: "history",      title: "Historique",  type: "history" as TabType }) },
    { id: "hr",           icon: "👥", label: "Ouvrir RH & Paie",         action: () => openTab({ id: "hr",           title: "RH & Paie",    type: "hr" as TabType }) },
  ];

  const filtered = query.trim()
    ? NAV_COMMANDS.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : NAV_COMMANDS;

  // Ouvrir avec Ctrl+K / Cmd+K
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setSelected(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus auto à l'ouverture
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Navigation clavier
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && filtered[selected]) {
      filtered[selected].action();
      setOpen(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      onClick={() => setOpen(false)}
    >
      {/* Fond semi-transparent */}
      <div className="absolute inset-0 bg-black/50" />

      <div
        className="relative w-full max-w-lg bg-vscode-panel border border-vscode-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-vscode-border">
          <span className="text-vscode-muted text-sm">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Tapez une commande… (Ctrl+K)"
            className="flex-1 bg-transparent text-vscode-text text-sm outline-none placeholder:text-vscode-muted"
          />
          <span className="text-vscode-muted text-[10px] border border-vscode-border rounded px-1">Échap</span>
        </div>

        {/* Résultats */}
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-vscode-muted text-xs text-center">Aucun résultat</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => { cmd.action(); setOpen(false); }}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer text-sm transition-colors ${
                  i === selected ? "bg-vscode-accent text-white" : "text-vscode-text hover:bg-vscode-border"
                }`}
              >
                <span className="text-base shrink-0">{cmd.icon}</span>
                <span>{cmd.label}</span>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-1.5 border-t border-vscode-border text-[10px] text-vscode-muted flex gap-3">
          <span>↑↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>Échap fermer</span>
        </div>
      </div>
    </div>
  );
}
