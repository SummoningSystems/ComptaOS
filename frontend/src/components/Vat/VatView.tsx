import { useEffect, useState } from "react";
import { apiUrl, fetchVatSummary, updateTransaction, type VatQuarterData, type VatSummaryData, type VatTransactionDetail } from "../../api/client";
import type { Category } from "../../types";

type VatSplit = { rate: number; amount_ttc: number };

const CATEGORIES: Category[] = [
  "hosting", "software", "salary", "travel", "restaurant", "food",
  "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc",
];

const VAT_RATE_PRESETS = [0, 2.1, 5.5, 10, 20];

function roundVatRate(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatVatRateInput(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundVatRate(value));
}

function EditableTextCell({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (nextValue: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      return;
    }
    await onSave(trimmed);
  }

  return (
    <input
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { void commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-vscode-text focus:bg-vscode-bg focus:border-vscode-accent focus:outline-none disabled:opacity-60"
      aria-label="Libellé de transaction"
    />
  );
}

function EditableCategoryCell({
  value,
  disabled,
  onSave,
}: {
  value: Category;
  disabled: boolean;
  onSave: (nextValue: Category) => Promise<void>;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => { void onSave(e.target.value as Category); }}
      className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-vscode-muted focus:bg-vscode-bg focus:border-vscode-accent focus:outline-none disabled:opacity-60"
      aria-label="Catégorie de transaction"
    >
      {CATEGORIES.map((category) => (
        <option key={category} value={category}>{category}</option>
      ))}
    </select>
  );
}

function EditableVatRateCell({
  value,
  disabled,
  onSave,
}: {
  value: number;
  disabled: boolean;
  onSave: (nextValue: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(formatVatRateInput(value));

  useEffect(() => {
    setDraft(formatVatRateInput(value));
  }, [value]);

  async function commit() {
    const parsed = Number(draft.replace(",", "."));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setDraft(formatVatRateInput(value));
      return;
    }

    const normalized = roundVatRate(parsed);
    if (Math.abs(normalized - value) < 0.001) {
      setDraft(formatVatRateInput(value));
      return;
    }

    await onSave(normalized);
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <input
        list="vat-rate-presets-vat-view"
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(formatVatRateInput(value));
            e.currentTarget.blur();
          }
        }}
        className="w-16 bg-transparent border border-transparent rounded px-1 py-0.5 text-right font-mono text-vscode-text focus:bg-vscode-bg focus:border-vscode-accent focus:outline-none disabled:opacity-60"
        aria-label="Taux de TVA"
      />
      <span className="text-vscode-muted">%</span>
    </div>
  );
}

