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
  reconciliation_issues: ReconciliationIssue[];
}

type ReconciliationIssue = "status" | "category" | "justification";

const ISSUE_LABELS: Record<ReconciliationIssue, string> = {
  status: "Valider la transaction",
  category: "Choisir une catégorie",
  justification: "Ajouter ou valider un justificatif",
};

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
  const [error, setError] = useState("");

  const reconciled = transactions.filter((t) => t.reconciled).length;
  const total = transactions.length;
  const pending = total - reconciled;

  async function load() {
    setLoading(true);
    setSelected(new Set());
    setError("");
    try {
      const { data } = await api.get<{ transactions: ReconcileTransaction[]; reconciled: number; total: number; pending: number }>(
        `/reconcile?month=${month}`
      );
      setTransactions(Array.isArray(data?.transactions) ? data.transactions : []);
    } catch {
      setTransactions([]);
      setError("Le rapprochement bancaire n'a pas pu être chargé.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [month]);

  async function toggleOne(id: string, value: boolean) {
    setSaving(true);
    setError("");
    try {
      await api.patch(`/reconcile/${id}`, { reconciled: value });
      setTransactions((list) => list.map((t) => (t.id === id ? { ...t, reconciled: value } : t)));
    } catch {
      setError("Cette transaction doit être complétée avant d'être rapprochée.");
    } finally {
      setSaving(false);
    }
  }

  async function bulkSet(value: boolean) {
    if (selected.size === 0) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/reconcile/bulk", { ids: [...selected], reconciled: value });
      const ids = selected;
      setTransactions((list) => list.map((t) => (ids.has(t.id) ? { ...t, reconciled: value } : t)));
      setSelected(new Set());
    } catch {
      setError("La sélection contient une transaction qui n'est pas encore prête.");
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

  const selectedTransactions = transactions.filter((transaction) => selected.has(transaction.id));
  const selectedCanReconcile = selectedTransactions.every(
    (transaction) => transaction.reconciled || transaction.reconciliation_issues.length === 0,
  );

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
              disabled={saving || !selectedCanReconcile}
              title={!selectedCanReconcile ? "Complète les transactions signalées avant de les rapprocher" : "Marquer la sélection comme rapprochée"}
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

      <div className="border-b border-vscode-border bg-blue-950/30 px-4 py-2 text-[11px] text-vscode-muted">
        <span className="font-semibold text-blue-300">Quand rapprocher ?</span>{" "}
        Quand l'opération bancaire est contrôlée, validée, catégorisée et, pour une dépense, accompagnée d'un justificatif.
        La TVA peut être nulle ou multi-taux : elle ne bloque pas le rapprochement.
      </div>

      {error && (
        <div role="alert" className="border-b border-red-800 bg-red-950/30 px-4 py-2 text-xs text-red-300">{error}</div>
      )}

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
                <th className="text-left px-3 py-2 w-52">État du contrôle</th>
                <th className="sticky right-0 bg-vscode-panel text-center px-3 py-2 w-28">Réconcilié</th>
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
                  <td className="px-3 py-2">
                    {t.reconciled ? (
                      <span className="rounded bg-green-900/40 px-2 py-1 text-[10px] text-green-300">✓ Rapprochée</span>
                    ) : t.reconciliation_issues.length === 0 ? (
                      <span className="rounded bg-blue-900/40 px-2 py-1 text-[10px] text-blue-300">Prête à rapprocher</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {t.reconciliation_issues.map((issue) => (
                          <span key={issue} className="rounded bg-orange-900/30 px-1.5 py-0.5 text-[10px] text-orange-300">
                            {ISSUE_LABELS[issue]}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="sticky right-0 bg-vscode-bg px-3 py-2 text-center">
                    <button
                      onClick={() => toggleOne(t.id, !t.reconciled)}
                      disabled={saving || (!t.reconciled && t.reconciliation_issues.length > 0)}
                      className={`rounded border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${t.reconciled ? "border-vscode-border text-vscode-muted" : "border-green-700 bg-green-900/30 text-green-300"}`}
                      title={t.reconciled
                        ? "Annuler le rapprochement"
                        : t.reconciliation_issues.length > 0
                          ? t.reconciliation_issues.map((issue) => ISSUE_LABELS[issue]).join(" · ")
                          : "Marquer comme rapprochée"}
                    >{t.reconciled ? "Annuler" : "Rapprocher"}</button>
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
