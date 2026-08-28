import { useEffect, useState } from "react";
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis,
  CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
  ComposedChart, Line,
} from "recharts";
import { fetchDashboard, fetchManualRecurring, fetchTransactions } from "../../api/client";
import { DashboardData, ManualRecurring, Transaction } from "../../types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";
import { CashRunwaySimulator } from "./CashRunwaySimulator";

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function fmtMonth(m: string) {
  try { return format(new Date(`${m}-01`), "MMM yy", { locale: fr }); }
  catch { return m; }
}

function KpiCard({ label, value, sub, accent, help }: { label: string; value: string; sub?: string; accent?: string; help?: string }) {
  return (
    <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-vscode-muted text-[11px] uppercase tracking-wider" title={help}>{label}{help ? " ⓘ" : ""}</span>
      <span className={`text-2xl font-semibold font-mono ${accent ?? "text-vscode-text"}`}>{value}</span>
      {sub && <span className="text-vscode-muted text-xs">{sub}</span>}
    </div>
  );
}

export function TreasuryView() {
  const { categories } = useCategoryCatalog();
  const [data, setData] = useState<DashboardData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [recurring, setRecurring] = useState<ManualRecurring[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([fetchDashboard(), fetchTransactions(), fetchManualRecurring()])
      .then(([d, t, recurringItems]) => {
        setData(d);
        setTransactions(Array.isArray(t) ? t : []);
        setRecurring(Array.isArray(recurringItems) ? recurringItems : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>;
  }
  if (!data) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Impossible de charger les données.</div>;
  }

  // ── Graphique combiné historique + prévisions ──────────────────────────────
  const histPoints = (data.monthly_balance ?? []).map((b) => ({
    month: fmtMonth(b.month),
    solde: b.amount,
    type: "réel",
  }));

  // Dernier solde réel comme point de jonction
  const lastReal = histPoints.at(-1);
  const forecastPoints = (data.forecast ?? []).map((f) => ({
    month: fmtMonth(f.month),
    prevision: f.balance,
    type: "prévision",
  }));

  // Pour le graphique combiné : fusionner avec solde + prevision
  const combinedData: { month: string; solde?: number; prevision?: number }[] = [
    ...histPoints.map((p) => ({ month: p.month, solde: p.solde })),
    // Point de jonction : dernier réel = aussi début prévision
    ...(lastReal
      ? [{ month: lastReal.month, solde: lastReal.solde, prevision: lastReal.solde }]
      : []),
    ...forecastPoints.map((p) => ({ month: p.month, prevision: p.prevision })),
  ];
  // Dédupliquer le point de jonction
  const seen = new Set<string>();
  const chartData = combinedData.filter((p) => {
    if (seen.has(p.month + JSON.stringify(p))) return false;
    seen.add(p.month + JSON.stringify(p));
    return true;
  });

  // ── Table mensuelle ────────────────────────────────────────────────────────
  const monthSet = new Set([
    ...(data.monthly_revenue ?? []).map((r) => r.month),
    ...(data.monthly_expenses ?? []).map((e) => e.month),
  ]);
  let cumulSolde = 0;
  const monthlyTable = Array.from(monthSet).sort().map((m) => {
    const rev = data.monthly_revenue.find((r) => r.month === m)?.amount ?? 0;
    const exp = data.monthly_expenses.find((r) => r.month === m)?.amount ?? 0;
    const net = rev - exp;
    cumulSolde += net;
    return { month: m, rev, exp, net, cumul: cumulSolde };
  });

  // ── Burn rate (moyenne dépenses 3 derniers mois) ───────────────────────────
  const recent3 = monthlyTable.slice(-3);
  const burnRate = recent3.length > 0
    ? recent3.reduce((s, m) => s + m.exp, 0) / recent3.length
    : 0;
  const avgRev3 = recent3.length > 0
    ? recent3.reduce((s, m) => s + m.rev, 0) / recent3.length
    : 0;
  const runwayBase = data.spendable_cash ?? data.treasury;
  const runway = burnRate > 0 ? runwayBase / burnRate : 999;

  // ── 15 dernières transactions non rejetées ─────────────────────────────────
  const recentTxns = transactions
    .filter((t) => t.status !== "rejected")
    .slice(0, 15);

  // ── Taux de couverture (revenus / dépenses) ────────────────────────────────
  const totalRev = (data.monthly_revenue ?? []).reduce((s, r) => s + r.amount, 0);
  const totalExp = (data.monthly_expenses ?? []).reduce((s, r) => s + r.amount, 0);
  const coverage = totalExp > 0 ? (totalRev / totalExp) * 100 : 100;

  // ── Flux mensuel bar chart ─────────────────────────────────────────────────
  const fluxData = monthlyTable.map((m) => ({
    month: fmtMonth(m.month),
    revenus: parseFloat(m.rev.toFixed(2)),
    dépenses: parseFloat(m.exp.toFixed(2)),
    net: parseFloat(m.net.toFixed(2)),
  }));

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      <div>
        <h2 className="text-vscode-text text-sm font-semibold">Trésorerie</h2>
        <p className="text-[10px] text-vscode-muted mt-1">
          {data.bank_balance_updated_at
            ? `Solde Powens actualisé le ${new Date(data.bank_balance_updated_at).toLocaleString("fr-FR")}.`
            : data.bank_balance !== undefined
              ? "Dernier solde Powens connu sans date d'actualisation : synchronisez la banque."
              : "Aucun solde bancaire disponible : les valeurs reposent sur les mouvements importés."}
        </p>
      </div>

      {data.bank_balance !== undefined && (
        <div className="rounded border border-blue-800 bg-blue-900/20 px-3 py-2 text-xs text-blue-200">
          Les transactions importées représentent une variation de {fmt(data.transaction_flow)}. Le solde bancaire de {fmt(data.bank_balance)} sert de référence aux projections ; l'écart de {fmt(data.balance_difference ?? 0)} correspond notamment au solde antérieur au début de l'historique importé.
        </div>
      )}

      <section className="rounded-lg border border-amber-700/70 bg-amber-950/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-amber-200">Trésorerie réellement disponible</h3><p className="mt-1 text-[10px] text-vscode-muted">Solde bancaire diminué de la provision TVA conseillée. Estimation de pilotage, pas une déclaration fiscale.</p></div>{data.next_vat_due && <div className="rounded border border-amber-800 px-3 py-2 text-right text-[10px] text-amber-200"><strong>{data.next_vat_due.label}</strong><br/>{data.next_vat_due.period} · environ {fmt(data.next_vat_due.estimated_amount)}</div>}</div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4"><KpiCard label="Solde bancaire" value={fmt(data.treasury)} sub="argent présent sur les comptes"/><KpiCard label="TVA collectée" value={fmt(data.vat_collected ?? 0)} sub="sur les encaissements de l’année" accent="text-blue-300"/><KpiCard label="Provision TVA" value={`−${fmt(data.vat_reserve ?? 0)}`} sub={`déductible ${fmt(data.vat_deductible ?? 0)} · payée ${fmt(data.vat_payments ?? 0)}`} accent="text-amber-300"/><KpiCard label="Disponible à dépenser" value={fmt(data.spendable_cash ?? data.treasury)} sub="après mise à l’écart de la TVA" accent={(data.spendable_cash ?? data.treasury) >= 0 ? "text-green-300" : "text-red-400"}/></div>
        <p className="mt-3 text-[10px] text-vscode-muted">Pour qu’un règlement déjà versé soit déduit de la provision, ajoute le tag <code className="text-vscode-text">vat_payment</code> à la transaction ou conserve un libellé explicite TVA/CA3/CA12.</p>
      </section>

      <CashRunwaySimulator startBalance={data.spendable_cash ?? data.treasury} recurring={recurring} transactions={transactions} />

      {/* ── KPIs principaux ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label={data.bank_balance !== undefined ? "Solde bancaire" : "Variation importée"}
          value={fmt(data.treasury)}
          sub={data.bank_balance !== undefined ? "dernier solde Powens connu" : "depuis la première transaction"}
          help="Argent disponible selon la dernière synchronisation bancaire."
          accent={data.treasury >= 0 ? "text-green-400" : "text-red-400"}
        />
        <KpiCard
          label="Burn rate / mois"
          value={fmt(burnRate)}
          sub="moyenne dépenses 3 derniers mois"
          accent="text-orange-400"
        />
        <KpiCard
          label="Runway estimé"
          value={runway >= 99 ? "∞" : `${runway.toFixed(1)} mois`}
          sub={runway < 3 ? "⚠️ Critique" : runway < 6 ? "Attention" : "Bonne santé"}
          accent={runway < 3 ? "text-red-400" : runway < 6 ? "text-yellow-400" : "text-green-400"}
        />
        <KpiCard
          label="Taux de couverture"
          value={`${coverage.toFixed(0)} %`}
          sub="revenus / dépenses (cumul)"
          accent={coverage >= 100 ? "text-green-400" : "text-red-400"}
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="CA total"
          value={fmt(totalRev)}
          accent="text-green-400"
        />
        <KpiCard
          label="Charges totales"
          value={fmt(totalExp)}
          accent="text-red-400"
        />
        <KpiCard
          label={`Flux net TTC ${data.current_year}`}
          value={(totalRev - totalExp >= 0 ? "+" : "") + fmt(totalRev - totalExp)}
          sub="encaissements − décaissements"
          help="Variation produite par les transactions de l'exercice. Ce n'est ni le solde bancaire ni le résultat comptable HT."
          accent={(totalRev - totalExp) >= 0 ? "text-green-400" : "text-red-400"}
        />
        <KpiCard
          label="Revenu moyen / mois"
          value={fmt(avgRev3)}
          sub="moyenne 3 derniers mois"
          accent="text-blue-400"
        />
      </div>

      {/* ── Évolution solde + prévisions ────────────────────────────────── */}
      <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
        <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-4">
          Évolution du solde cumulé + prévisions 6 mois
        </h3>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="soldGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0078d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#0078d4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" />
            <XAxis dataKey="month" tick={{ fill: "#858585", fontSize: 11 }} />
            <YAxis tick={{ fill: "#858585", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12 }}
              labelStyle={{ color: "#d4d4d4" }}
              formatter={(v: number, name: string) => [fmt(v), name]}
            />
            <ReferenceLine y={0} stroke="#3c3c3c" strokeWidth={1} />
            <Area
              type="monotone"
              dataKey="solde"
              stroke="#0078d4"
              fill="url(#soldGrad)"
              strokeWidth={2}
              dot={false}
              name="Solde réel"
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="prevision"
              stroke="#7c3aed"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              name="Prévision"
              connectNulls
            />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-[11px] text-vscode-muted">
          <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-blue-500"></span>Solde réel</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-purple-500" style={{borderTop: "2px dashed #7c3aed", height: 0}}></span>Prévision</span>
        </div>
      </div>

      {/* ── Flux mensuels (bar chart) ────────────────────────────────────── */}
      {fluxData.length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-4">Flux mensuels</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={fluxData} barSize={12}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3c3c3c" />
              <XAxis dataKey="month" tick={{ fill: "#858585", fontSize: 11 }} />
              <YAxis tick={{ fill: "#858585", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#252526", border: "1px solid #3c3c3c", fontSize: 12 }}
                labelStyle={{ color: "#d4d4d4" }}
                formatter={(v: number, name: string) => [fmt(v), name]}
              />
              <ReferenceLine y={0} stroke="#5c5c5c" />
              <Bar dataKey="revenus" fill="#16a34a" name="Revenus" radius={[2, 2, 0, 0]} />
              <Bar dataKey="dépenses" fill="#dc2626" name="Dépenses" radius={[2, 2, 0, 0]} />
              <Bar dataKey="net" fill="#0078d4" name="Flux net" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Table mensuelle détaillée ──────────────────────────────────── */}
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-3">Synthèse mensuelle</h3>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-vscode-muted border-b border-vscode-border">
                  <th className="text-left py-1 pr-3">Mois</th>
                  <th className="text-right pr-3">Revenus</th>
                  <th className="text-right pr-3">Dépenses</th>
                  <th className="text-right pr-3">Flux net</th>
                  <th className="text-right">Solde cumulé</th>
                </tr>
              </thead>
              <tbody>
                {[...monthlyTable].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-vscode-border/40 hover:bg-vscode-panel/40">
                    <td className="py-1 pr-3 text-vscode-text">{fmtMonth(m.month)}</td>
                    <td className="text-right pr-3 text-green-400">{fmt(m.rev)}</td>
                    <td className="text-right pr-3 text-red-400">{fmt(m.exp)}</td>
                    <td className={`text-right pr-3 font-mono ${m.net >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {m.net >= 0 ? "+" : ""}{fmt(m.net)}
                    </td>
                    <td className={`text-right font-mono ${m.cumul >= 0 ? "text-blue-400" : "text-red-400"}`}>
                      {fmt(m.cumul)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Dernières transactions ──────────────────────────────────────── */}
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-3">Derniers mouvements</h3>
          <div className="overflow-auto max-h-64 flex flex-col gap-1">
            {recentTxns.length === 0 ? (
              <p className="text-vscode-muted text-xs">Aucune transaction.</p>
            ) : (
              recentTxns.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-1 border-b border-vscode-border/40 gap-2">
                  <div className="flex flex-col min-w-0">
                    <span className="text-vscode-text text-xs truncate max-w-[220px]" title={t.label}>{t.label}</span>
                    <span className="text-vscode-muted text-[10px]">{t.date} · {categories.find((category) => category.id === t.category)?.label ?? t.category}</span>
                  </div>
                  <span className={`text-xs font-mono shrink-0 ${t.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {t.amount_ttc >= 0 ? "+" : ""}{fmt(t.amount_ttc)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Prévisions mois par mois ─────────────────────────────────────── */}
      {(data.forecast ?? []).length > 0 && (
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
          <h3 className="text-vscode-muted text-xs uppercase tracking-wider mb-3">Prévisions 6 mois</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {data.forecast.map((f) => (
              <div key={f.month} className="bg-vscode-panel border border-vscode-border rounded p-3 flex flex-col gap-1">
                <span className="text-vscode-muted text-[10px] uppercase">{fmtMonth(f.month)}</span>
                <span className={`text-sm font-mono font-semibold ${f.balance >= 0 ? "text-blue-400" : "text-red-400"}`}>
                  {fmt(f.balance)}
                </span>
                <span className="text-[10px] text-purple-400">prévision</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
