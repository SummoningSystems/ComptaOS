import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

interface JournalEntry {
  date: string;
  label: string;
  account_debit: string;
  account_credit: string;
  account_vat?: string;
  amount_ht: number;
  amount_vat: number;
  amount_ttc: number;
  category: string;
  pcg_label: string;
  reconciled: boolean;
  txn_id: string;
}

interface JournalData {
  entries: JournalEntry[];
  totalDebit: number;
  totalCredit: number;
  years: string[];
}

const MONTH_LABELS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function JournalView() {
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [onlyUnreconciled, setOnlyUnreconciled] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year });
      if (month) params.set("month", month.padStart(2, "0"));
      const { data: d } = await api.get<JournalData>(`/journal?${params}`);
      setData(d && Array.isArray(d.entries) ? d : { entries: [], totalDebit: 0, totalCredit: 0, years: [year] });
    } catch {
      setData({ entries: [], totalDebit: 0, totalCredit: 0, years: [year] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [year, month]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.entries;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((e) =>
        e.label.toLowerCase().includes(q) ||
        e.account_debit.includes(q) ||
        e.account_credit.includes(q) ||
        e.pcg_label.toLowerCase().includes(q)
      );
    }
    if (onlyUnreconciled) list = list.filter((e) => !e.reconciled);
    return list;
  }, [data, search, onlyUnreconciled]);

  const totalDebit  = filtered.reduce((s, e) => s + e.amount_ttc, 0);
  const totalCredit = totalDebit;

  function handlePrint() { window.print(); }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-vscode-border shrink-0 bg-vscode-panel flex-wrap">
        <span className="text-xs font-semibold text-vscode-text">📒 Journal comptable</span>

        {/* Année */}
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded"
        >
          {(data?.years ?? [String(new Date().getFullYear())]).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {/* Mois */}
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded"
        >
          <option value="">Tous les mois</option>
          {MONTH_LABELS.map((m, i) => (
            <option key={i} value={String(i + 1).padStart(2, "0")}>{m}</option>
          ))}
        </select>

        {/* Recherche */}
        <input
          type="text"
          placeholder="Filtrer libellé / compte…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-48 focus:outline-none focus:border-vscode-accent"
        />

        <label className="flex items-center gap-1.5 text-xs text-vscode-muted cursor-pointer">
          <input
            type="checkbox"
            checked={onlyUnreconciled}
            onChange={(e) => setOnlyUnreconciled(e.target.checked)}
            className="accent-vscode-accent"
          />
          Non réconciliées
        </label>

        <span className="ml-auto text-[10px] text-vscode-muted">{filtered.length} écriture{filtered.length > 1 ? "s" : ""}</span>

        <button
          onClick={handlePrint}
          className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
          title="Imprimer / PDF"
        >
          🖨 PDF
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center flex-1 text-vscode-muted text-xs">
          Chargement…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-vscode-muted gap-2">
          <span className="text-3xl">📭</span>
          <p className="text-sm">Aucune écriture pour cette période.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-vscode-panel z-10">
              <tr className="text-vscode-muted text-[11px] uppercase tracking-wider border-b border-vscode-border">
                <th className="text-left px-3 py-2 w-24">Date</th>
                <th className="text-left px-3 py-2">Libellé</th>
                <th className="text-left px-3 py-2 w-28">Compte PCG (débit)</th>
                <th className="text-left px-3 py-2 w-28">Compte (crédit)</th>
                <th className="text-left px-3 py-2 w-44">Intitulé PCG</th>
                <th className="text-right px-3 py-2 w-24">HT</th>
                <th className="text-right px-3 py-2 w-20">TVA</th>
                <th className="text-right px-3 py-2 w-24">TTC</th>
                <th className="text-center px-3 py-2 w-10">✓</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vscode-border/30">
              {filtered.map((e, i) => (
                <tr
                  key={e.txn_id + i}
                  className={`hover:bg-vscode-panel/50 transition-colors ${e.reconciled ? "opacity-60" : ""}`}
                >
                  <td className="px-3 py-1.5 text-vscode-muted font-mono">{e.date}</td>
                  <td className="px-3 py-1.5 text-vscode-text truncate max-w-[200px]" title={e.label}>{e.label}</td>
                  <td className="px-3 py-1.5 font-mono text-blue-300">{e.account_debit}</td>
                  <td className="px-3 py-1.5 font-mono text-vscode-muted">{e.account_credit}</td>
                  <td className="px-3 py-1.5 text-vscode-muted truncate" title={e.pcg_label}>{e.pcg_label}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-vscode-text">{fmt(e.amount_ht)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-yellow-300">{e.amount_vat > 0 ? fmt(e.amount_vat) : "—"}</td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${e.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmt(e.amount_ttc)}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {e.reconciled ? <span className="text-green-400 text-sm">✓</span> : <span className="text-vscode-muted text-sm">○</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="sticky bottom-0 bg-vscode-panel border-t-2 border-vscode-border">
              <tr className="font-semibold text-vscode-text">
                <td className="px-3 py-2" colSpan={5}>Total</td>
                <td className="px-3 py-2 text-right font-mono">
                  {fmt(filtered.reduce((s, e) => s + e.amount_ht, 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-yellow-300">
                  {fmt(filtered.reduce((s, e) => s + e.amount_vat, 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-vscode-accent">
                  {fmt(totalDebit)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
