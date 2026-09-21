import { useState } from "react";
import { useWorkspaceStore as useAppStore } from "../../stores/WorkspaceStore";
import {PnlData} from '../../api/client';
import {useWorkspaceApi} from '../../api/WorkspaceApi';

type ReportType = "monthly" | "vat" | "activity" | "pnl";

interface Tab {
  id: ReportType;
  label: string;
  description: string;
  periodType: "month" | "quarter" | "year";
}

const TABS: Tab[] = [
  { id: "monthly", label: "Mensuel", description: "Revenus, dépenses et balance pour un mois donné.", periodType: "month" },
  { id: "vat", label: "TVA", description: "TVA collectée vs déductible — trimestre ou année complète.", periodType: "quarter" },
  { id: "activity", label: "Activité", description: "Récapitulatif annuel par catégorie.", periodType: "year" },
  { id: "pnl", label: "Compte de résultat", description: "Charges vs produits HT par compte PCG, résultat net estimé.", periodType: "year" },
];

function getCurrentMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function getCurrentQuarter(): string {
  const d = new Date();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `${d.getFullYear()}-Q${q}`;
}

function getCurrentYear(): string {
  return String(new Date().getFullYear());
}

function PeriodPicker({
  type,
  value,
  onChange,
}: {
  type: "month" | "quarter" | "year";
  value: string;
  onChange: (v: string) => void;
}) {
  if (type === "month") {
    return (
      <input
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded focus:outline-none focus:border-vscode-accent"
      />
    );
  }

  if (type === "quarter") {
    const [year, q] = value.split("-");
    const quarters = ["Q1", "Q2", "Q3", "Q4"];
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={year}
          onChange={(e) => onChange(`${e.target.value}-${q}`)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-20 focus:outline-none"
          min={2000}
          max={2099}
        />
        <select
          value={q}
          onChange={(e) => onChange(`${year}-${e.target.value}`)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded focus:outline-none"
        >
          {quarters.map((qv) => (
            <option key={qv} value={qv}>{qv}</option>
          ))}
        </select>
      </div>
    );
  }

  // year
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-24 focus:outline-none"
      min={2000}
      max={2099}
    />
  );
}

