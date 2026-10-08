import { useEffect, useMemo, useState } from "react";
import { ensureAccountingDossier, fetchActiveCompany, fetchPersonalFinance, savePersonalCategory, savePersonalFinanceBudgets, setActiveCompanyApi } from "../../api/client";
import { useAppStore } from "../../stores/appStore";
import type { PersonalBudget, PersonalCategory, PersonalFinanceSnapshot, TabType } from "../../types";
import { LocalizedNumberInput } from "../Common/LocalizedNumberInput";

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const currentMonth = () => new Date().toISOString().slice(0, 7);

export function PersonalFinanceView({ personId }: { personId: string }) {
  const openTab = useAppStore((store) => store.openTab);
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<PersonalFinanceSnapshot | null>(null);
  const [budgets, setBudgets] = useState<PersonalBudget[]>([]);
  const [section, setSection] = useState<"overview" | "transactions" | "budgets">("overview");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true); setError("");
    fetchPersonalFinance(personId, month).then((snapshot) => { setData(snapshot); setBudgets(snapshot.budgets); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Chargement impossible.")).finally(() => setLoading(false));
  }, [personId, month]);

  const spending = useMemo(() => {
    const result: Record<string, number> = {};
    for (const transaction of data?.transactions ?? []) if (!transaction.internalTransfer && transaction.amount_ttc < 0) result[transaction.personalCategory] = (result[transaction.personalCategory] ?? 0) + Math.abs(transaction.amount_ttc);
    return result;
  }, [data]);

  async function changeCategory(key: string, category: PersonalCategory) {
    if (!data) return;
    const previous = data;
    setData({ ...data, transactions: data.transactions.map((transaction) => transaction.key === key ? { ...transaction, personalCategory: category } : transaction) });
    try { await savePersonalCategory(personId, key, category); setNotice("Catégorie personnelle enregistrée."); }
    catch (reason) { setData(previous); setError(reason instanceof Error ? reason.message : "Enregistrement impossible."); }
  }

  function setBudget(category: PersonalCategory, monthlyLimit: number) {
    setBudgets((current) => current.some((budget) => budget.category === category)
      ? current.map((budget) => budget.category === category ? { ...budget, monthlyLimit } : budget)
      : [...current, { category, monthlyLimit }]);
  }

  async function saveBudgets() {
    setSaving(true); setError("");
    try { const saved = await savePersonalFinanceBudgets(personId, budgets.filter((budget) => budget.monthlyLimit > 0)); setBudgets(saved); setNotice("Budgets personnels enregistrés."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  async function openDossierModule(type: TabType, title: string) {
    setError("");
    try {
      const dossier = await ensureAccountingDossier(personId);
      if (!dossier.workspaceId) throw new Error("Espace de données indisponible.");
      const businessWorkspace = await fetchActiveCompany();
      if (businessWorkspace) sessionStorage.setItem("comptaos:last-business-workspace", businessWorkspace.id);
      await setActiveCompanyApi(dossier.workspaceId);
      openTab({ id: `dossier:personal:${personId}:${type}`, title, type, path: `workspace=${encodeURIComponent(dossier.workspaceId)}&mode=personal&dossier=${encodeURIComponent(data?.person.name ?? "Comptabilité personnelle")}` });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ouverture du dossier impossible.");
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-vscode-muted">Chargement de l’espace personnel…</div>;
  if (!data) return <div className="m-6 rounded border border-red-700 bg-red-950/30 p-4 text-sm text-red-300">{error || "Espace personnel introuvable."}</div>;

  const expenseCategories = data.categories.filter((category) => category.kind !== "income");
  const totalBudget = budgets.reduce((sum, budget) => sum + budget.monthlyLimit, 0);
  const totalSpent = Object.values(spending).reduce((sum, amount) => sum + amount, 0);

  return <div className="h-full overflow-auto bg-vscode-bg">
    <header className="border-b border-vscode-border px-7 py-5">
      <div className="text-[10px] uppercase tracking-[0.2em] text-vscode-muted">Comptabilité personnelle</div>
      <div className="mt-2 flex flex-wrap items-end gap-4"><div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-semibold">{data.person.name}</h1><p className="mt-1 max-w-3xl text-xs text-vscode-muted">Un véritable espace de gestion personnelle : comptes, revenus, dépenses, catégories, budgets et charges fixes. Il reste volontairement sans facturation, TVA, RH ni écritures fiscales d’entreprise.</p></div><div className="flex flex-wrap items-center gap-2"><button onClick={() => void openDossierModule("banking", "Banque personnelle")} className="rounded border border-blue-700 px-3 py-2 text-xs text-blue-300 hover:bg-blue-950/30">Connecter une banque</button><button onClick={() => setSection("transactions")} className="rounded border border-vscode-border px-3 py-2 text-xs hover:border-blue-600">Voir les mouvements</button><button onClick={() => setSection("budgets")} className="rounded border border-vscode-border px-3 py-2 text-xs hover:border-blue-600">Gérer les budgets</button><button onClick={() => void openDossierModule("recurring", "Charges fixes personnelles")} className="rounded border border-vscode-border px-3 py-2 text-xs hover:border-blue-600">Charges fixes</button><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="rounded border border-vscode-border bg-vscode-panel px-3 py-2 text-xs" /></div></div>
    </header>
    <nav className="flex gap-1 border-b border-vscode-border px-7 py-2">
      {([['overview', 'Vue d’ensemble'], ['transactions', `Mouvements (${data.transactions.length})`], ['budgets', 'Budgets']] as const).map(([id, label]) => <button key={id} onClick={() => setSection(id)} className={`rounded px-3 py-1.5 text-xs ${section === id ? "bg-vscode-accent text-white" : "text-vscode-muted hover:bg-vscode-panel hover:text-vscode-text"}`}>{label}</button>)}
    </nav>
    {(error || notice) && <div aria-live="polite" className={`mx-7 mt-4 rounded border px-4 py-2 text-xs ${error ? "border-red-700 bg-red-950/30 text-red-300" : "border-green-700 bg-green-950/30 text-green-300"}`}>{error || notice}</div>}
    {data.accounts.length === 0 && <div className="mx-7 mt-5 rounded border border-amber-700 bg-amber-950/25 p-4 text-xs text-amber-200"><strong>Aucun compte personnel relié.</strong><p className="mt-1 text-amber-100/70">Utilise « Connecter une banque » pour ajouter le véritable compte de cette personne. Si un compte existant est réellement partagé, tu peux aussi le relier depuis Structure financière. Les transactions restent dans leur dossier source et ne sont jamais copiées.</p></div>}

    {section === "overview" && <main className="space-y-6 p-7">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {[{ title: "Comptes personnels", text: "Connexion PSD2 et soldes réellement rattachés à cette personne.", action: () => void openDossierModule("banking", "Banque personnelle") }, { title: "Dépenses et revenus", text: "Lecture mensuelle et classement avec des catégories personnelles.", action: () => setSection("transactions") }, { title: "Budgets", text: "Plafonds mensuels par poste et disponible restant.", action: () => setSection("budgets") }, { title: "Charges fixes", text: "Abonnements, logement et échéances récurrentes dans le dossier personnel.", action: () => void openDossierModule("recurring", "Charges fixes personnelles") }].map((item) => <button key={item.title} onClick={item.action} className="rounded border border-vscode-border bg-vscode-panel p-4 text-left hover:border-blue-600"><strong className="text-xs text-vscode-text">{item.title}</strong><p className="mt-1 text-[10px] leading-relaxed text-vscode-muted">{item.text}</p></button>)}
      </section>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "Solde des comptes", value: data.summary.balance, color: "text-blue-300" }, { label: "Revenus du mois", value: data.summary.income, color: "text-green-300" }, { label: "Dépenses du mois", value: -data.summary.expenses, color: "text-red-300" }, { label: "Reste du mois", value: data.summary.net, color: data.summary.net >= 0 ? "text-green-300" : "text-red-300" }].map((item) => <div key={item.label} className="rounded border border-vscode-border bg-vscode-panel p-4"><div className="text-[10px] uppercase tracking-wide text-vscode-muted">{item.label}</div><div className={`mt-2 font-mono text-xl font-semibold ${item.color}`}>{money.format(item.value)}</div></div>)}
      </div>
      <section><h2 className="mb-3 text-sm font-semibold">Comptes rattachés</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{data.accounts.map((account) => <div key={account.id} className="rounded border border-vscode-border bg-black/10 p-4"><div className="flex items-center gap-2"><span className="h-4 w-4 border-2 border-sky-500"/><strong className="text-sm">{account.name}</strong></div><div className="mt-2 text-xs text-vscode-muted">{account.provider ?? "Compte bancaire"} {account.maskedIdentifier ? `· ${account.maskedIdentifier}` : ""}</div><div className="mt-3 font-mono text-base">{account.balance === undefined ? "Solde indisponible" : money.format(account.balance)}</div></div>)}</div></section>
      <section className="rounded border border-vscode-border bg-vscode-panel p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Lecture du mois</h2><p className="mt-1 text-[11px] text-vscode-muted">Les virements entre comptes personnels sont exclus des revenus et dépenses.</p></div><div className="text-xs text-vscode-muted">{data.summary.internalTransfers} virement{data.summary.internalTransfers !== 1 ? "s" : ""} interne{data.summary.internalTransfers !== 1 ? "s" : ""} neutralisé{data.summary.internalTransfers !== 1 ? "s" : ""}</div></div></section>
    </main>}

    {section === "transactions" && <main className="p-7"><div className="overflow-x-auto rounded border border-vscode-border"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-vscode-panel text-[10px] uppercase tracking-wide text-vscode-muted"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Libellé</th><th className="px-3 py-2">Compte</th><th className="px-3 py-2">Catégorie personnelle</th><th className="px-3 py-2 text-right">Montant</th></tr></thead><tbody>{data.transactions.map((transaction) => <tr key={transaction.key} className={`border-t border-vscode-border ${transaction.internalTransfer ? "opacity-60" : ""}`}><td className="whitespace-nowrap px-3 py-2 text-vscode-muted">{transaction.date}</td><td className="px-3 py-2"><div>{transaction.label}</div>{transaction.internalTransfer && <span className="mt-1 inline-block rounded bg-sky-950 px-1.5 py-0.5 text-[9px] text-sky-300">Virement interne neutralisé</span>}</td><td className="px-3 py-2 text-vscode-muted">{transaction.accountName}</td><td className="px-3 py-2"><select value={transaction.personalCategory} onChange={(event) => void changeCategory(transaction.key, event.target.value as PersonalCategory)} disabled={transaction.internalTransfer} className="w-full max-w-56 rounded border border-vscode-border bg-vscode-bg px-2 py-1 disabled:opacity-50">{data.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></td><td className={`whitespace-nowrap px-3 py-2 text-right font-mono font-semibold ${transaction.amount_ttc >= 0 ? "text-green-300" : "text-red-300"}`}>{money.format(transaction.amount_ttc)}</td></tr>)}{data.transactions.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-vscode-muted">Aucun mouvement pour ce mois sur les comptes rattachés.</td></tr>}</tbody></table></div></main>}

    {section === "budgets" && <main className="space-y-5 p-7"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><h2 className="text-sm font-semibold">Budgets mensuels personnels</h2><p className="mt-1 text-[11px] text-vscode-muted">Ces budgets n’affectent pas les budgets ni les comptes comptables des entreprises.</p></div><button onClick={() => void saveBudgets()} disabled={saving} className="rounded bg-vscode-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{saving ? "Enregistrement…" : "Enregistrer les budgets"}</button></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded border border-vscode-border bg-vscode-panel p-3"><div className="text-[10px] text-vscode-muted">BUDGET TOTAL</div><strong className="font-mono">{money.format(totalBudget)}</strong></div><div className="rounded border border-vscode-border bg-vscode-panel p-3"><div className="text-[10px] text-vscode-muted">DÉPENSÉ</div><strong className="font-mono">{money.format(totalSpent)}</strong></div><div className="rounded border border-vscode-border bg-vscode-panel p-3"><div className="text-[10px] text-vscode-muted">DISPONIBLE</div><strong className={`font-mono ${totalBudget > 0 && totalSpent > totalBudget ? "text-red-300" : "text-green-300"}`}>{money.format(totalBudget - totalSpent)}</strong></div></div><div className="grid gap-3 lg:grid-cols-2">{expenseCategories.map((category) => { const budget = budgets.find((item) => item.category === category.id)?.monthlyLimit ?? 0; const spent = spending[category.id] ?? 0; const ratio = budget > 0 ? Math.min(100, spent / budget * 100) : 0; return <div key={category.id} className="rounded border border-vscode-border bg-vscode-panel p-3"><div className="flex items-center gap-3"><span className="min-w-0 flex-1 text-xs font-medium">{category.label}</span><span className="text-[10px] text-vscode-muted">{money.format(spent)} /</span><LocalizedNumberInput value={budget} onValueChange={(value) => setBudget(category.id, value)} min={0} className="w-24 rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-right text-xs" aria-label={`Budget ${category.label}`} /></div>{budget > 0 && <div className="mt-2 h-1.5 overflow-hidden rounded bg-vscode-border"><div className={`h-full ${spent > budget ? "bg-red-500" : ratio > 80 ? "bg-amber-500" : "bg-vscode-accent"}`} style={{ width: `${ratio}%` }}/></div>}</div>; })}</div></main>}
  </div>;
}
