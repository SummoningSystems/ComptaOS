import { useEffect, useMemo, useState } from "react";
import { fetchHrEmployees, saveHrEmployees } from "../../api/client";
import type { HrContractType, HrEmployee } from "../../types";

const CONTRACTS: Array<{ value: HrContractType; label: string }> = [
  { value: "cdi", label: "CDI" }, { value: "cdd", label: "CDD" },
  { value: "apprenticeship", label: "Contrat d’apprentissage" },
  { value: "professionalization", label: "Contrat de professionnalisation" },
  { value: "internship", label: "Stage" },
];
const contractLabel = (value: HrContractType) => CONTRACTS.find((item) => item.value === value)?.label ?? value;
const euros = (value: number) => value.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const emptyForm = (): Omit<HrEmployee, "id"> => ({ firstName: "", lastName: "", contractType: "cdi", jobTitle: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", grossMonthly: 0, netMonthly: 0, employerCostMonthly: 0, includeInForecast: true, active: true, notes: "" });

export function HrView() {
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { fetchHrEmployees().then(setEmployees).finally(() => setLoading(false)); }, []);
  const included = useMemo(() => employees.filter((employee) => employee.active && employee.includeInForecast), [employees]);
  const totals = useMemo(() => included.reduce((sum, employee) => ({ gross: sum.gross + employee.grossMonthly, net: sum.net + employee.netMonthly, cost: sum.cost + employee.employerCostMonthly }), { gross: 0, net: 0, cost: 0 }), [included]);

  async function persist(next: HrEmployee[], success: string) {
    setSaving(true); setMessage("");
    try { await saveHrEmployees(next); setEmployees(next); setMessage(success); }
    catch { setMessage("Enregistrement impossible."); }
    finally { setSaving(false); }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.startDate) { setMessage("Prénom, nom et date de début sont requis."); return; }
    const employee: HrEmployee = { ...form, id: editingId ?? crypto.randomUUID(), firstName: form.firstName.trim(), lastName: form.lastName.trim(), jobTitle: form.jobTitle?.trim() || undefined, endDate: form.endDate || undefined, notes: form.notes?.trim() || undefined };
    const next = editingId ? employees.map((item) => item.id === editingId ? employee : item) : [...employees, employee];
    await persist(next, editingId ? "Dossier mis à jour." : "Personne ajoutée à l’équipe.");
    setEditingId(undefined); setForm(emptyForm());
  }
  function edit(employee: HrEmployee) { setEditingId(employee.id); setForm({ ...employee, endDate: employee.endDate ?? "", jobTitle: employee.jobTitle ?? "", notes: employee.notes ?? "" }); }
  async function toggleForecast(employee: HrEmployee) { await persist(employees.map((item) => item.id === employee.id ? { ...item, includeInForecast: !item.includeInForecast } : item), "Prévision mise à jour."); }
  async function archive(employee: HrEmployee) { await persist(employees.map((item) => item.id === employee.id ? { ...item, active: false, includeInForecast: false } : item), "Dossier archivé."); }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-vscode-muted">Chargement des dossiers RH…</div>;
  return <div className="h-full overflow-y-auto p-4 text-vscode-text sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-lg font-semibold">RH & Paie</h1><p className="mt-1 text-xs text-vscode-muted">Pilotage des contrats et coûts mensuels. Les montants enregistrés alimentent la trésorerie, mais ne constituent pas un bulletin de paie.</p></div><a href="https://mon-entreprise.urssaf.fr/simulateurs/salari%C3%A9" target="_blank" rel="noreferrer" className="rounded bg-vscode-accent px-3 py-2 text-xs text-white">Ouvrir le simulateur officiel Urssaf ↗</a></div>

    <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Kpi label="Personnes actives" value={String(employees.filter((item) => item.active).length)} sub={`${included.length} intégrée(s) aux prévisions`} />
      <Kpi label="Brut mensuel" value={euros(totals.gross)} sub="montants renseignés" />
      <Kpi label="Net mensuel" value={euros(totals.net)} sub="estimation ou bulletin" />
      <Kpi label="Coût employeur" value={euros(totals.cost)} sub={`${euros(totals.cost * 12)} sur 12 mois`} accent />
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,.65fr)]">
      <section className="rounded-lg border border-vscode-border bg-vscode-sidebar p-4"><h2 className="text-sm font-semibold">Équipe</h2>
        <div className="mt-3 space-y-2">{employees.filter((item) => item.active).map((employee) => <article key={employee.id} className="rounded border border-vscode-border bg-vscode-panel p-3">
          <div className="flex flex-wrap items-start justify-between gap-2"><div><strong className="text-sm">{employee.firstName} {employee.lastName}</strong><p className="text-[10px] text-vscode-muted">{contractLabel(employee.contractType)}{employee.jobTitle ? ` · ${employee.jobTitle}` : ""} · depuis le {employee.startDate}{employee.endDate ? ` jusqu’au ${employee.endDate}` : ""}</p></div><span className={`rounded px-2 py-1 text-[10px] ${employee.includeInForecast ? "bg-green-900/30 text-green-300" : "bg-vscode-bg text-vscode-muted"}`}>{employee.includeInForecast ? "Dans la trésorerie" : "Hors prévision"}</span></div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><span className="block text-[10px] text-vscode-muted">Brut</span>{euros(employee.grossMonthly)}</div><div><span className="block text-[10px] text-vscode-muted">Net</span>{euros(employee.netMonthly)}</div><div><span className="block text-[10px] text-vscode-muted">Coût employeur</span><strong>{euros(employee.employerCostMonthly)}</strong></div></div>
          <div className="mt-3 flex gap-3 text-[10px]"><button onClick={() => edit(employee)} className="text-vscode-accent">Modifier</button><button disabled={saving} onClick={() => void toggleForecast(employee)} className="text-amber-300">{employee.includeInForecast ? "Retirer des prévisions" : "Ajouter aux prévisions"}</button><button disabled={saving} onClick={() => void archive(employee)} className="text-red-400">Archiver</button></div>
        </article>)}{employees.filter((item) => item.active).length === 0 && <p className="py-8 text-center text-xs text-vscode-muted">Aucun dossier RH. Ajoute une première personne avec le formulaire.</p>}</div>
      </section>

      <form onSubmit={(event) => void submit(event)} className="rounded-lg border border-vscode-border bg-vscode-sidebar p-4"><h2 className="text-sm font-semibold">{editingId ? "Modifier le dossier" : "Ajouter une personne"}</h2><p className="mt-1 text-[10px] text-vscode-muted">Reporte ici les résultats du simulateur Urssaf ou ceux transmis par ton gestionnaire de paie.</p>
        <div className="mt-3 grid grid-cols-2 gap-3"><Field label="Prénom"><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className={inputClass} /></Field><Field label="Nom"><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className={inputClass} /></Field></div>
        <Field label="Type de contrat"><select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value as HrContractType })} className={inputClass}>{CONTRACTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></Field>
        <Field label="Poste ou mission"><input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Début"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputClass} /></Field><Field label="Fin éventuelle"><input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputClass} /></Field></div>
        <div className="grid grid-cols-3 gap-2"><MoneyField label={form.contractType === "internship" ? "Gratification brute" : "Brut mensuel"} value={form.grossMonthly} onChange={(value) => setForm({ ...form, grossMonthly: value })} /><MoneyField label="Net mensuel" value={form.netMonthly} onChange={(value) => setForm({ ...form, netMonthly: value })} /><MoneyField label="Coût employeur" value={form.employerCostMonthly} onChange={(value) => setForm({ ...form, employerCostMonthly: value })} /></div>
        <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={form.includeInForecast} onChange={(e) => setForm({ ...form, includeInForecast: e.target.checked })} />Inclure le coût employeur dans la trésorerie</label>
        <Field label="Notes internes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={inputClass} /></Field>
        {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}<div className="mt-4 flex gap-2"><button disabled={saving} className="rounded bg-vscode-accent px-4 py-2 text-xs text-white disabled:opacity-50">{saving ? "Enregistrement…" : editingId ? "Enregistrer" : "Ajouter"}</button>{editingId && <button type="button" onClick={() => { setEditingId(undefined); setForm(emptyForm()); }} className="text-xs text-vscode-muted">Annuler</button>}</div>
      </form>
    </div>
    <section className="mt-5 rounded border border-amber-800/70 bg-amber-950/20 p-4 text-xs"><strong className="text-amber-200">Limite de cette première version</strong><p className="mt-1 text-vscode-muted">ComptaOS stocke les hypothèses et prépare le pilotage. Les bulletins officiels, cotisations, prélèvement à la source et DSN doivent encore être produits ou validés par un logiciel de paie ou un professionnel compétent.</p></section>
  </div>;
}

const inputClass = "mt-1 w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs text-vscode-text";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="mt-3 block text-[10px] text-vscode-muted">{label}{children}</label>; }
function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" min="0" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value) || 0)} className={inputClass} /></Field>; }
function Kpi({ label, value, sub, accent = false }: { label: string; value: string; sub: string; accent?: boolean }) { return <div className="rounded-lg border border-vscode-border bg-vscode-sidebar p-4"><span className="text-[10px] uppercase text-vscode-muted">{label}</span><strong className={`mt-1 block font-mono text-xl ${accent ? "text-amber-300" : "text-vscode-text"}`}>{value}</strong><span className="text-[10px] text-vscode-muted">{sub}</span></div>; }