export function ReportsView() {
 const {api,fetchPnl}=useWorkspaceApi();

  const { openTab } = useAppStore();
  const [activeTab, setActiveTab] = useState<ReportType>("monthly");
  const [vatMode, setVatMode] = useState<"quarter" | "year">("quarter");
  const [periods, setPeriods] = useState<Record<ReportType, string>>({
    monthly: getCurrentMonth(),
    vat: getCurrentQuarter(),
    activity: getCurrentYear(),
    pnl: getCurrentYear(),
  });
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ content: string; filePath: string } | null>(null);
  const [pnlData, setPnlData] = useState<PnlData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tab = TABS.find((t) => t.id === activeTab)!;

  async function handleGenerate() {
    setGenerating(true);
    setResult(null);
    setPnlData(null);
    setError(null);
    try {
      if (activeTab === "pnl") {
        const data = await fetchPnl(periods.pnl);
        setPnlData(data);
      } else {
        const { data } = await api.post("/reports/generate", {
          type: activeTab,
          period: periods[activeTab],
        });
        setResult(data);
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } }; message?: string })
        ?.response?.data?.error ?? (e as { message?: string })?.message ?? "Erreur inconnue";
      setError(msg);
    } finally {
      setGenerating(false);
    }
  }

  function handleOpenInEditor() {
    if (!result) return;
    openTab({
      id: `file:${result.filePath}`,
      title: result.filePath.split("/").pop() ?? result.filePath,
      type: "editor",
      path: result.filePath,
    });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-0 px-4 py-2 bg-vscode-panel border-b border-vscode-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActiveTab(t.id); setResult(null); setPnlData(null); setError(null); }}
            className={`px-4 py-1.5 text-xs transition-colors border-b-2 ${
              activeTab === t.id
                ? "text-vscode-text border-vscode-accent"
                : "text-vscode-muted border-transparent hover:text-vscode-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-vscode-border shrink-0 bg-vscode-bg">
        <p className="text-vscode-muted text-xs flex-1">{tab.description}</p>

        {activeTab === "vat" && (
          <div className="flex items-center border border-vscode-border rounded overflow-hidden text-[10px]">
            <button
              onClick={() => { setVatMode("quarter"); setPeriods((p) => ({ ...p, vat: getCurrentQuarter() })); }}
              className={`px-2 py-1 ${vatMode === "quarter" ? "bg-vscode-accent text-white" : "text-vscode-muted hover:text-vscode-text"}`}
            >
              Trimestre
            </button>
            <button
              onClick={() => { setVatMode("year"); setPeriods((p) => ({ ...p, vat: getCurrentYear() })); }}
              className={`px-2 py-1 ${vatMode === "year" ? "bg-vscode-accent text-white" : "text-vscode-muted hover:text-vscode-text"}`}
            >
              Année
            </button>
          </div>
        )}

        <PeriodPicker
          type={activeTab === "vat" ? vatMode : tab.periodType}
          value={periods[activeTab]}
          onChange={(v) => setPeriods((p) => ({ ...p, [activeTab]: v }))}
        />

        <button
          onClick={handleGenerate}
          disabled={generating}
          className="flex items-center gap-1.5 bg-vscode-accent hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded disabled:opacity-50"
        >
          {generating ? (
            <span className="animate-pulse">Génération…</span>
          ) : (
            "⚡ Générer"
          )}
        </button>

        {result && (
          <button
            onClick={handleOpenInEditor}
            className="text-xs text-vscode-accent hover:underline"
          >
            Ouvrir dans l'éditeur →
          </button>
        )}

        {(result || pnlData) && (
          <button
            onClick={() => window.print()}
            className="flex items-center gap-1 text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-2 py-1"
            title="Imprimer / Exporter en PDF"
          >
            🖨 PDF
          </button>
        )}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="bg-red-900/30 border border-red-700 text-red-300 text-xs px-4 py-3 rounded">
            {error}
          </div>
        )}

        {!result && !pnlData && !error && (
          <div className="flex flex-col items-center justify-center h-full text-vscode-muted">
            <span className="text-4xl mb-3">📊</span>
            <p className="text-sm">Sélectionnez une période et cliquez sur « Générer ».</p>
          </div>
        )}

        {result && (
          <div className="prose prose-invert prose-sm max-w-none">
            <MarkdownPreview content={result.content} />
          </div>
        )}

        {pnlData && <PnlView data={pnlData} />}
      </div>
    </div>
  );
}

// ── Compte de résultat (P&L) ──────────────────────────────────────────────────
function PnlView({ data }: { data: PnlData }) {
  const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isProfit = data.resultat_brut >= 0;

  function handlePrint() {
    window.print();
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-base font-semibold text-vscode-text">Compte de résultat</h2>
          <p className="text-xs text-vscode-muted">Exercice {data.year} — montants HT</p>
        </div>
        <button
          onClick={handlePrint}
          className="text-xs text-vscode-muted hover:text-vscode-text border border-vscode-border rounded px-3 py-1 flex items-center gap-1"
        >
          🖨 Imprimer
        </button>
      </div>

      {/* Table */}
      <div className="border border-vscode-border rounded overflow-hidden text-xs">
        {/* Section PRODUITS */}
        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-green-400 uppercase tracking-widest">
          PRODUITS D'EXPLOITATION
        </div>
        {data.produits.map((p) => (
          <div key={p.account} className="flex items-center px-4 py-2.5 border-t border-vscode-border/50 hover:bg-vscode-panel/50">
            <span className="text-vscode-muted font-mono w-20">{p.account}</span>
            <span className="flex-1 text-vscode-text">{p.label}</span>
            <span className="text-[10px] text-vscode-muted mr-4">{p.count} opér.</span>
            <span className="font-mono tabular-nums text-green-300 w-28 text-right">+{fmt(p.amount)} €</span>
          </div>
        ))}
        <div className="flex items-center px-4 py-2.5 border-t border-green-700/40 bg-green-900/10">
          <span className="flex-1 font-semibold text-green-300">Total produits</span>
          <span className="font-mono font-bold tabular-nums text-green-300 w-28 text-right">+{fmt(data.total_produits)} €</span>
        </div>

        {/* Section CHARGES */}
        <div className="bg-vscode-panel px-4 py-2 text-[10px] font-semibold text-red-400 uppercase tracking-widest mt-1">
          CHARGES D'EXPLOITATION
        </div>
        {data.charges.length === 0 && (
          <div className="px-4 py-3 text-vscode-muted italic">Aucune charge enregistrée</div>
        )}
        {data.charges.map((c) => (
          <div key={c.account} className="flex items-center px-4 py-2.5 border-t border-vscode-border/50 hover:bg-vscode-panel/50">
            <span className="text-vscode-muted font-mono w-20">{c.account}</span>
            <span className="flex-1 text-vscode-text">{c.label}</span>
            <span className="text-[10px] text-vscode-muted mr-4">{c.count} opér.</span>
            <span className="font-mono tabular-nums text-red-300 w-28 text-right">−{fmt(c.amount)} €</span>
          </div>
        ))}
        <div className="flex items-center px-4 py-2.5 border-t border-red-700/40 bg-red-900/10">
          <span className="flex-1 font-semibold text-red-300">Total charges</span>
          <span className="font-mono font-bold tabular-nums text-red-300 w-28 text-right">−{fmt(data.total_charges)} €</span>
        </div>

        {/* Résultat */}
        <div className={`flex items-center px-4 py-3 border-t-2 ${isProfit ? "border-green-600 bg-green-900/20" : "border-red-600 bg-red-900/20"}`}>
          <span className="flex-1 font-bold text-vscode-text">RÉSULTAT D'EXPLOITATION</span>
          <span className={`font-mono font-bold tabular-nums text-lg w-28 text-right ${isProfit ? "text-green-300" : "text-red-300"}`}>
            {isProfit ? "+" : ""}{fmt(data.resultat_brut)} €
          </span>
        </div>

        {/* IS */}
        {data.is_estimate > 0 && (
          <div className="flex items-center px-4 py-2.5 border-t border-vscode-border/50 bg-vscode-panel/30">
            <span className="text-vscode-muted font-mono w-20">695000</span>
            <span className="flex-1 text-vscode-muted">Impôt sur les sociétés estimé (25%)</span>
            <span className="font-mono tabular-nums text-orange-300 w-28 text-right">−{fmt(data.is_estimate)} €</span>
          </div>
        )}

        {/* Résultat net */}
        <div className={`flex items-center px-4 py-3 border-t-2 ${data.resultat_net >= 0 ? "border-green-500 bg-green-900/30" : "border-red-500 bg-red-900/30"}`}>
          <span className="flex-1 font-bold text-white tracking-wide uppercase text-[11px]">RÉSULTAT NET</span>
          <span className={`font-mono font-bold tabular-nums text-xl w-28 text-right ${data.resultat_net >= 0 ? "text-green-300" : "text-red-300"}`}>
            {data.resultat_net >= 0 ? "+" : ""}{fmt(data.resultat_net)} €
          </span>
        </div>
      </div>

      {data.is_estimate > 0 && (
        <p className="text-[10px] text-vscode-muted mt-3 text-right">
          * IS estimé à 25% sur le résultat positif — à vérifier avec votre expert-comptable.
        </p>
      )}
    </div>
  );
}

// ── Simple Markdown renderer ──────────────────────────────────────────────────
function MarkdownPreview({ content }: { content: string }) {
  // Rendu minimaliste ligne par ligne
  const lines = content.split("\n");

  return (
    <div className="font-mono text-xs text-vscode-text leading-relaxed space-y-0.5">
      {lines.map((line, i) => {
        if (line.startsWith("# "))
          return <h1 key={i} className="text-lg font-bold text-white mt-4 mb-2">{line.slice(2)}</h1>;
        if (line.startsWith("## "))
          return <h2 key={i} className="text-base font-semibold text-vscode-text mt-3 mb-1">{line.slice(3)}</h2>;
        if (line.startsWith("### "))
          return <h3 key={i} className="text-sm font-semibold text-vscode-muted mt-2">{line.slice(4)}</h3>;
        if (line.startsWith("> "))
          return <blockquote key={i} className="border-l-2 border-vscode-muted pl-3 text-vscode-muted italic">{line.slice(2)}</blockquote>;
        if (line.startsWith("- "))
          return <li key={i} className="ml-4 list-disc text-vscode-text">{line.slice(2)}</li>;
        if (line.startsWith("|")) {
          const cells = line.split("|").filter((_, ci) => ci > 0 && ci < line.split("|").length - 1);
          const isSep = cells.every((c) => /^[-: ]+$/.test(c));
          if (isSep) return null;
          return (
            <div key={i} className="flex gap-0 border-b border-vscode-border/40">
              {cells.map((cell, ci) => (
                <span
                  key={ci}
                  className="px-3 py-1 text-vscode-text min-w-[140px]"
                  dangerouslySetInnerHTML={{ __html: cell.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>") }}
                />
              ))}
            </div>
          );
        }
        if (line === "") return <div key={i} className="h-1" />;
        return <p key={i} className="text-vscode-text">{line}</p>;
      })}
    </div>
  );
}
