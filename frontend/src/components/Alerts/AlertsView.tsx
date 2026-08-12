import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
import type { TabType } from "../../types";

interface SystemAlert {
  id: string;
  level: "error" | "warn" | "info";
  category: string;
  message: string;
  count?: number;
  action?: { label: string; tab: TabType; filter?: "unjustified" | "misc" | "duplicates" | "receipt-inbox" };
}

const LEVEL_STYLES: Record<SystemAlert["level"], { bg: string; border: string; icon: string; dot: string }> = {
  error: { bg: "bg-red-900/20",    border: "border-red-700",    icon: "🔴", dot: "bg-red-500"    },
  warn:  { bg: "bg-yellow-900/20", border: "border-yellow-700", icon: "🟡", dot: "bg-yellow-400" },
  info:  { bg: "bg-blue-900/20",   border: "border-blue-700",   icon: "🔵", dot: "bg-blue-400"   },
};

const CATEGORY_ORDER = ["Intégrité des données", "Doublons", "Justificatifs", "OCR", "TVA", "Catégorisation", "Rapprochement", "Budgets", "Trésorerie"];
const TAB_TITLES: Partial<Record<TabType, string>> = { transactions: "Transactions", reconcile: "Rapprochement", vat: "TVA", treasury: "Trésorerie", budgets: "Budgets", export: "Export" };

export function AlertsView() {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SystemAlert["level"] | "all">("all");
  const openTab = useAppStore((state) => state.openTab);

  async function load() {
    setLoading(true);
    try {
      const { data } = await api.get<{ alerts: SystemAlert[]; count: number }>("/alerts");
      setAlerts(Array.isArray(data?.alerts) ? data.alerts : []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = filter === "all" ? alerts : alerts.filter((a) => a.level === filter);
  const counts = { error: alerts.filter((a) => a.level === "error").length, warn: alerts.filter((a) => a.level === "warn").length, info: alerts.filter((a) => a.level === "info").length };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-vscode-border shrink-0 bg-vscode-panel flex-wrap">
        <div><span className="text-xs font-semibold text-vscode-text">✅ À traiter</span><p className="text-[10px] text-vscode-muted">Une file unique pour terminer la préparation comptable.</p></div>

        {/* Filtres niveau */}
        {(["all", "error", "warn", "info"] as const).map((l) => (
          <button
            key={l}
            onClick={() => setFilter(l)}
            className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
              filter === l
                ? "bg-vscode-accent border-vscode-accent text-white"
                : "border-vscode-border text-vscode-muted hover:text-vscode-text"
            }`}
          >
            {l === "all" ? `Tout (${alerts.length})` : l === "error" ? `🔴 Erreurs (${counts.error})` : l === "warn" ? `🟡 Avertissements (${counts.warn})` : `🔵 Infos (${counts.info})`}
          </button>
        ))}

        <button
          onClick={load}
          className="ml-auto text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
          title="Rafraîchir"
        >
          ↻
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center flex-1 text-vscode-muted text-xs">Chargement…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-vscode-muted gap-2">
          <span className="text-3xl">✅</span>
          <p className="text-sm">Aucune alerte — tout va bien.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {CATEGORY_ORDER.map((category) => {
            const items = filtered.filter((a) => a.category === category);
            if (items.length === 0) return null;
            return (
              <div key={category}>
                <p className="text-[10px] uppercase tracking-wider text-vscode-muted mb-2">{category}</p>
                <div className="space-y-2">
                  {items.map((a) => {
                    const s = LEVEL_STYLES[a.level];
                    return (
                      <div key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border ${s.bg} ${s.border}`}>
                        <span className="text-base shrink-0">{s.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-vscode-text">{a.message}</p>
                          {a.count !== undefined && a.count > 0 && (
                            <span className="text-[10px] text-vscode-muted mt-0.5 block">{a.count} élément{a.count > 1 ? "s" : ""} concerné{a.count > 1 ? "s" : ""}</span>
                          )}
                        </div>
                        {a.action && <button onClick={() => openTab({ id: a.action!.filter ? `${a.action!.tab}-${a.action!.filter}` : a.action!.tab, type: a.action!.tab, title: a.action!.filter ? `${TAB_TITLES[a.action!.tab] ?? a.action!.label} — ${a.action!.label}` : TAB_TITLES[a.action!.tab] ?? a.action!.label, path: a.action!.filter })} className="shrink-0 rounded bg-vscode-accent px-2.5 py-1 text-[10px] text-white">{a.action.label} →</button>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* Catégories inconnues */}
          {filtered.filter((a) => !CATEGORY_ORDER.includes(a.category)).map((a) => {
            const s = LEVEL_STYLES[a.level];
            return (
              <div key={a.id} className={`flex items-start gap-3 p-3 rounded-lg border ${s.bg} ${s.border}`}>
                <span className="text-base shrink-0">{s.icon}</span>
                <p className="text-xs text-vscode-text">{a.message}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
