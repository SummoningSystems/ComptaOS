import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
import type { TabType } from "../../types";

interface ClosingData { month: string; transactionCount: number; completed: number; total: number; ready: boolean; steps: Array<{ id: string; label: string; status: "done" | "warning" | "blocked"; detail: string; count?: number; action?: TabType }> }
const TITLES: Partial<Record<TabType, string>> = { banking: "Connexion bancaire", transactions: "Transactions", vat: "TVA", reconcile: "Rapprochement", export: "Export" };

export function ClosingView() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<ClosingData | null>(null);
  const [loading, setLoading] = useState(true);
  const openTab = useAppStore((state) => state.openTab);
  useEffect(() => { setLoading(true); api.get<ClosingData>("/closing", { params: { month } }).then(({ data }) => setData(data)).finally(() => setLoading(false)); }, [month]);
  return <div className="h-full overflow-auto p-5"><div className="mx-auto max-w-4xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-lg font-semibold">Clôture mensuelle guidée</h1><p className="mt-1 text-xs text-vscode-muted">Termine chaque contrôle avant de transmettre le mois à ton expert-comptable.</p></div><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded border border-vscode-border bg-vscode-panel px-3 py-1.5 text-sm" /></div>
    {loading || !data ? <p className="py-16 text-center text-sm text-vscode-muted">Calcul des contrôles…</p> : <>
      <section className={`rounded-lg border p-4 ${data.ready ? "border-green-700 bg-green-950/20" : "border-vscode-border bg-vscode-panel"}`}><div className="flex items-center justify-between"><div><p className="text-sm font-semibold">{data.ready ? "✓ Mois prêt à exporter" : `${data.completed}/${data.total} contrôles terminés`}</p><p className="mt-1 text-xs text-vscode-muted">{data.transactionCount} opération(s) pour {data.month}</p></div><span className="text-2xl">{data.ready ? "✅" : "🧭"}</span></div><div className="mt-3 h-2 overflow-hidden rounded bg-vscode-bg"><div className={`h-full ${data.ready ? "bg-green-500" : "bg-vscode-accent"}`} style={{ width: `${Math.round(data.completed / data.total * 100)}%` }} /></div></section>
      <div className="space-y-2">{data.steps.map((step) => <article key={step.id} className={`flex items-center gap-3 rounded-lg border p-3 ${step.status === "done" ? "border-green-800 bg-green-950/15" : step.status === "warning" ? "border-yellow-800 bg-yellow-950/15" : "border-red-800 bg-red-950/15"}`}><span className="text-lg">{step.status === "done" ? "✅" : step.status === "warning" ? "⚠️" : "⛔"}</span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{step.label}</p><p className="mt-0.5 text-xs text-vscode-muted">{step.detail}</p></div>{step.action && step.status !== "done" && <button onClick={() => openTab({ id: step.action!, type: step.action!, title: TITLES[step.action!] ?? step.label })} className="rounded bg-vscode-accent px-3 py-1.5 text-xs text-white">Corriger →</button>}{step.action === "export" && step.status === "done" && <button onClick={() => openTab({ id: "export", type: "export", title: "Export" })} className="rounded bg-green-700 px-3 py-1.5 text-xs text-white">Générer le dossier →</button>}</article>)}</div>
    </>}
  </div></div>;
}
