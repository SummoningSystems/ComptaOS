import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell } from "recharts";
import { api, apiUrl } from "../../api/client";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => String(CURRENT_YEAR - i));

interface CategoryRow { category: string; label: string; amount: number }
interface MonthRow { month: string; revenue: number; expenses: number; net: number }
interface YearData {
  revenue: CategoryRow[];
  expenses: CategoryRow[];
  totalRevenue: number;
  totalExpenses: number;
  netResult: number;
  monthly: MonthRow[];
}
interface PLData { year: string; prevYear: string; current: YearData; previous: YearData }

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " €";
}
function delta(curr: number, prev: number) {
  if (prev === 0) return null;
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return pct;
}

function KPI({ label, value, prev, positive = true }: { label: string; value: number; prev: number; positive?: boolean }) {
  const d = delta(value, prev);
  const isUp = value >= prev;
  const good = positive ? isUp : !isUp;
  return (
    <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-vscode-muted">{label}</span>
      <span className="text-xl font-semibold text-vscode-text">{fmt(value)}</span>
      {d !== null && (
        <span className={`text-xs font-medium ${good ? "text-green-400" : "text-red-400"}`}>
          {isUp ? "▲" : "▼"} {Math.abs(d).toFixed(1)} % vs {String(parseInt(label.includes("N") ? "0" : "0"))}
        </span>
      )}
    </div>
  );
}