// ── Composant SplitEditor ─────────────────────────────────────────────────────
function SplitEditor({
  amountTtc,
  initialSplits,
  disabled,
  onSave,
  onCancel,
}: {
  amountTtc: number;
  initialSplits: VatSplit[];
  disabled: boolean;
  onSave: (splits: VatSplit[]) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<VatSplit[]>(
    initialSplits.length >= 2
      ? initialSplits
      : [
          { rate: 10, amount_ttc: 0 },
          { rate: 20, amount_ttc: amountTtc },
        ]
  );

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const sign = amountTtc < 0 ? -1 : 1;
  const sumTtc = r2(draft.reduce((s, sp) => s + sp.amount_ttc, 0));
  const remaining = r2(amountTtc - sumTtc);
  const isValid = Math.abs(remaining) < 0.005 && draft.length >= 2;

  function updateRate(i: number, rate: number) {
    setDraft((d) => d.map((sp, idx) => idx === i ? { ...sp, rate } : sp));
  }

  function updateAmount(i: number, absVal: number) {
    setDraft((d) => d.map((sp, idx) => idx === i ? { ...sp, amount_ttc: r2(sign * absVal) } : sp));
  }

  function fillRemaining(i: number) {
    setDraft((d) => {
      const otherSum = d.reduce((s, sp, idx) => idx !== i ? s + sp.amount_ttc : s, 0);
      return d.map((sp, idx) => idx === i ? { ...sp, amount_ttc: r2(amountTtc - otherSum) } : sp);
    });
  }

  function addRow() {
    setDraft((d) => [...d, { rate: 20, amount_ttc: remaining }]);
  }

  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  return (
    <div className="rounded bg-vscode-bg border border-vscode-accent/40 px-4 py-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-vscode-muted uppercase tracking-wide">
          Ventilation TVA — Total TTC : {Math.abs(amountTtc).toFixed(2)} €
        </p>
      </div>

      <div className="space-y-1.5">
        {draft.map((split, i) => (
          <div key={i} className="flex items-center gap-2">
            <select
              value={split.rate}
              onChange={(e) => updateRate(i, Number(e.target.value))}
              className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
            >
              {VAT_RATE_PRESETS.map((r) => (
                <option key={r} value={r}>{r} %</option>
              ))}
            </select>
            <span className="text-vscode-muted text-xs">TTC</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={Math.abs(split.amount_ttc).toFixed(2)}
              onChange={(e) => updateAmount(i, parseFloat(e.target.value) || 0)}
              className="w-24 bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 text-right font-mono focus:outline-none focus:border-vscode-accent"
            />
            <span className="text-vscode-muted text-xs">€</span>
            <button
              onClick={() => fillRemaining(i)}
              title="Mettre le solde restant"
              className="text-[10px] text-vscode-muted hover:text-blue-300 border border-vscode-border/50 rounded px-1.5 py-0.5"
            >↻</button>
            <button
              onClick={() => removeRow(i)}
              className="text-[10px] text-vscode-muted hover:text-red-400 ml-1"
            >✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 pt-1 flex-wrap">
        <button
          onClick={addRow}
          className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
        >+ Ajouter un taux</button>

        <span className={`text-xs font-mono ${isValid ? "text-green-400" : "text-orange-400"}`}>
          {isValid ? "✓ Équilibré" : `Restant : ${Math.abs(remaining).toFixed(2)} €`}
        </span>

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => void onSave([])}
            disabled={disabled}
            className="text-xs text-vscode-muted hover:text-red-400 border border-vscode-border/50 rounded px-2 py-1"
          >Supprimer la ventilation</button>
          <button
            onClick={onCancel}
            className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
          >Annuler</button>
          <button
            onClick={() => void onSave(draft)}
            disabled={!isValid || disabled}
            className="text-xs bg-vscode-accent/20 text-vscode-accent border border-vscode-accent/30 rounded px-3 py-1 disabled:opacity-40"
          >Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function Ca3Panel({ quarters, total, year }: { quarters: VatQuarterData[]; total: VatSummaryData["total"]; year: string }) {
  const [selectedQ, setSelectedQ] = useState<string>("annual");

  const activeData = selectedQ === "annual"
    ? { revenue: quarters.reduce((s, q) => s + q.revenue, 0), expenses: quarters.reduce((s, q) => s + q.expenses, 0), collected: total.collected, deductible: total.deductible, net: total.net }
    : (() => { const q = quarters.find(q => q.quarter === selectedQ); return q ? { revenue: q.revenue, expenses: q.expenses, collected: q.collected, deductible: q.deductible, net: q.net } : null; })();

  if (!activeData) return null;
  const data = activeData;

  const baseHT = data.revenue > 0 ? data.revenue - data.collected : 0;
  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function copyToClipboard() {
    const text = [
      `SIMULATION CA3 — ${selectedQ === "annual" ? `Annuel ${year}` : `${selectedQ} ${year}`}`,
      ``,
      `A  — Base HT (ventes 20%) :          ${fmt(baseHT)} €`,
      `08 — TVA collectée :                 ${fmt(data.collected)} €`,
      `20 — TVA déductible (achats) :       ${fmt(data.deductible)} €`,
      `28 — Total taxe due (ligne 08) :     ${fmt(data.collected)} €`,
      `29 — Total taxe déductible :         ${fmt(data.deductible)} €`,
      `52 — TVA à payer (28 - 29) :         ${fmt(data.net)} €`,
    ].join("\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const Ca3Row = ({ code, label, value, bold, color }: { code: string; label: string; value: number; bold?: boolean; color?: string }) => (
    <div className={`flex items-center gap-2 px-4 py-2 border-b border-vscode-border/40 ${bold ? "bg-vscode-panel/50" : ""}`}>
      <span className="font-mono text-[10px] text-vscode-muted w-6 shrink-0">{code}</span>
      <span className={`flex-1 text-xs ${bold ? "font-semibold text-vscode-text" : "text-vscode-muted"}`}>{label}</span>
      <span className={`font-mono tabular-nums text-xs w-32 text-right ${color ?? "text-vscode-text"} ${bold ? "font-bold" : ""}`}>
        {fmt(value)} €
      </span>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide">Simulation CA3</h3>
        <div className="flex items-center gap-2">
          <select
            value={selectedQ}
            onChange={(e) => setSelectedQ(e.target.value)}
            className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
          >
            <option value="annual">Annuel {year}</option>
            {quarters.map((q) => <option key={q.quarter} value={q.quarter}>{q.quarter} {year}</option>)}
          </select>
          <button
            onClick={copyToClipboard}
            className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1 flex items-center gap-1"
          >
            📋 Copier
          </button>
          <a
            href={apiUrl(`/reports/vat-pdf?year=${year}&quarter=${selectedQ}`)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1 flex items-center gap-1"
          >
            📄 PDF
          </a>
        </div>
      </div>

      <div className="border border-vscode-border rounded overflow-hidden text-xs">
        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-blue-400 uppercase tracking-widest">
          OPÉRATIONS IMPOSABLES — {selectedQ === "annual" ? `Année ${year}` : `${selectedQ} ${year}`}
        </div>
        <Ca3Row code="A" label="Base HT des opérations imposables à 20 %" value={baseHT} />
        <Ca3Row code="08" label="Taxe due à 20 %" value={data.collected} color="text-blue-300" bold />

        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-green-400 uppercase tracking-widest border-t border-vscode-border">
          TVA DÉDUCTIBLE
        </div>
        <Ca3Row code="20" label="TVA déductible sur autres biens et services" value={data.deductible} color="text-green-300" />

        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-orange-400 uppercase tracking-widest border-t border-vscode-border">
          RÉSULTAT
        </div>
        <Ca3Row code="28" label="Total taxe due" value={data.collected} />
        <Ca3Row code="29" label="Total taxe déductible" value={data.deductible} />

        <div className={`flex items-center gap-2 px-4 py-3 border-t-2 ${data.net > 0 ? "border-orange-600 bg-orange-900/20" : "border-green-600 bg-green-900/20"}`}>
          <span className="font-mono text-[10px] text-vscode-muted w-6 shrink-0">52</span>
          <span className="flex-1 font-bold text-vscode-text text-xs">
            {data.net > 0 ? "TVA à payer (ligne 28 − 29)" : "Crédit de TVA"}
          </span>
          <span className={`font-mono tabular-nums font-bold text-base w-32 text-right ${data.net > 0 ? "text-orange-300" : "text-green-300"}`}>
            {fmt(Math.abs(data.net))} €
          </span>
        </div>
      </div>

      <p className="text-[10px] text-vscode-muted mt-2">
        ⚠ Simulation à titre indicatif. Vérifiez avec votre expert-comptable avant dépôt sur impots.gouv.fr.
      </p>
    </div>
  );
}

export function VatView() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(String(currentYear));
  const [data, setData] = useState<VatSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailQuarter, setDetailQuarter] = useState<string>("annual");
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [splitEditId, setSplitEditId] = useState<string | null>(null);

  async function load(y: string) {
    setLoading(true);
    try {
      const summary = await fetchVatSummary(y);
      setData(summary);
    } finally {
      setLoading(false);
    }
  }

  async function saveDetailPatch(id: string, patch: { label?: string; category?: Category; vat_rate?: number; vat_splits?: VatSplit[] }) {
    setSavingIds((current) => current.includes(id) ? current : [...current, id]);
    try {
      await updateTransaction(id, patch);
      await load(year);
    } finally {
      setSavingIds((current) => current.filter((item) => item !== id));
    }
  }

  useEffect(() => { load(year); }, [year]);

  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h2 className="text-vscode-text text-base font-semibold">Déclaration TVA</h2>
        <select
          value={year}
          onChange={(e) => setYear(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
        >
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button
          onClick={() => load(year)}
          className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
        >
          ↺ Recharger
        </button>
        {loading && <span className="text-vscode-muted text-xs">Calcul…</span>}
      </div>

      {data && (
        <>
          <datalist id="vat-rate-presets-vat-view">
            {VAT_RATE_PRESETS.map((rate) => (
              <option key={rate} value={rate} />
            ))}
          </datalist>

          {/* Résumé annuel */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl">
            <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA collectée</p>
              <p className="text-xl font-mono font-semibold text-blue-300">+{data.total.collected.toFixed(2)} €</p>
              <p className="text-[10px] text-vscode-muted mt-1">sur revenus encaissés</p>
            </div>
            <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA déductible</p>
              <p className="text-xl font-mono font-semibold text-green-300">−{data.total.deductible.toFixed(2)} €</p>
              <p className="text-[10px] text-vscode-muted mt-1">sur dépenses pro</p>
            </div>
            <div className={`bg-vscode-sidebar border rounded-lg p-4 ${data.total.net > 0 ? "border-orange-700" : "border-vscode-border"}`}>
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA nette à reverser</p>
              <p className={`text-xl font-mono font-semibold ${data.total.net > 0 ? "text-orange-300" : "text-green-300"}`}>
                {data.total.net >= 0 ? "+" : ""}{data.total.net.toFixed(2)} €
              </p>
              <p className="text-[10px] text-vscode-muted mt-1">
                {data.total.net > 0 ? "À payer à la DGFiP" : "Crédit de TVA"}
              </p>
            </div>
          </div>

          {/* Note d'avertissement */}
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded px-3 py-2 text-[11px] text-yellow-300/80 max-w-2xl">
            ⚠ Ces montants sont calculés à partir des taux TVA actuellement enregistrés sur chaque transaction. Après une modification de taux dans l'onglet Transactions, clique sur Recharger pour recalculer immédiatement ce tableau.
          </div>

          {/* Tableau par trimestre */}
          <div className="max-w-3xl">
            <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide mb-3">Détail par trimestre — {year}</h3>            <table className="w-full text-xs border border-vscode-border rounded overflow-hidden">
              <thead className="bg-vscode-panel">
                <tr>
                  <th className="text-left px-4 py-2 text-vscode-muted">Trimestre</th>
                  <th className="text-right px-3 py-2 text-vscode-muted">CA HT</th>
                  <th className="text-right px-3 py-2 text-vscode-muted">Dépenses HT</th>
                  <th className="text-right px-3 py-2 text-blue-400/70">TVA collectée</th>
                  <th className="text-right px-3 py-2 text-green-400/70">TVA déductible</th>
                  <th className="text-right px-4 py-2 text-orange-400/70">Net à reverser</th>
                </tr>
              </thead>
              <tbody>
                {data.quarters.map((q) => {
                  const isEmpty = q.collected === 0 && q.deductible === 0;
                  return (
                    <tr key={q.quarter} className={`border-t border-vscode-border ${isEmpty ? "opacity-40" : ""}`}>
                      <td className="px-4 py-2 font-semibold text-vscode-text">{q.quarter} {year}</td>
                      <td className="text-right px-3 py-2 text-green-400 tabular-nums">
                        {q.revenue > 0 ? `+${q.revenue.toFixed(2)} €` : "—"}
                      </td>
                      <td className="text-right px-3 py-2 text-red-400 tabular-nums">
                        {q.expenses > 0 ? `−${q.expenses.toFixed(2)} €` : "—"}
                      </td>
                      <td className="text-right px-3 py-2 text-blue-300 tabular-nums font-mono">
                        {q.collected > 0 ? `${q.collected.toFixed(2)} €` : "0.00 €"}
                      </td>
                      <td className="text-right px-3 py-2 text-green-300 tabular-nums font-mono">
                        {q.deductible > 0 ? `${q.deductible.toFixed(2)} €` : "0.00 €"}
                      </td>
                      <td className={`text-right px-4 py-2 font-mono font-semibold tabular-nums ${q.net > 0 ? "text-orange-300" : q.net < 0 ? "text-green-300" : "text-vscode-muted"}`}>
                        {q.net > 0 ? `+${q.net.toFixed(2)} €` : q.net < 0 ? `${q.net.toFixed(2)} €` : "—"}
                      </td>
                    </tr>
                  );
                })}
                {/* Total */}
                <tr className="border-t-2 border-vscode-accent bg-vscode-panel">
                  <td className="px-4 py-2 font-bold text-vscode-text">TOTAL {year}</td>
                  <td colSpan={2} />
                  <td className="text-right px-3 py-2 text-blue-300 font-mono font-bold tabular-nums">
                    {data.total.collected.toFixed(2)} €
                  </td>
                  <td className="text-right px-3 py-2 text-green-300 font-mono font-bold tabular-nums">
                    {data.total.deductible.toFixed(2)} €
                  </td>
                  <td className={`text-right px-4 py-2 font-mono font-bold tabular-nums ${data.total.net > 0 ? "text-orange-300" : "text-green-300"}`}>
                    {data.total.net >= 0 ? "+" : ""}{data.total.net.toFixed(2)} €
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Simulateur CA3 */}
          <Ca3Panel quarters={data.quarters} total={data.total} year={year} />

          <div className="max-w-5xl">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide">Transactions avec TVA</h3>
              <div className="flex items-center gap-3">
                {savingIds.length > 0 && <span className="text-[11px] text-vscode-muted">Enregistrement…</span>}
                <select
                  value={detailQuarter}
                  onChange={(e) => setDetailQuarter(e.target.value)}
                  className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
                >
                  <option value="annual">Annuel {year}</option>
                  {data.quarters.map((q) => <option key={q.quarter} value={q.quarter}>{q.quarter} {year}</option>)}
                </select>
              </div>
            </div>

            <div className="border border-vscode-border rounded overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-vscode-panel">
                  <tr>
                    <th className="text-left px-3 py-2 text-vscode-muted">Date</th>
                    <th className="text-left px-3 py-2 text-vscode-muted">Libellé</th>
                    <th className="text-left px-3 py-2 text-vscode-muted">Catégorie</th>
                    <th className="text-right px-3 py-2 text-vscode-muted">Taux</th>
                    <th className="text-right px-3 py-2 text-vscode-muted">HT</th>
                    <th className="text-right px-3 py-2 text-vscode-muted">TVA</th>
                    <th className="text-right px-3 py-2 text-vscode-muted">TTC</th>
                    <th className="text-left px-3 py-2 text-vscode-muted">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.details
                    .filter((item) => detailQuarter === "annual" || item.quarter === detailQuarter)
                    .flatMap((item) => {
                      const hasSplits = item.vat_splits && item.vat_splits.length >= 2;
                      const isEditingSplit = splitEditId === item.id;
                      const isSaving = savingIds.includes(item.id);

                      async function saveSplits(splits: VatSplit[]) {
                        // splits vide = supprimer la ventilation
                        await saveDetailPatch(item.id, { vat_splits: splits });
                        setSplitEditId(null);
                      }

                      const mainRow = (
                        <tr key={item.id} className="border-t border-vscode-border">
                          <td className="px-3 py-2 text-vscode-muted font-mono">{item.date}</td>
                          <td className="px-3 py-2 text-vscode-text min-w-[220px]">
                            <EditableTextCell
                              value={item.label}
                              disabled={isSaving}
                              onSave={(label) => saveDetailPatch(item.id, { label })}
                            />
                          </td>
                          <td className="px-3 py-2 text-vscode-muted min-w-[140px]">
                            <EditableCategoryCell
                              value={item.category as Category}
                              disabled={isSaving}
                              onSave={(category) => saveDetailPatch(item.id, { category })}
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-vscode-text">
                            {hasSplits ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-xs text-vscode-muted">~{item.vat_rate.toFixed(1)} %</span>
                                <button
                                  onClick={() => setSplitEditId(isEditingSplit ? null : item.id)}
                                  className="text-[10px] bg-blue-900/30 text-blue-300 border border-blue-800/40 rounded px-1.5 py-0.5 hover:bg-blue-900/50"
                                >multi ✏</button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                <EditableVatRateCell
                                  value={item.vat_rate}
                                  disabled={isSaving}
                                  onSave={(vat_rate) => saveDetailPatch(item.id, { vat_rate })}
                                />
                                <button
                                  onClick={() => setSplitEditId(isEditingSplit ? null : item.id)}
                                  title="Ventiler la TVA (multi-taux)"
                                  className="text-[11px] text-vscode-muted hover:text-blue-300 ml-0.5"
                                >⊞</button>
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-vscode-text">{item.amount_ht.toFixed(2)} €</td>
                          <td className={`px-3 py-2 text-right font-mono ${item.direction === "collected" ? "text-blue-300" : "text-green-300"}`}>{Math.abs(item.vat).toFixed(2)} €</td>
                          <td className={`px-3 py-2 text-right font-mono ${item.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>{item.amount_ttc.toFixed(2)} €</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded px-2 py-0.5 text-[10px] ${item.direction === "collected" ? "bg-blue-900/40 text-blue-300" : "bg-green-900/40 text-green-300"}`}>
                              {item.direction === "collected" ? "TVA collectée" : "TVA déductible"}
                            </span>
                          </td>
                        </tr>
                      );

                      if (!isEditingSplit) return [mainRow];

                      const splitRow = (
                        <tr key={`${item.id}-split`} className="bg-vscode-panel/60">
                          <td colSpan={8} className="px-4 py-3">
                            <SplitEditor
                              amountTtc={item.amount_ttc}
                              initialSplits={item.vat_splits ?? []}
                              disabled={isSaving}
                              onSave={saveSplits}
                              onCancel={() => setSplitEditId(null)}
                            />
                          </td>
                        </tr>
                      );

                      return [mainRow, splitRow];
                    })}
                  {data.details.filter((item) => detailQuarter === "annual" || item.quarter === detailQuarter).length === 0 && (
                    <tr className="border-t border-vscode-border">
                      <td colSpan={8} className="px-3 py-6 text-center text-vscode-muted">
                        Aucune transaction avec TVA sur cette période.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
