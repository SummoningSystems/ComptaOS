import { useEffect, useState } from "react";
import { api } from "../../api/client";

interface ReconcileTransaction {
  id: string;
  date: string;
  label: string;
  amount_ttc: number;
  category: string;
  account: string;
  reconciled: boolean;
  status: string;
}

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

export function ReconcileView() {
  const [transactions, setTransactions] = useState<ReconcileTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const reconciled = transactions.filter((t) => t.reconciled).length;
  const total = transactions.length;
  const pending = total - reconciled;

  async function load() {
    setLoading(true);
    setSelected(new Set());
    try {
      const { data } = await api.get<{ transactions: ReconcileTransaction[]; reconciled: number; total: number; pending: number }>(
        `/reconcile?month=${month}`
      );
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  async function toggleOne(id: string, value: boolean) {
    setSaving(true);
    try {
      await api.patch(`/reconcile/${id}`, { reconciled: value });
      setTransactions((list) => list.map((t) => (t.id === id ? { ...t, reconciled: value } : t)));
    } finally {
      setSaving(false);
    }
  }

  async function bulkSet(value: boolean) {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await api.post("/reconcile/bulk", { ids: [...selected], reconciled: value });
      const ids = selected;
      setTransactions((list) => list.map((t) => (ids.has(t.id) ? { ...t, reconciled: value } : t)));
      setSelected(new Set());
    } finally {
      setSaving(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === transactions.length) setSelected(new Set());
    else setSelected(new Set(transactions.map((t) => t.id)));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-vscode-border shrink-0 bg-vscode-panel flex-wrap">
        <span className="text-xs font-semibold text-vscode-text">🔗 Rapprochement bancaire</span>

        {/* Mois */}
        <select
          value={month.split("-")[1] ? parseInt(month.split("-")[1]) - 1 : 0}
          onChange={(e) => {
            const yr = month.split("-")[0];
            const m = String(parseInt(e.target.value) + 1).padStart(2, "0");
            setMonth(`${yr}-${m}`);
          }}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded"
        >
          {MONTH_LABELS.map((m, i) => <option key={i} value={i}>{m}</option>)}
        </select>

        <input
          type="number"
          value={month.split("-")[0]}
          onChange={(e) => setMonth(`${e.target.value}-${month.split("-")[1]}`)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-20 focus:outline-none"
          min={2000}
          max={2099}
        />

        {/* KPI rapides */}
        <div className="flex items-center gap-3 ml-2 text-[11px]">
          <span className="text-green-400">✓ {reconciled} réconciliée{reconciled > 1 ? "s" : ""}</span>
          <span className="text-yellow-300">○ {pending} en attente</span>
          <span className="text-vscode-muted">/ {total} total</span>
        </div>

        {/* Barre de progression */}
        {total > 0 && (
          <div className="flex-1 max-w-[160px] h-1.5 bg-vscode-border rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.round((reconciled / total) * 100)}%` }}
            />
          </div>
        )}

        {/* Actions en masse */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] text-vscode-muted">{selected.size} sélectionnée{selected.size > 1 ? "s" : ""}</span>
            <button
              onClick={() => bulkSet(true)}
              disabled={saving}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-2.5 py-1 rounded disabled:opacity-50"
            >
              ✓ Réconcilier
            </button>
            <button
              onClick={() => bulkSet(false)}
              disabled={saving}
              className="text-xs bg-vscode-panel hover:bg-vscode-border text-vscode-muted px-2.5 py-1 rounded border border-vscode-border disabled:opacity-50"
            >
              Annuler
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1 text-vscode-muted text-xs">Chargement…</div>
      ) : transactions.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-vscode-muted gap-2">
          <span className="text-3xl">🏦</span>
          <p className="text-sm">Aucune transaction ce mois-ci.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-vscode-panel z-10">
              <tr className="text-vscode-muted text-[11px] uppercase tracking-wider border-b border-vscode-border">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={selected.size === transactions.length && transactions.length > 0}
                    onChange={toggleSelectAll}
                    className="accent-vscode-accent"
                  />
                </th>
                <th className="text-left px-3 py-2 w-24">Date</th>
                <th className="text-left px-3 py-2">Libellé</th>
                <th className="text-left px-3 py-2 w-28">Catégorie</th>
                <th className="text-left px-3 py-2 w-36">Compte</th>
                <th className="text-right px-3 py-2 w-28">Montant TTC</th>
                <th className="text-center px-3 py-2 w-28">Réconcilié</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vscode-border/30">
              {transactions.map((t) => (
                <tr
                  key={t.id}
                  className={`hover:bg-vscode-panel/50 transition-colors ${t.reconciled ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggleSelect(t.id)}
                      className="accent-vscode-accent"
                    />
                  </td>
                  <td className="px-3 py-2 font-mono text-vscode-muted">{t.date}</td>
                  <td className="px-3 py-2 text-vscode-text truncate max-w-[260px]" title={t.label}>{t.label}</td>
                  <td className="px-3 py-2 text-vscode-muted">{t.category}</td>
                  <td className="px-3 py-2 text-vscode-muted truncate" title={t.account}>{t.account || "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono font-semibold ${t.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amount_ttc >= 0 ? "+" : ""}{t.amount_ttc.toFixed(2)} €
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => toggleOne(t.id, !t.reconciled)}
                      disabled={saving}
                      className={`w-8 h-5 rounded-full relative transition-colors disabled:opacity-50 ${t.reconciled ? "bg-green-600" : "bg-vscode-border"}`}
                      title={t.reconciled ? "Annuler la réconciliation" : "Marquer comme réconcilié"}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${t.reconciled ? "left-3" : "left-0.5"}`}
                      />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