export function ProfitLossView() {
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [data, setData] = useState<PLData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.get<PLData>("/pl", { params: { year } })
      .then(({ data }) => setData(data))
      .catch(() => setError("Impossible de charger les données P&L"))
      .finally(() => setLoading(false));
  }, [year]);

  if (loading) return (
    <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>
  );
  if (error) return (
    <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
  );
  if (!data) return null;

  const { current, previous } = data;

  // Données pour graphique mensuel
  const monthLabels = current.monthly.map((m) => m.month.slice(5)); // "01" → "01"

  // Comparaison N vs N-1 pour les catégories charges
  const expenseComparison = current.expenses.map((row) => {
    const prev = previous.expenses.find((r) => r.category === row.category)?.amount ?? 0;
    return { ...row, prev };
  });

  return (
    <div className="p-5 flex flex-col gap-6 max-w-5xl mx-auto overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-semibold text-vscode-text">Compte de résultat</h1>
          <p className="text-xs text-vscode-muted">Bilan P&L — comparaison {year} vs {data.prevYear}</p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="bg-vscode-panel border border-vscode-border text-vscode-text text-sm rounded px-2 py-1.5"
        >
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <a
          href={apiUrl(`/reports/pl-pdf?year=${year}`)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-3 py-1.5 flex items-center gap-1"
        >
          📄 Exporter PDF
        </a>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
          <span className="text-xs text-vscode-muted">Produits HT {year}</span>
          <span className="text-xl font-semibold text-green-400">{fmt(current.totalRevenue)}</span>
          <span className="text-xs text-vscode-muted">N-1 : {fmt(previous.totalRevenue)}</span>
        </div>
        <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
          <span className="text-xs text-vscode-muted">Charges HT {year}</span>
          <span className="text-xl font-semibold text-red-400">{fmt(current.totalExpenses)}</span>
          <span className="text-xs text-vscode-muted">N-1 : {fmt(previous.totalExpenses)}</span>
        </div>
        <div className={`bg-vscode-panel border rounded-lg p-4 flex flex-col gap-1 ${current.netResult >= 0 ? "border-green-700" : "border-red-700"}`}>
          <span className="text-xs text-vscode-muted">Résultat net HT {year}</span>
          <span className={`text-xl font-semibold ${current.netResult >= 0 ? "text-green-400" : "text-red-400"}`}>
            {fmt(current.netResult)}
          </span>
          <span className="text-xs text-vscode-muted">N-1 : {fmt(previous.netResult)}</span>
        </div>
        <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
          <span className="text-xs text-vscode-muted">Taux de marge</span>
          <span className="text-xl font-semibold text-vscode-text">
            {current.totalRevenue > 0
              ? ((current.netResult / current.totalRevenue) * 100).toFixed(1) + " %"
              : "—"}
          </span>
          <span className="text-xs text-vscode-muted">
            N-1 : {previous.totalRevenue > 0
              ? ((previous.netResult / previous.totalRevenue) * 100).toFixed(1) + " %"
              : "—"}
          </span>
        </div>
      </div>

      {/* Graphique mensuel */}
      {current.monthly.length > 0 && (
        <div className="bg-vscode-panel border border-vscode-border rounded-lg p-4">
          <h2 className="text-sm font-medium text-vscode-text mb-3">Évolution mensuelle {year}</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={current.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--vscode-border)" />
              <XAxis dataKey="month" tickFormatter={(v) => v.slice(5)} tick={{ fill: "var(--vscode-muted)", fontSize: 11 }} />
              <YAxis tick={{ fill: "var(--vscode-muted)", fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "var(--vscode-panel)", border: "1px solid var(--vscode-border)", fontSize: 12 }}
                formatter={(v: number) => fmt(v)}
              />
              <Legend />
              <Bar dataKey="revenue" name="Produits" fill="#22c55e" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expenses" name="Charges" fill="#ef4444" radius={[2, 2, 0, 0]} />
              <Bar dataKey="net" name="Résultat net" fill="#60a5fa" radius={[2, 2, 0, 0]}>
                {current.monthly.map((m, i) => (
                  <Cell key={i} fill={m.net >= 0 ? "#60a5fa" : "#f97316"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Tables côte à côte */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Détail produits */}
        <div className="bg-vscode-panel border border-vscode-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-vscode-border">
            <h2 className="text-sm font-medium text-vscode-text">Produits {year}</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-vscode-muted border-b border-vscode-border">
                <th className="text-left px-4 py-2">Catégorie</th>
                <th className="text-right px-4 py-2">{year}</th>
                <th className="text-right px-4 py-2">{data.prevYear}</th>
              </tr>
            </thead>
            <tbody>
              {current.revenue.map((row) => {
                const prev = previous.revenue.find((r) => r.category === row.category)?.amount ?? 0;
                return (
                  <tr key={row.category} className="border-b border-vscode-border/40 hover:bg-vscode-hover">
                    <td className="px-4 py-1.5 text-vscode-text">{row.label}</td>
                    <td className="px-4 py-1.5 text-right text-green-400">{fmt(row.amount)}</td>
                    <td className="px-4 py-1.5 text-right text-vscode-muted">{fmt(prev)}</td>
                  </tr>
                );
              })}
              {current.revenue.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-3 text-center text-vscode-muted">Aucun produit</td></tr>
              )}
              <tr className="border-t border-vscode-border bg-vscode-sidebar">
                <td className="px-4 py-2 font-medium text-vscode-text">Total</td>
                <td className="px-4 py-2 text-right font-medium text-green-400">{fmt(current.totalRevenue)}</td>
                <td className="px-4 py-2 text-right font-medium text-vscode-muted">{fmt(previous.totalRevenue)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Détail charges */}
        <div className="bg-vscode-panel border border-vscode-border rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-vscode-border">
            <h2 className="text-sm font-medium text-vscode-text">Charges {year}</h2>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-vscode-muted border-b border-vscode-border">
                <th className="text-left px-4 py-2">Catégorie</th>
                <th className="text-right px-4 py-2">{year}</th>
                <th className="text-right px-4 py-2">{data.prevYear}</th>
              </tr>
            </thead>
            <tbody>
              {expenseComparison.map((row) => (
                <tr key={row.category} className="border-b border-vscode-border/40 hover:bg-vscode-hover">
                  <td className="px-4 py-1.5 text-vscode-text">{row.label}</td>
                  <td className="px-4 py-1.5 text-right text-red-400">{fmt(row.amount)}</td>
                  <td className="px-4 py-1.5 text-right text-vscode-muted">{fmt(row.prev)}</td>
                </tr>
              ))}
              {expenseComparison.length === 0 && (
                <tr><td colSpan={3} className="px-4 py-3 text-center text-vscode-muted">Aucune charge</td></tr>
              )}
              <tr className="border-t border-vscode-border bg-vscode-sidebar">
                <td className="px-4 py-2 font-medium text-vscode-text">Total</td>
                <td className="px-4 py-2 text-right font-medium text-red-400">{fmt(current.totalExpenses)}</td>
                <td className="px-4 py-2 text-right font-medium text-vscode-muted">{fmt(previous.totalExpenses)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Ligne de résultat */}
      <div className={`rounded-lg p-4 border flex items-center justify-between ${current.netResult >= 0 ? "bg-green-900/20 border-green-700" : "bg-red-900/20 border-red-700"}`}>
        <span className="text-sm font-semibold text-vscode-text">Résultat net {year}</span>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <span className="text-xs text-vscode-muted block">{year}</span>
            <span className={`text-lg font-bold ${current.netResult >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(current.netResult)}</span>
          </div>
          <div className="text-right">
            <span className="text-xs text-vscode-muted block">{data.prevYear}</span>
            <span className={`text-lg font-bold ${previous.netResult >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(previous.netResult)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
