import { useState } from "react";
import { useAppStore } from "../../stores/appStore";
import { FileTree } from "../Explorer/FileTree";
import type { TabType } from "../../types";

export type SidebarSection = "dashboard" | "compta" | "documents" | "finance" | "analyses" | "explorer" | "outils";

interface SidebarProps {
  activeSection: SidebarSection;
  onSectionChange: (s: SidebarSection) => void;
  pendingCount?: number;
}

type NavItem = { icon: string; label: string; tab: { id: string; title: string; type: TabType }; badge?: number };

type NavGroup = {
  id: SidebarSection;
  icon: string;
  title: string;
  direct?: boolean;
  directTab?: { id: string; title: string; type: TabType };
  items?: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "compta",
    icon: "💳",
    title: "Comptabilité",
    items: [
      { icon: "✅", label: "À traiter",        tab: { id: "alerts",       title: "À traiter",         type: "alerts" } },
      { icon: "📋", label: "Transactions",     tab: { id: "transactions", title: "Transactions",      type: "transactions" } },
      { icon: "📒", label: "Journal",          tab: { id: "journal",      title: "Journal",           type: "journal" } },
      { icon: "🔗", label: "Rapprochement",    tab: { id: "reconcile",    title: "Rapprochement",     type: "reconcile" } },
      { icon: "📊", label: "TVA",              tab: { id: "vat",          title: "TVA",               type: "vat" } },
      { icon: "📥", label: "Import CSV",       tab: { id: "import",       title: "Import CSV",        type: "import" } },
      { icon: "🔍", label: "OCR PDF",          tab: { id: "ocr",          title: "OCR PDF",           type: "ocr" } },
      { icon: "🏦", label: "Banque PSD2",      tab: { id: "banking",      title: "Connexion bancaire",type: "banking" } },
    ],
  },
  {
    id: "documents",
    icon: "🧾",
    title: "Documents",
    items: [
      { icon: "🧾", label: "Factures",  tab: { id: "invoices",  title: "Factures",  type: "invoices" } },
      { icon: "📋", label: "Devis",     tab: { id: "quotes",    title: "Devis",     type: "quotes" } },
      { icon: "📄", label: "Modèles",   tab: { id: "templates", title: "Modèles",   type: "templates" } },
      { icon: "🏢", label: "Tiers",     tab: { id: "tiers",     title: "Tiers",     type: "tiers" } },
    ],
  },
  {
    id: "finance",
    icon: "💰",
    title: "Finance",
    items: [
      { icon: "💰", label: "Trésorerie",        tab: { id: "treasury",   title: "Trésorerie",     type: "treasury" } },
      { icon: "🎯", label: "Budgets",           tab: { id: "budgets",    title: "Budgets",        type: "budgets" } },
      { icon: "📈", label: "Bilan / P&L",       tab: { id: "profitloss", title: "Bilan / P&L",    type: "profitloss" } },
      { icon: "🔄", label: "Frais récurrents",  tab: { id: "recurring",  title: "Frais",          type: "recurring" } },
    ],
  },
  {
    id: "analyses",
    icon: "📈",
    title: "Analyses & Export",
    items: [
      { icon: "📊", label: "Rapports",  tab: { id: "reports",      title: "Rapports",  type: "reports" } },
      { icon: "⬇",  label: "Export",   tab: { id: "export",       title: "Export",    type: "export" } },
      { icon: "🧮", label: "Tableaux",  tab: { id: "spreadsheets", title: "Tableaux",  type: "spreadsheets" } },
    ],
  },
  {
    id: "explorer",
    icon: "📁",
    title: "Fichiers",
  },
  {
    id: "outils",
    icon: "⚙️",
    title: "Outils",
    items: [
      { icon: "⚙️", label: "Paramètres",  tab: { id: "settings", title: "Paramètres",     type: "settings" } },
      { icon: "🧩", label: "Plugins",     tab: { id: "plugins",  title: "Plugins",         type: "plugins" } },
      { icon: "⭐", label: "Plans",       tab: { id: "pricing",  title: "Plans & Licence", type: "pricing" } },
      { icon: "🕐", label: "Historique",  tab: { id: "history",  title: "Historique",      type: "history" } },
    ],
  },
];

