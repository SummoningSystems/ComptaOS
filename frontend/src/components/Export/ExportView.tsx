import { useEffect, useState } from "react";
import { api } from "../../api/client";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 7 }, (_, i) => String(CURRENT_YEAR - i));
const CATEGORIES = ["hosting", "software", "salary", "subcontracting", "professional_fees", "external_services", "travel", "restaurant", "food", "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc"] as const;
const LABELS: Record<string, string> = { hosting: "Hébergement", software: "Logiciels", salary: "Salaires", subcontracting: "Sous-traitance", professional_fees: "Conseil et honoraires", external_services: "Autres prestations", travel: "Déplacements", restaurant: "Restaurant", food: "Alimentation", taxes: "Impôts et taxes", equipment: "Équipement", subscription: "Abonnements", rent: "Loyer", legal: "Frais juridiques", insurance: "Assurance", misc: "Divers" };
interface Account { number: string; label: string }
interface Config { bank: Account; revenue: Account; vatDeductible: Account; vatCollected: Account; categories: Record<string, Account> }
interface Anomaly { severity: "blocking" | "warning"; code: string; message: string; transactionId?: string }
interface Balance { accountNumber: string; accountLabel: string; debit: number; credit: number; balance: number }
interface Preview { eligibleCount: number; excludedCount: number; balances: Balance[]; anomalies: Anomaly[]; totalDebit: number; totalCredit: number; balanced: boolean }

