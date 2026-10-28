import { useEffect, useState } from "react";
import { apiUrl, fetchVatSummary, updateTransaction, type VatSummaryData, type VatTransactionDetail } from "../../api/client";
import type { Category } from "../../types";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";
import { LocalizedNumberInput } from "../Common/LocalizedNumberInput";

type VatSplit = { rate: number; amount_ttc: number };


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
  const { categories } = useCategoryCatalog();
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => { void onSave(e.target.value as Category); }}
      className="w-full bg-transparent border border-transparent rounded px-1 py-0.5 text-vscode-muted focus:bg-vscode-bg focus:border-vscode-accent focus:outline-none disabled:opacity-60"
      aria-label="Catégorie de transaction"
    >
      {categories.map((category) => (
        <option key={category.id} value={category.id}>{category.label}</option>
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
            <LocalizedNumberInput
              min={0}
              value={Math.abs(split.amount_ttc)}
              onValueChange={(amount) => updateAmount(i, amount)}
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

function Ca3Panel({ declaration, selection, regime }: { declaration: VatSummaryData["declaration"]; selection: VatSummaryData["selection"]; regime: VatSummaryData["regime"] }) {
  const isCa12 = regime === "simplified_ca12" && selection.kind === "fiscal_period";

  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function copyToClipboard() {
    const text = [
      `${isCa12 ? "PRÉPARATION CA12E" : "SYNTHÈSE TVA"} — ${selection.label}`,
      ``,
      ...declaration.taxableByRate.map((row) => `${row.rate === 20 ? "5A" : "TAUX"} — Base HT à ${fmt(row.rate)} % : ${fmt(row.base)} € ; taxe : ${fmt(row.tax)} €`),
      ...(declaration.reverseChargeBase > 0 ? [`AC — Achats de services UE : base ${fmt(declaration.reverseChargeBase)} € ; TVA autoliquidée ${fmt(declaration.reverseChargeVat)} €`] : []),
      `19 — TVA brute due :                         ${fmt(declaration.collected)} €`,
      `20 — TVA déductible sur autres biens/services : ${fmt(declaration.deductibleOther)} €`,
      `23 — TVA déductible sur immobilisations :      ${fmt(declaration.deductibleFixedAssets)} €`,
      `26 — Total TVA déductible :                    ${fmt(declaration.deductible)} €`,
      `28 — TVA nette avant acomptes :                  ${fmt(Math.max(0, declaration.netBeforeAdvances))} €`,
      `Acomptes versés :                                ${fmt(declaration.advances)} €`,
      `54 — TVA nette due après acomptes :                ${fmt(Math.max(0, declaration.netAfterAdvances))} €`,
      `56 — Total estimé à payer :                     ${fmt(Math.max(0, declaration.netAfterAdvances))} €`,
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
        <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide">{isCa12 ? "Préparation CA12E" : "Synthèse TVA"}</h3>
        <div className="flex items-center gap-2">
          <span className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs text-vscode-text">{selection.label}</span>
          <button
            onClick={copyToClipboard}
            className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1 flex items-center gap-1"
          >
            📋 Copier
          </button>
          <a
            href={apiUrl(`/reports/vat-pdf?${selection.periodId ? `periodId=${encodeURIComponent(selection.periodId)}` : `year=${selection.endDate.slice(0, 4)}`}&quarter=annual`)}
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
          OPÉRATIONS IMPOSABLES — {selection.label}
        </div>
        {declaration.taxableByRate.map((row) => (
          <div key={row.rate} className="grid grid-cols-[2rem_1fr_8rem_8rem] items-center gap-2 border-b border-vscode-border/40 px-4 py-2">
            <span className="font-mono text-[10px] text-vscode-muted">{row.rate === 20 ? "5A" : "—"}</span>
            <span className="text-xs text-vscode-muted">Opérations imposables à {fmt(row.rate)} %</span>
            <span className="text-right font-mono text-xs">Base {fmt(row.base)} €</span>
            <span className="text-right font-mono text-xs font-bold text-blue-300">Taxe {fmt(row.tax)} €</span>
          </div>
        ))}
        {declaration.reverseChargeBase > 0 && (
          <div className="grid grid-cols-[2rem_1fr_8rem_8rem] items-center gap-2 border-b border-vscode-border/40 bg-blue-950/10 px-4 py-2">
            <span className="font-mono text-[10px] text-vscode-muted">AC</span>
            <span className="text-xs text-vscode-muted">Achats de prestations de services UE — autoliquidation</span>
            <span className="text-right font-mono text-xs">Base {fmt(declaration.reverseChargeBase)} €</span>
            <span className="text-right font-mono text-xs font-bold text-blue-300">Taxe {fmt(declaration.reverseChargeVat)} €</span>
          </div>
        )}
        <Ca3Row code="19" label="TVA brute due" value={declaration.collected} color="text-blue-300" bold />

        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-green-400 uppercase tracking-widest border-t border-vscode-border">
          TVA DÉDUCTIBLE
        </div>
        <Ca3Row code="20" label="TVA déductible sur autres biens et services" value={declaration.deductibleOther} color="text-green-300" />
        <Ca3Row code="23" label="TVA déductible sur immobilisations" value={declaration.deductibleFixedAssets} color="text-green-300" />
        <Ca3Row code="26" label="Total TVA déductible" value={declaration.deductible} color="text-green-300" bold />

        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-orange-400 uppercase tracking-widest border-t border-vscode-border">
          RÉSULTAT
        </div>
        <Ca3Row code="28" label="TVA nette due avant acomptes" value={Math.max(0, declaration.netBeforeAdvances)} />
        <Ca3Row code="29" label="Crédit de TVA" value={Math.max(0, -declaration.netBeforeAdvances)} />
        <Ca3Row code="—" label="Acomptes de l'exercice déjà versés" value={declaration.advances} />

        <div className={`flex items-center gap-2 px-4 py-3 border-t-2 ${declaration.netAfterAdvances > 0 ? "border-orange-600 bg-orange-900/20" : "border-green-600 bg-green-900/20"}`}>
          <span className="font-mono text-[10px] text-vscode-muted w-6 shrink-0">56</span>
          <span className="flex-1 font-bold text-vscode-text text-xs">
            {declaration.netAfterAdvances > 0 ? "Total estimé à payer après acomptes" : "Crédit de TVA estimé"}
          </span>
          <span className={`font-mono tabular-nums font-bold text-base w-32 text-right ${declaration.netAfterAdvances > 0 ? "text-orange-300" : "text-green-300"}`}>
            {fmt(Math.abs(declaration.netAfterAdvances))} €
          </span>
        </div>
      </div>

      <p className="text-[10px] text-vscode-muted mt-2">
        ⚠ Document de travail à contrôler avant dépôt sur impots.gouv.fr.
      </p>
    </div>
  );
}

export function VatView() {
  const currentYear = new Date().getFullYear();
  const [selectionKey, setSelectionKey] = useState("");
  const [data, setData] = useState<VatSummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailQuarter, setDetailQuarter] = useState<string>("annual");
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [splitEditId, setSplitEditId] = useState<string | null>(null);

  async function load(selection = selectionKey) {
    setLoading(true);
    try {
      const summary = await fetchVatSummary(selection);
      setData(summary);
      setSelectionKey(summary.selection.key);
      setDetailQuarter("annual");
    } finally {
      setLoading(false);
    }
  }

  async function saveDetailPatch(id: string, patch: { label?: string; category?: Category; vat_rate?: number; vat_splits?: VatSplit[]; vatTreatment?: "standard" | "exempt" | "outside_scope" | "reverse_charge_purchase" }) {
    setSavingIds((current) => current.includes(id) ? current : [...current, id]);
    try {
      await updateTransaction(id, patch);
      await load(selectionKey);
    } finally {
      setSavingIds((current) => current.filter((item) => item !== id));
    }
  }

  useEffect(() => { void load(""); }, []);

  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <h2 className="text-vscode-text text-base font-semibold">Déclaration TVA</h2>
        <select
          value={selectionKey}
          onChange={(e) => { setSelectionKey(e.target.value); void load(e.target.value); }}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
        >
          {data?.availablePeriods.length ? <optgroup label="Exercices comptables">
            {data.availablePeriods.map((period) => <option key={period.id} value={`period:${period.id}`}>{period.label || "Exercice"} · {period.startDate} → {period.endDate}</option>)}
          </optgroup> : null}
          <optgroup label="Années civiles">
            {years.map((y) => <option key={y} value={`year:${y}`}>{y}</option>)}
          </optgroup>
        </select>
        <button
          onClick={() => void load(selectionKey)}
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

          <section className="max-w-3xl rounded-lg border border-blue-800 bg-blue-950/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-blue-200">Régime de TVA de la société</h3><p className="mt-1 text-xs text-vscode-text">{data.regime === "simplified_ca12" ? "Régime simplifié — CA12 annuelle et deux acomptes" : data.regime === "quarterly_ca3" ? "Régime réel normal — CA3 trimestrielle" : data.regime === "franchise" ? "Franchise en base de TVA" : "Régime réel normal — CA3 mensuelle"}</p></div>{data.nextDue && <div className="rounded border border-blue-800 px-3 py-2 text-right text-xs"><strong>{data.nextDue.label}</strong><br/><span className="text-vscode-muted">{data.nextDue.period} · estimation {data.nextDue.estimatedAmount.toFixed(2)} €</span></div>}</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4"><span>{data.selection.kind === "fiscal_period" ? "Solde CA12E estimé" : "Provision actuelle"}<br/><strong className="text-amber-300">{(data.reserve ?? Math.max(0, data.total.net)).toFixed(2)} €</strong></span><span>Acomptes imputables<br/><strong>{(data.payments ?? 0).toFixed(2)} €</strong></span>{data.regime === "simplified_ca12" && <><span>Référence {data.referenceYear ?? "N-1"}<br/><strong>{(data.referenceAmount ?? 0).toFixed(2)} €</strong></span><span>Acomptes théoriques<br/><strong>55 % / 40 %</strong></span></>}</div>
            <p className="mt-3 text-[10px] text-vscode-muted">Les échéances affichées sont prévisionnelles. Les montants et dates opposables restent ceux de l’espace professionnel impots.gouv.fr.</p>
          </section>

          {data.regime === "simplified_ca12" && data.selection.kind === "fiscal_period" && (
            <section className="max-w-3xl rounded-lg border border-amber-700/60 bg-amber-950/10 p-4">
              <h3 className="text-sm font-semibold text-amber-200">Calcul de la CA12E · {data.selection.startDate} → {data.selection.endDate}</h3>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-5">
                <span>TVA collectée<br/><strong>{data.declaration.collected.toFixed(2)} €</strong></span>
                <span>TVA déductible<br/><strong>{data.declaration.deductible.toFixed(2)} €</strong></span>
                <span>TVA avant acomptes<br/><strong>{data.declaration.netBeforeAdvances.toFixed(2)} €</strong></span>
                <span>Acomptes de l'exercice<br/><strong>{data.declaration.advances.toFixed(2)} €</strong></span>
                <span>Solde estimé<br/><strong className="text-amber-300">{data.declaration.netAfterAdvances.toFixed(2)} €</strong></span>
              </div>
              {data.declaration.balancePayments > 0 && <p className="mt-3 text-[10px] text-vscode-muted">{data.declaration.balancePayments.toFixed(2)} € de règlements de soldes d'exercices antérieurs sont volontairement exclus des acomptes de cette CA12E. Les pénalités fiscales sont également exclues.</p>}
            </section>
          )}

          {data.declaration.revenueToReview.count > 0 && (
            <section className="max-w-3xl rounded-lg border-2 border-red-700 bg-red-950/20 p-4">
              <h3 className="text-sm font-semibold text-red-300">Traitement TVA à confirmer avant la CA12E</h3>
              <p className="mt-2 text-xs text-vscode-text">{data.declaration.revenueToReview.count} encaissement(s), soit <strong>{data.declaration.revenueToReview.amount.toFixed(2)} €</strong>, sont classés en recettes avec 0 € de TVA sans motif fiscal explicite. Ils ne sont pas ajoutés automatiquement à la base à 20 %.</p>
              <div className="mt-3 space-y-1 text-[11px] text-vscode-muted">
                {data.details.filter((item) => data.declaration.revenueToReview.transactionIds.includes(item.id)).map((item) => <p key={item.id}>{item.date} · {item.label} · <strong>{item.amount_ttc.toFixed(2)} €</strong></p>)}
              </div>
              <p className="mt-3 text-[10px] text-red-200">Choisis plus bas le traitement exact : TVA française, exonérée ou hors champ. Tant que ce contrôle reste rouge, le solde n'est pas prêt à déclarer.</p>
            </section>
          )}

          {/* Résumé annuel */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl">
            <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA brute due</p>
              <p className="text-xl font-mono font-semibold text-blue-300">+{data.total.collected.toFixed(2)} €</p>
              <p className="text-[10px] text-vscode-muted mt-1">ventes et autoliquidations</p>
            </div>
            <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-4">
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA déductible</p>
              <p className="text-xl font-mono font-semibold text-green-300">−{data.total.deductible.toFixed(2)} €</p>
              <p className="text-[10px] text-vscode-muted mt-1">sur dépenses pro</p>
            </div>
            <div className={`bg-vscode-sidebar border rounded-lg p-4 ${data.total.net > 0 ? "border-orange-700" : "border-vscode-border"}`}>
              <p className="text-[11px] text-vscode-muted uppercase tracking-wide mb-1">TVA brute avant acomptes</p>
              <p className={`text-xl font-mono font-semibold ${data.total.net > 0 ? "text-orange-300" : "text-green-300"}`}>
                {data.declaration.netBeforeAdvances >= 0 ? "+" : ""}{data.declaration.netBeforeAdvances.toFixed(2)} €
              </p>
              <p className="text-[10px] text-vscode-muted mt-1">
                {data.declaration.netBeforeAdvances > 0 ? "Avant imputation des acomptes" : "Crédit de TVA avant acomptes"}
              </p>
            </div>
          </div>

          {/* Note d'avertissement */}
          <div className="bg-yellow-900/20 border border-yellow-700/50 rounded px-3 py-2 text-[11px] text-yellow-300/80 max-w-2xl">
            ⚠ Ces montants sont calculés à partir des taux TVA actuellement enregistrés sur chaque transaction. Après une modification de taux dans l'onglet Transactions, clique sur Recharger pour recalculer immédiatement ce tableau.
          </div>

          {/* Tableau par trimestre */}
          <div className="max-w-3xl">
            <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide mb-3">Détail par trimestre — {data.selection.label}</h3>            <table className="w-full text-xs border border-vscode-border rounded overflow-hidden">
              <thead className="bg-vscode-panel">
                <tr>
                  <th className="text-left px-4 py-2 text-vscode-muted">Trimestre</th>
                  <th className="text-right px-3 py-2 text-vscode-muted">Encaissements TTC</th>
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
                      <td className="px-4 py-2 font-semibold text-vscode-text">{q.quarter}</td>
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
                  <td className="px-4 py-2 font-bold text-vscode-text">TOTAL</td>
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
          <Ca3Panel declaration={data.declaration} selection={data.selection} regime={data.regime} />

          <div className="max-w-5xl">
            <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
              <h3 className="text-xs font-semibold text-vscode-muted uppercase tracking-wide">Transactions TVA et opérations à contrôler</h3>
              <div className="flex items-center gap-3">
                {savingIds.length > 0 && <span className="text-[11px] text-vscode-muted">Enregistrement…</span>}
                <select
                  value={detailQuarter}
                  onChange={(e) => setDetailQuarter(e.target.value)}
                  className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
                >
                  <option value="annual">{data.selection.label}</option>
                  {data.quarters.map((q) => <option key={q.quarter} value={q.quarter}>{q.quarter}</option>)}
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
                    <th className="text-left px-3 py-2 text-vscode-muted">Traitement fiscal</th>
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
                          <td className={`px-3 py-2 text-right font-mono ${item.direction === "collected" ? "text-blue-300" : "text-green-300"}`}>{Math.abs(item.reverseChargeVat ?? item.vat).toFixed(2)} €</td>
                          <td className={`px-3 py-2 text-right font-mono ${item.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>{item.amount_ttc.toFixed(2)} €</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex rounded px-2 py-0.5 text-[10px] ${item.direction === "collected" ? "bg-blue-900/40 text-blue-300" : "bg-green-900/40 text-green-300"}`}>
                              {item.vatTreatment === "reverse_charge_purchase" ? "Due + déductible" : item.direction === "collected" ? "TVA collectée" : "TVA déductible"}
                            </span>
                          </td>
                          <td className="px-3 py-2 min-w-[190px]">
                            <select
                              value={item.vatTreatment ?? "standard"}
                              disabled={isSaving}
                              onChange={(event) => {
                                const vatTreatment = event.target.value as "standard" | "exempt" | "outside_scope" | "reverse_charge_purchase";
                                void saveDetailPatch(item.id, vatTreatment === "reverse_charge_purchase" ? { vatTreatment, vat_rate: 20, vat_splits: [] } : { vatTreatment });
                              }}
                              className="w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-[10px] text-vscode-text"
                            >
                              <option value="standard">TVA française selon le taux</option>
                              <option value="exempt">Exonérée — justificatif requis</option>
                              <option value="outside_scope">Hors champ de TVA française</option>
                              {item.amount_ttc < 0 && <option value="reverse_charge_purchase">Achat de services UE — autoliquidation</option>}
                            </select>
                          </td>
                        </tr>
                      );

                      if (!isEditingSplit) return [mainRow];

                      const splitRow = (
                        <tr key={`${item.id}-split`} className="bg-vscode-panel/60">
                          <td colSpan={9} className="px-4 py-3">
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
                      <td colSpan={9} className="px-3 py-6 text-center text-vscode-muted">
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