export function Sidebar({ activeSection, onSectionChange, pendingCount = 0 }: SidebarProps) {
  const { sidebarWidth, openTab, tabs, activeTabId } = useAppStore();
  const [hovered, setHovered] = useState<SidebarSection | null>(null);

  const activeGroup = NAV_GROUPS.find((g) => g.id === activeSection);

  return (
    <div
      className="flex shrink-0 border-r border-vscode-border bg-vscode-sidebar"
      style={{ width: sidebarWidth }}
    >
      {/* Activity bar */}
      <div className="flex flex-col items-center py-2 gap-0.5 w-10 bg-vscode-panel border-r border-vscode-border shrink-0">
        {/* Dashboard direct */}
        <button
          title="Dashboard"
          onClick={() => { openTab({ id: "dashboard", title: "Dashboard", type: "dashboard" }); onSectionChange("compta"); }}
          className="w-8 h-8 flex items-center justify-center rounded text-base transition-colors text-vscode-muted hover:text-vscode-text"
        >
          📊
        </button>
        <div className="w-6 h-px bg-vscode-border my-1" />
        {NAV_GROUPS.map((group) => (
          <button
            key={group.id}
            title={group.title}
            onMouseEnter={() => setHovered(group.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSectionChange(group.id)}
            className={`
              w-8 h-8 flex items-center justify-center rounded text-base transition-colors relative
              ${activeSection === group.id
                ? "text-white bg-vscode-highlight"
                : "text-vscode-muted hover:text-vscode-text"
              }
            `}
          >
            {group.icon}
            {/* Badge transactions */}
            {group.id === "compta" && pendingCount > 0 && (
              <span className="absolute top-0 right-0 bg-orange-500 text-white text-[8px] rounded-full min-w-[12px] h-[12px] flex items-center justify-center px-0.5 leading-none">
                {pendingCount > 9 ? "9+" : pendingCount}
              </span>
            )}
            {/* Tooltip au survol si pas actif */}
            {hovered === group.id && activeSection !== group.id && (
              <span className="absolute left-10 z-50 whitespace-nowrap bg-vscode-panel border border-vscode-border text-vscode-text text-[10px] rounded px-2 py-1 shadow-lg pointer-events-none">
                {group.title}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Header de la section */}
        {activeGroup && (
          <div className="px-3 py-2 border-b border-vscode-border shrink-0">
            <span className="text-[10px] font-semibold text-vscode-muted uppercase tracking-wider">
              {activeGroup.title}
            </span>
          </div>
        )}

        {activeSection === "explorer" && <FileTree />}

        {activeSection !== "explorer" && activeGroup?.items && (
          <div className="py-1">
            {activeGroup.items.map((item) => {
              const isActive = tabs.find((t) => t.id === item.tab.id)?.id === activeTabId;
              return (
                <button
                  key={item.tab.id}
                  onClick={() => openTab(item.tab)}
                  className={`
                    w-full flex items-center gap-2.5 px-3 py-1.5 text-xs transition-colors text-left
                    ${isActive
                      ? "bg-vscode-highlight text-white"
                      : "text-vscode-muted hover:text-vscode-text hover:bg-vscode-bg"
                    }
                  `}
                >
                  <span className="text-sm w-4 text-center shrink-0">{item.icon}</span>
                  <span className="flex-1">{item.label}</span>
                  {item.tab.type === "transactions" && pendingCount > 0 && (
                    <span className="bg-orange-500 text-white text-[9px] rounded-full px-1.5 py-0.5 leading-none">
                      {pendingCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