function triggerDownload(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type })); const link = document.createElement("a");
  link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export function ExportView() {
  const [year, setYear] = useState(String(CURRENT_YEAR));
  const [config, setConfig] = useState<Config | null>(null); const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [saved, setSaved] = useState(false);

  async function refresh() {
    setError(null);
    try { const [configResponse, previewResponse] = await Promise.all([api.get<Config>("/accounting/config"), api.get<Preview>("/accounting/preview", { params: { year } })]); setConfig(configResponse.data); setPreview(previewResponse.data); }
    catch { setError("Impossible de charger le contrôle comptable."); }
  }
  useEffect(() => { void refresh(); }, [year]);

  async function saveConfig() {
    if (!config) return; setLoading("save"); setSaved(false); setError(null);
    try { await api.put("/accounting/config", config); setSaved(true); await refresh(); } catch { setError("La configuration PCG n'a pas pu être enregistrée."); } finally { setLoading(null); }
  }
  async function downloadExpert(kind: "fec" | "package") {
    setLoading(kind); setError(null);
    try { const response = await api.get(`/accounting/${kind}`, { params: { year }, responseType: "blob" }); triggerDownload(response.data, kind === "fec" ? `FEC-${year}.txt` : `dossier-expert-comptable-${year}.zip`, kind === "fec" ? "text/plain;charset=utf-8" : "application/zip"); }
    catch (caught) { const response = (caught as { response?: { data?: Blob } }).response; if (response?.data instanceof Blob) { try { const body = JSON.parse(await response.data.text()) as { error?: string }; setError(body.error ?? "Export bloqué."); } catch { setError("Export bloqué par une anomalie comptable."); } } else setError("Export bloqué par une anomalie comptable."); }
    finally { setLoading(null); }
  }
  async function downloadLegacy(format: "xlsx" | "csv") {
    setLoading(format); setError(null);
    try { const response = await api.get(`/export/${format}`, { params: { year }, responseType: "blob" }); triggerDownload(response.data, `compta-${year}.${format}`, format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8"); }
    catch { setError("Erreur lors de la génération de l'export."); } finally { setLoading(null); }
  }
  function updateAccount(key: "bank" | "revenue" | "vatDeductible" | "vatCollected", field: keyof Account, value: string) { if (config) setConfig({ ...config, [key]: { ...config[key], [field]: value } }); }
  function updateCategory(category: string, field: keyof Account, value: string) { if (config) setConfig({ ...config, categories: { ...config.categories, [category]: { ...config.categories[category], [field]: value } } }); }
  const blockers = preview?.anomalies.filter((item) => item.severity === "blocking") ?? [];

  return <div className="p-6 max-w-5xl mx-auto flex flex-col gap-6">
    <div><h1 className="text-lg font-semibold text-vscode-text mb-1">Dossier expert-comptable</h1><p className="text-xs text-vscode-muted">Journal en partie double, balance générale, FEC contrôlé et justificatifs réunis dans une archive.</p></div>
    <div className="flex items-end gap-3"><label className="flex flex-col gap-1 text-xs text-vscode-muted">Exercice<select value={year} onChange={(event) => setYear(event.target.value)} className="bg-vscode-panel border border-vscode-border text-vscode-text text-sm rounded px-2 py-1.5">{YEARS.map((item) => <option key={item}>{item}</option>)}</select></label><button onClick={() => void refresh()} className="px-3 py-1.5 border border-vscode-border rounded text-xs text-vscode-text">Actualiser les contrôles</button></div>

    <section className="bg-vscode-panel border border-vscode-border rounded-lg p-5 flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-vscode-text">État de préparation</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs"><div><span className="text-vscode-muted">Exportées</span><p className="text-lg text-vscode-text">{preview?.eligibleCount ?? "—"}</p></div><div><span className="text-vscode-muted">Exclues</span><p className="text-lg text-vscode-text">{preview?.excludedCount ?? "—"}</p></div><div><span className="text-vscode-muted">Total débit</span><p className="text-lg text-vscode-text">{preview?.totalDebit.toFixed(2) ?? "—"} €</p></div><div><span className="text-vscode-muted">Total crédit</span><p className="text-lg text-vscode-text">{preview?.totalCredit.toFixed(2) ?? "—"} €</p></div></div>
      <p className={`text-sm ${preview?.balanced && blockers.length === 0 ? "text-green-400" : "text-red-400"}`}>{preview?.balanced && blockers.length === 0 ? "✓ Journal équilibré et exportable" : `⚠ ${blockers.length} anomalie(s) bloquante(s)`}</p>
      {preview?.anomalies.length ? <ul className="text-xs space-y-1">{preview.anomalies.map((item, index) => <li key={`${item.code}-${item.transactionId ?? index}`} className={item.severity === "blocking" ? "text-red-400" : "text-amber-400"}>{item.severity === "blocking" ? "Bloquant" : "Information"} — {item.message}{item.transactionId ? ` (${item.transactionId})` : ""}</li>)}</ul> : null}
      <div className="flex flex-wrap gap-3"><button disabled={loading !== null || blockers.length > 0} onClick={() => void downloadExpert("package")} className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm rounded">{loading === "package" ? "Création…" : "Télécharger le dossier complet (.zip)"}</button><button disabled={loading !== null || blockers.length > 0} onClick={() => void downloadExpert("fec")} className="px-4 py-2 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white text-sm rounded">{loading === "fec" ? "Validation…" : "Télécharger le FEC validé"}</button></div>
    </section>

    <section className="bg-vscode-panel border border-vscode-border rounded-lg p-5 flex flex-col gap-4">
      <div><h2 className="text-sm font-semibold text-vscode-text">Plan comptable configurable</h2><p className="text-xs text-vscode-muted mt-1">À faire vérifier par votre expert-comptable selon l'activité et le plan de comptes de l'entreprise.</p></div>
      {config && <><div className="grid md:grid-cols-2 gap-3">{([['bank','Banque / TTC'],['revenue','Produits / HT'],['vatDeductible','TVA déductible'],['vatCollected','TVA collectée']] as const).map(([key, title]) => <div key={key} className="grid grid-cols-[8rem_1fr] gap-2"><input aria-label={`${title} numéro`} value={config[key].number} onChange={(event) => updateAccount(key, "number", event.target.value)} className="bg-vscode-bg border border-vscode-border rounded px-2 py-1 text-xs text-vscode-text"/><input aria-label={`${title} libellé`} value={config[key].label} onChange={(event) => updateAccount(key, "label", event.target.value)} className="bg-vscode-bg border border-vscode-border rounded px-2 py-1 text-xs text-vscode-text"/></div>)}</div><div className="border-t border-vscode-border pt-3 grid md:grid-cols-2 gap-2">{CATEGORIES.map((category) => <label key={category} className="grid grid-cols-[7rem_7rem_1fr] items-center gap-2 text-xs text-vscode-muted"><span>{LABELS[category]}</span><input value={config.categories[category].number} onChange={(event) => updateCategory(category, "number", event.target.value)} className="bg-vscode-bg border border-vscode-border rounded px-2 py-1 text-vscode-text"/><input value={config.categories[category].label} onChange={(event) => updateCategory(category, "label", event.target.value)} className="bg-vscode-bg border border-vscode-border rounded px-2 py-1 text-vscode-text"/></label>)}</div><div><button disabled={loading !== null} onClick={() => void saveConfig()} className="px-4 py-2 bg-vscode-accent text-white rounded text-sm">{loading === "save" ? "Enregistrement…" : "Enregistrer le plan comptable"}</button>{saved && <span className="ml-3 text-xs text-green-400">Configuration enregistrée.</span>}</div></>}
    </section>

    {preview?.balances.length ? <section className="bg-vscode-panel border border-vscode-border rounded-lg p-5 overflow-auto"><h2 className="text-sm font-semibold text-vscode-text mb-3">Balance générale</h2><table className="w-full text-xs"><thead className="text-vscode-muted"><tr><th className="text-left">Compte</th><th className="text-left">Libellé</th><th className="text-right">Débit</th><th className="text-right">Crédit</th><th className="text-right">Solde</th></tr></thead><tbody>{preview.balances.map((item) => <tr key={item.accountNumber} className="border-t border-vscode-border"><td className="py-1 text-vscode-text">{item.accountNumber}</td><td>{item.accountLabel}</td><td className="text-right">{item.debit.toFixed(2)}</td><td className="text-right">{item.credit.toFixed(2)}</td><td className="text-right">{item.balance.toFixed(2)}</td></tr>)}</tbody></table></section> : null}

    <details className="text-xs text-vscode-muted"><summary className="cursor-pointer">Exports tableur historiques</summary><div className="flex gap-2 mt-3"><button onClick={() => void downloadLegacy("xlsx")} className="px-3 py-2 border border-vscode-border rounded">Excel</button><button onClick={() => void downloadLegacy("csv")} className="px-3 py-2 border border-vscode-border rounded">CSV</button></div></details>
    {error && <p className="text-sm text-red-400">{error}</p>}
  </div>;
}
