import { useMemo, useState } from "react";
import type { PersonalCategory, PersonalFinanceSnapshot, PersonalTransaction } from "../../types";

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const MONTHS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

type SortMode = "date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "label";

interface Props {
  snapshot: PersonalFinanceSnapshot;
  loading: boolean;
  onCategoryChange: (key: string, category: PersonalCategory) => Promise<void>;
  onBatchCategoryChange: (keys: string[], category: PersonalCategory) => Promise<void>;
}

function matchesSearch(transaction: PersonalTransaction, categoryLabel: string, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("fr-FR");
  if (!normalized) return true;
  const amountQuery = Number(normalized.replace(/\s/g, "").replace(",", ".").replace(/€$/, ""));
  const text = `${transaction.label} ${transaction.accountName} ${categoryLabel} ${transaction.date}`.toLocaleLowerCase("fr-FR");
  return text.includes(normalized) || (Number.isFinite(amountQuery) && Math.abs(Math.abs(transaction.amount_ttc) - Math.abs(amountQuery)) < 0.01);
}

export function PersonalTransactionsView({ snapshot, loading, onCategoryChange, onBatchCategoryChange }: Props) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [flow, setFlow] = useState<"" | "income" | "expense" | "transfer">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<SortMode>("date_desc");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchCategory, setBatchCategory] = useState<PersonalCategory>("personal_misc");
  const [batchSaving, setBatchSaving] = useState(false);

  const categoryLabels = useMemo(() => new Map(snapshot.categories.map((item) => [item.id, item.label])), [snapshot.categories]);
  const accounts = useMemo(() => [...new Set(snapshot.transactions.map((item) => item.accountName))].sort((a, b) => a.localeCompare(b, "fr")), [snapshot.transactions]);

  const filtered = useMemo(() => {
    const transactions = snapshot.transactions.filter((transaction) => {
      if (!matchesSearch(transaction, categoryLabels.get(transaction.personalCategory) ?? transaction.personalCategory, query)) return false;
      if (category && transaction.personalCategory !== category) return false;
      if (account && transaction.accountName !== account) return false;
      if (dateFrom && transaction.date < dateFrom) return false;
      if (dateTo && transaction.date > dateTo) return false;
      if (flow === "income" && (transaction.amount_ttc <= 0 || transaction.internalTransfer)) return false;
      if (flow === "expense" && (transaction.amount_ttc >= 0 || transaction.internalTransfer)) return false;
      if (flow === "transfer" && !transaction.internalTransfer) return false;
      return true;
    });
    return transactions.sort((left, right) => {
      if (sort === "date_asc") return left.date.localeCompare(right.date);
      if (sort === "amount_desc") return Math.abs(right.amount_ttc) - Math.abs(left.amount_ttc);
      if (sort === "amount_asc") return Math.abs(left.amount_ttc) - Math.abs(right.amount_ttc);
      if (sort === "label") return left.label.localeCompare(right.label, "fr");
      return right.date.localeCompare(left.date);
    });
  }, [snapshot.transactions, categoryLabels, query, category, account, dateFrom, dateTo, flow, sort]);

  const groups = useMemo(() => {
    const byYear = new Map<string, Map<string, PersonalTransaction[]>>();
    for (const transaction of filtered) {
      const year = transaction.date.slice(0, 4); const month = transaction.date.slice(5, 7);
      if (!byYear.has(year)) byYear.set(year, new Map());
      const months = byYear.get(year)!; months.set(month, [...(months.get(month) ?? []), transaction]);
    }
    const years = [...byYear.entries()].sort((a, b) => sort === "date_asc" ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]));
    return years.map(([year, months]) => ({
      year,
      months: [...months.entries()].sort((a, b) => sort === "date_asc" ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])).map(([month, transactions]) => ({ key: `${year}-${month}`, month, transactions })),
    }));
  }, [filtered, sort]);

  const relevant = filtered.filter((transaction) => !transaction.internalTransfer);
  const income = relevant.filter((transaction) => transaction.amount_ttc > 0).reduce((sum, transaction) => sum + transaction.amount_ttc, 0);
  const expenses = relevant.filter((transaction) => transaction.amount_ttc < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0);
  const activeFilters = Boolean(query || category || account || flow || dateFrom || dateTo || sort !== "date_desc");

  function toggleCollapse(key: string) { setCollapsed((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; }); }
  function toggleKeys(keys: string[], checked: boolean) { setSelected((current) => { const next = new Set(current); for (const key of keys) checked ? next.delete(key) : next.add(key); return next; }); }
  function resetFilters() { setQuery(""); setCategory(""); setAccount(""); setFlow(""); setDateFrom(""); setDateTo(""); setSort("date_desc"); }

  async function applyBatchCategory() {
    const keys = [...selected]; if (keys.length === 0) return;
    setBatchSaving(true);
    try { await onBatchCategoryChange(keys, batchCategory); setSelected(new Set()); }
    finally { setBatchSaving(false); }
  }

  function exportCsv() {
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filtered.map((transaction) => [transaction.date, escape(transaction.label), escape(transaction.accountName), escape(categoryLabels.get(transaction.personalCategory) ?? transaction.personalCategory), transaction.amount_ttc.toFixed(2), transaction.internalTransfer ? "oui" : "non"]);
    const csv = [["Date", "Libellé", "Compte", "Catégorie personnelle", "Montant", "Virement interne"].join(";"), ...rows.map((row) => row.join(";"))].join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `mouvements_personnels_${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  }

  return <main className="flex min-h-0 flex-1 flex-col">
    <div className="border-b border-vscode-border bg-vscode-sidebar px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-vscode-muted"><strong className="text-vscode-text">{snapshot.transactions.length}</strong> mouvements{activeFilters ? ` · ${filtered.length} affichés` : ""}</div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un libellé, compte ou montant…" className="min-w-56 flex-1 rounded border border-vscode-border bg-vscode-bg px-3 py-1.5 text-xs" />
        <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Toutes catégories</option>{snapshot.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        <select value={account} onChange={(event) => setAccount(event.target.value)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Tous les comptes</option>{accounts.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <select value={flow} onChange={(event) => setFlow(event.target.value as typeof flow)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Tous les flux</option><option value="income">Revenus</option><option value="expense">Dépenses</option><option value="transfer">Virements internes</option></select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} aria-label="Date de début" className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs" />
        <span className="text-vscode-muted">→</span>
        <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} aria-label="Date de fin" className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs" />
        <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="Trier les mouvements" className="rounded border border-vscode-border bg-vscode-bg px-2 py-1 text-xs"><option value="date_desc">Plus récents</option><option value="date_asc">Plus anciens</option><option value="amount_desc">Montant décroissant</option><option value="amount_asc">Montant croissant</option><option value="label">Libellé A–Z</option></select>
        <button onClick={resetFilters} disabled={!activeFilters} className="rounded border border-vscode-border px-2 py-1 text-xs text-vscode-muted disabled:opacity-40">Réinitialiser les filtres</button>
        <div className="ml-auto flex items-center gap-3 font-mono text-[11px]"><span className="text-green-400">+{money.format(income)}</span><span className="text-red-400">−{money.format(expenses)}</span><strong className={income - expenses >= 0 ? "text-green-300" : "text-red-300"}>Solde {money.format(income - expenses)}</strong><button onClick={exportCsv} className="rounded border border-vscode-border px-2 py-1 text-vscode-text">↓ CSV</button></div>
      </div>
      {selected.size > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-blue-800 bg-blue-950/20 px-3 py-2 text-xs"><strong>{selected.size} sélectionné{selected.size > 1 ? "s" : ""}</strong><select value={batchCategory} onChange={(event) => setBatchCategory(event.target.value as PersonalCategory)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1">{snapshot.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><button onClick={() => void applyBatchCategory()} disabled={batchSaving} className="rounded bg-vscode-accent px-3 py-1 font-semibold text-white disabled:opacity-50">{batchSaving ? "Classement…" : "Classer la sélection"}</button><button onClick={() => setSelected(new Set())} className="text-vscode-muted">Annuler</button></div>}
    </div>

    <div className="flex-1 overflow-auto">
      {loading ? <div className="p-8 text-center text-sm text-vscode-muted">Chargement de l’historique…</div> : groups.length === 0 ? <div className="p-12 text-center text-sm text-vscode-muted">Aucun mouvement ne correspond aux filtres.</div> : groups.map(({ year, months }) => {
        const yearKeys = months.flatMap((item) => item.transactions.map((transaction) => transaction.key)); const yearChecked = yearKeys.every((key) => selected.has(key)); const yearSome = yearKeys.some((key) => selected.has(key));
        return <section key={year}>
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-vscode-border bg-vscode-bg px-4 py-2"><input type="checkbox" checked={yearChecked} ref={(element) => { if (element) element.indeterminate = yearSome && !yearChecked; }} onChange={() => toggleKeys(yearKeys, yearChecked)} /><button onClick={() => toggleCollapse(year)} className="flex flex-1 items-center gap-2 text-left"><span className={`text-[10px] transition-transform ${collapsed.has(year) ? "" : "rotate-90"}`}>▶</span><strong>{year}</strong><span className="text-xs text-vscode-muted">{yearKeys.length} mouvements</span></button></div>
          {!collapsed.has(year) && months.map(({ key, month, transactions }) => {
            const keys = transactions.map((transaction) => transaction.key); const checked = keys.every((item) => selected.has(item)); const some = keys.some((item) => selected.has(item)); const monthRelevant = transactions.filter((transaction) => !transaction.internalTransfer); const monthIncome = monthRelevant.filter((transaction) => transaction.amount_ttc > 0).reduce((sum, transaction) => sum + transaction.amount_ttc, 0); const monthExpenses = monthRelevant.filter((transaction) => transaction.amount_ttc < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount_ttc), 0);
            return <div key={key}><div className="sticky top-[37px] z-[9] flex items-center gap-2 border-b border-vscode-border bg-vscode-sidebar px-5 py-1.5"><input type="checkbox" checked={checked} ref={(element) => { if (element) element.indeterminate = some && !checked; }} onChange={() => toggleKeys(keys, checked)} /><button onClick={() => toggleCollapse(key)} className="flex flex-1 items-center gap-2 text-left"><span className={`text-[9px] transition-transform ${collapsed.has(key) ? "" : "rotate-90"}`}>▶</span><strong className="w-20 text-xs">{MONTHS[Number(month) - 1]}</strong><span className="text-[10px] text-vscode-muted">{transactions.length} op.</span>{monthIncome > 0 && <span className="text-[10px] text-green-400">+{money.format(monthIncome)}</span>}{monthExpenses > 0 && <span className="text-[10px] text-red-400">−{money.format(monthExpenses)}</span>}</button></div>
              {!collapsed.has(key) && <table className="w-full min-w-[900px] text-left text-xs"><tbody>{transactions.map((transaction) => <tr key={transaction.key} className={`border-b border-vscode-border hover:bg-vscode-panel ${selected.has(transaction.key) ? "bg-blue-950/25" : ""} ${transaction.internalTransfer ? "opacity-65" : ""}`}><td className="w-8 py-2 pl-6"><input type="checkbox" checked={selected.has(transaction.key)} onChange={() => toggleKeys([transaction.key], selected.has(transaction.key))} /></td><td className="w-16 whitespace-nowrap px-2 py-2 font-mono text-vscode-muted">{transaction.date.slice(8, 10)}/{transaction.date.slice(5, 7)}</td><td className="max-w-[360px] px-2 py-2"><div className="truncate" title={transaction.label}>{transaction.label}</div>{transaction.internalTransfer && <span className="mt-1 inline-block rounded bg-sky-950 px-1.5 py-0.5 text-[9px] text-sky-300">Virement interne neutralisé</span>}</td><td className="w-48 truncate px-2 py-2 text-vscode-muted" title={transaction.accountName}>{transaction.accountName}</td><td className="w-64 px-2 py-2"><select value={transaction.personalCategory} onChange={(event) => void onCategoryChange(transaction.key, event.target.value as PersonalCategory)} disabled={transaction.internalTransfer} className="w-full rounded border border-vscode-border bg-vscode-bg px-2 py-1 disabled:opacity-50">{snapshot.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></td><td className={`w-32 whitespace-nowrap px-4 py-2 text-right font-mono font-semibold ${transaction.amount_ttc >= 0 ? "text-green-300" : "text-red-300"}`}>{money.format(transaction.amount_ttc)}</td></tr>)}</tbody></table>}
            </div>;
          })}
        </section>;
      })}
    </div>
  </main>;
}
