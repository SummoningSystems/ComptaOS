import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { fetchDashboard, fetchTransactions } from "../../api/client";
import { DashboardData, Transaction } from "../../types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

function formatMonth(m: string) {
  try {
    return format(new Date(`${m}-01`), "MMM yy", { locale: fr });
  } catch {
    return m;
  }
}

function KpiCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-vscode-muted text-[11px] uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-semibold font-mono ${accent ?? "text-vscode-text"}`}>{value}</span>
      {sub && <span className="text-vscode-muted text-xs">{sub}</span>}
    </div>
  );
}

const CAT_COLORS = ["#0078d4", "#7c3aed", "#16a34a", "#d97706", "#dc2626"];

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchDashboard(), fetchTransactions()])
      .then(([dash, txns]) => { setData(dash); setTransactions(txns); })
      .catch(() => { /* data reste null → message d'erreur affiché */ })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Chargement du dashboard…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-vscode-muted text-sm">
        Impossible de charger le dashboard.
      </div>
    );
  }

  // Merge revenues & expenses for the area chart
  const monthSet = new Set([
    ...data.monthly_revenue.map((d) => d.month),
    ...data.monthly_expenses.map((d) => d.month),
  ]);
  const chartData = Array.from(monthSet)
    .sort()
    .map((m) => ({
      month: formatMonth(m),
      revenue: data.monthly_revenue.find((r) => r.month === m)?.amount ?? 0,
      expenses: data.monthly_expenses.find((r) => r.month === m)?.amount ?? 0,
    }));

  const totalRevenue = data.monthly_revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = data.monthly_expenses.reduce((s, r) => s + r.amount, 0);

  // KPIs calculés depuis les transactions brutes
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const validTxns = transactions.filter((t) => t.status !== "rejected");
  const thisMonth = validTxns.filter((t) => t.date.startsWith(currentMonth));
  const thisMonthRevenue = thisMonth.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0);
  const thisMonthExpenses = thisMonth.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.amount_ttc), 0);
  const unjustifiedCount = data.unjustified_count ?? validTxns.filter((t) => t.justified === false).length;
  const rejectedCount = transactions.filter((t) => t.status === "rejected").length;

  // Alertes
  const alerts: { level: "error" | "warn" | "info"; msg: string }[] = [];
  if (unjustifiedCount > 0)
    alerts.push({ level: "warn", msg: `${unjustifiedCount} transaction${unjustifiedCount > 1 ? "s" : ""} sans justificatif` });
  if ((data.misc_count ?? 0) > 0)
    alerts.push({ level: "info", msg: `${data.misc_count} transaction${data.misc_count > 1 ? "s" : ""} non catégorisée${data.misc_count > 1 ? "s" : ""} — utilisez "Smart Catégoriser" dans Transactions` });
  if ((data.runway_months ?? 999) < 3 && data.treasury > 0)
    alerts.push({ level: "error", msg: `Trésorerie critique — runway estimé ${data.runway_months} mois` });
  if ((data.is_estimate ?? 0) > 500)
    alerts.push({ level: "info", msg: `IS estimé ~${data.is_estimate?.toFixed(0)} € à provisionner` });

  const runwayLabel = (months: number) => {
    if (months >= 99) return "∞";
    return `${months} mois`;
  };

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      <h2 className="text-vscode-text text-sm font-semibold">Dashboard financier</h2>

      {/* ── Alertes ──────────────────────────────────────────────────────── */}
      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((a, i) => (
            <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded border text-xs ${
              a.level === "error"
                ? "bg-red-900/30 border-red-700 text-red-300"
                : a.level === "warn"
                ? "bg-yellow-900/30 border-yellow-700 text-yellow-300"
                : "bg-blue-900/20 border-blue-800 text-blue-300"
            }`}>
              <span>{a.level === "error" ? "🔴" : a.level === "warn" ? "⚠️" : "ℹ️"}</span>
              {a.msg}
            </div>
          ))}
        </div>
      )}

      {/* KPI row — mois courant */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={`Revenus ${format(new Date(), "MMMM yyyy", { locale: fr })}`}
          value={`+${thisMonthRevenue.toFixed(2)} €`}
          accent="text-green-400"
        />
        <KpiCard
          label={`Dépenses ${format(new Date(), "MMMM yyyy", { locale: fr })}`}
          value={`-${thisMonthExpenses.toFixed(2)} €`}
          accent="text-red-400"
        />
        <KpiCard
          label="À justifier"
          value={String(unjustifiedCount)}
          sub={unjustifiedCount === 0 ? "Tout est OK ✓" : "transactions sans justificatif"}
          accent={unjustifiedCount > 0 ? "text-yellow-400" : "text-green-400"}
        />
        {rejectedCount > 0 && (
          <KpiCard
            label="Transactions rejetées"
            value={String(rejectedCount)}
            sub="masquées par défaut"
            accent="text-vscode-muted"
          />
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={data.bank_balance !== undefined ? "Solde bancaire" : "Variation importée"}
          value={`${data.treasury.toFixed(2)} €`}
          sub={data.bank_balance_updated_at
            ? `Powens, actualisé le ${new Date(data.bank_balance_updated_at).toLocaleString("fr-FR")}`
            : data.bank_balance !== undefined
              ? "dernier solde Powens connu — synchronisez la banque pour l'actualiser"
              : "aucun solde bancaire synchronisé"}
          accent={data.treasury >= 0 ? "text-green-400" : "text-red-400"}
        />
        <KpiCard
          label="TVA estimée à reverser"
          value={`${data.vat_estimate.toFixed(2)} €`}
          sub="estimation — non officielle"
          accent={data.vat_estimate >= 0 ? "text-yellow-400" : "text-green-400"}
        />
        <KpiCard
          label="Revenus (cumul)"
          value={`${totalRevenue.toFixed(2)} €`}
          accent="text-green-400"
        />
        <KpiCard
          label="Dépenses (cumul)"
          value={`${totalExpenses.toFixed(2)} €`}
          accent="text-red-400"
        />
      </div>

      {/* KPI row — résultat & pilotage */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Résultat net (cumul)"
          value={`${(data.net_result ?? 0) >= 0 ? "+" : ""}${(data.net_result ?? 0).toFixed(2)} €`}
          sub="CA − charges"
          accent={(data.net_result ?? 0) >= 0 ? "text-green-400" : "text-red-400"}
        />
        <KpiCard
          label="IS estimé à provisionner"
          value={(data.is_estimate ?? 0) > 0 ? `~${(data.is_estimate ?? 0).toFixed(2)} €` : "— €"}
          sub={(data.is_estimate ?? 0) > 0 ? "25% sur bénéfice (taux normal)" : "pas de bénéfice"}
          accent={(data.is_estimate ?? 0) > 0 ? "text-orange-400" : "text-vscode-muted"}
        />
        <KpiCard
          label="Runway trésorerie"
          value={runwayLabel(data.runway_months ?? 999)}
          sub="sur base dépenses 3 derniers mois"
          accent={
            (data.runway_months ?? 99) < 2 ? "text-red-400"
            : (data.runway_months ?? 99) < 6 ? "text-yellow-400"
            : "text-green-400"
          }
        />
        <KpiCard
          label="Non catégorisées"
          value={String(data.misc_count ?? 0)}
          sub={(data.misc_count ?? 0) === 0 ? "Tout est catégorisé ✓" : "→ Smart Catégoriser"}
          accent={(data.misc_count ?? 0) > 0 ? "text-yellow-400" : "text-green-400"}
        />
      </div>

      {/* Evolution chart */}
      {chartData.length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-4">Évolution mensuelle</h3>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" />
              <XAxis dataKey="month" tick={{ fill: "#858585", fontSize: 11 }} />
              <YAxis tick={{ fill: "#858585", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12 }}
                labelStyle={{ color: "#d4d4d4" }}
              />
              <Area type="monotone" dataKey="revenue" stroke="#16a34a" fill="url(#revGrad)" name="Revenus" />
              <Area type="monotone" dataKey="expenses" stroke="#dc2626" fill="url(#expGrad)" name="Dépenses" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top categories */}
      {data.top_categories.length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-4">Top catégories de dépenses</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.top_categories} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#858585", fontSize: 11 }} />
              <YAxis type="category" dataKey="category" tick={{ fill: "#d4d4d4", fontSize: 11 }} width={90} />
              <Tooltip
                contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12, color: "#d4d4d4" }}
                labelStyle={{ color: "#d4d4d4" }}
                itemStyle={{ color: "#d4d4d4" }}
              />
              <Bar dataKey="amount" name="Montant (€)" radius={[0, 4, 4, 0]}>
                {data.top_categories.map((_, i) => (
                  <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {chartData.length === 0 && data.top_categories.length === 0 && (
        <div className="text-vscode-muted text-sm text-center py-12">
          Importez des transactions pour voir apparaître les statistiques.
        </div>
      )}

      {/* ── Solde cumulé par mois ───────────────────────────────────────── */}
      {(data.monthly_balance ?? []).length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-1">Historique de trésorerie</h3>
          <p className="text-[10px] text-vscode-muted mb-4">
            {data.bank_balance !== undefined
              ? "Courbe recalée sur le dernier solde bancaire connu."
              : "Variation cumulée depuis la première transaction importée."}
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={(data.monthly_balance ?? []).map((d) => ({ ...d, month: formatMonth(d.month) }))}>
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#0078d4" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#0078d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" />
              <XAxis dataKey="month" tick={{ fill: "#858585", fontSize: 11 }} />
              <YAxis tick={{ fill: "#858585", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12 }}
                labelStyle={{ color: "#d4d4d4" }}
                formatter={(v: number) => [`${v.toFixed(2)} €`, "Solde"]}
              />
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
              <Area type="monotone" dataKey="amount" stroke="#0078d4" fill="url(#balGrad)" name="Solde cumulé" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Prévisions 6 mois ───────────────────────────────────────────── */}
      {(data.forecast ?? []).length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="text-vscode-muted text-xs uppercase tracking-wider">Prévisions 6 mois</h3>
            <span className="text-[10px] text-vscode-muted border border-vscode-border rounded px-1.5 py-0.5">estimation — basée sur charges récurrentes + moyenne revenus</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={(data.forecast ?? []).map((d) => ({ ...d, month: formatMonth(d.month) }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" />
              <XAxis dataKey="month" tick={{ fill: "#858585", fontSize: 11 }} />
              <YAxis tick={{ fill: "#858585", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12 }}
                labelStyle={{ color: "#d4d4d4" }}
                formatter={(v: number) => [`${v.toFixed(2)} €`, "Solde projeté"]}
              />
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="#7c3aed"
                strokeDasharray="6 3"
                dot={{ fill: "#7c3aed", r: 3 }}
                name="Solde projeté"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Répartition par compte ──────────────────────────────────────── */}
      {((data.bank_accounts ?? []).length > 0 || (data.accounts ?? []).length > 1) && (() => {
        const accountData = (data.bank_accounts ?? []).length > 0
          ? data.bank_accounts.map((account) => ({ account: account.name, balance: account.balance, actual: true }))
          : (data.accounts ?? []).map((acc) => {
          const balance = transactions
            .filter((t) => t.account === acc && t.status !== "rejected")
            .reduce((s, t) => s + t.amount_ttc, 0);
          return { account: acc || "Inconnu", balance: parseFloat(balance.toFixed(2)), actual: false };
        });
        return (
          <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
            <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-4">{accountData[0]?.actual ? "Soldes bancaires par compte" : "Variations importées par compte"}</h3>
            <div className="flex flex-wrap gap-3">
              {accountData.map((a) => (
                <div key={a.account} className="flex-1 min-w-[150px] bg-vscode-panel border border-vscode-border rounded p-3">
                  <p className="text-[10px] text-vscode-muted truncate">{a.account}</p>
                  <p className={`text-lg font-mono font-semibold mt-1 ${a.balance >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {a.balance >= 0 ? "+" : ""}{a.balance.toFixed(2)} €
                  </p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
