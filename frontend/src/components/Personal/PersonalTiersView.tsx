import { Fragment, useMemo, useState } from "react";
import type { PersonalCategory, PersonalFinanceSnapshot, PersonalTransaction } from "../../types";

const money = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" });
const date = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });

type Direction = "expenses" | "income" | "all";
type Sort = "spent" | "received" | "count" | "last" | "name";

interface PersonalTier {
  key: string;
  name: string;
  count: number;
  spent: number;
  received: number;
  lastDate: string;
  mainCategory: string;
  transactions: PersonalTransaction[];
}

function tierName(transaction: PersonalTransaction) {
  const label = transaction.label.trim().replace(/\s+/g, " ");
  return label || transaction.notes?.trim() || "Tiers non renseigné";
}

function tierKey(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR");
}

function parseDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : date.format(parsed);
}

export function PersonalTiersView({ snapshot, loading = false }: { snapshot: PersonalFinanceSnapshot; loading?: boolean }) {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<Direction>("expenses");
  const [category, setCategory] = useState("");
  const [account, setAccount] = useState("");
  const [year, setYear] = useState("");
  const [sort, setSort] = useState<Sort>("spent");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const categoryLabels = useMemo(() => new Map(snapshot.categories.map((item) => [item.id, item.label])), [snapshot.categories]);
  const years = useMemo(() => [...new Set(snapshot.transactions.map((transaction) => transaction.date.slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a)), [snapshot.transactions]);

  const tiers = useMemo(() => {
    const groups = new Map<string, { name: string; transactions: PersonalTransaction[] }>();
    for (const transaction of snapshot.transactions) {
      if (transaction.internalTransfer) continue;
      if (direction === "expenses" && transaction.amount_ttc >= 0) continue;
      if (direction === "income" && transaction.amount_ttc <= 0) continue;
      if (category && transaction.personalCategory !== category) continue;
      if (account && `${transaction.sourceWorkspaceId}:${transaction.sourceAccountId}` !== account) continue;
      if (year && !transaction.date.startsWith(year)) continue;

      const name = tierName(transaction);
      const key = tierKey(name);
      const group = groups.get(key);
      if (group) group.transactions.push(transaction);
      else groups.set(key, { name, transactions: [transaction] });
    }

    return [...groups.entries()].map<PersonalTier>(([key, group]) => {
      const transactions = [...group.transactions].sort((a, b) => b.date.localeCompare(a.date));
      const categoryTotals = new Map<PersonalCategory, number>();
      for (const transaction of transactions) {
        const amount = Math.abs(transaction.amount_ttc);
        categoryTotals.set(transaction.personalCategory, (categoryTotals.get(transaction.personalCategory) ?? 0) + amount);
      }
      const mainCategoryId = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return {
        key,
        name: group.name,
        count: transactions.length,
        spent: transactions.reduce((sum, transaction) => sum + (transaction.amount_ttc < 0 ? Math.abs(transaction.amount_ttc) : 0), 0),
        received: transactions.reduce((sum, transaction) => sum + (transaction.amount_ttc > 0 ? transaction.amount_ttc : 0), 0),
        lastDate: transactions[0]?.date ?? "",
        mainCategory: mainCategoryId ? categoryLabels.get(mainCategoryId) ?? mainCategoryId : "—",
        transactions,
      };
    }).filter((tier) => tier.name.toLocaleLowerCase("fr-FR").includes(search.trim().toLocaleLowerCase("fr-FR")))
      .sort((a, b) => {
        if (sort === "spent") return b.spent - a.spent;
        if (sort === "received") return b.received - a.received;
        if (sort === "count") return b.count - a.count;
        if (sort === "last") return b.lastDate.localeCompare(a.lastDate);
        return a.name.localeCompare(b.name, "fr");
      });
  }, [account, category, categoryLabels, direction, search, snapshot.transactions, sort, year]);

  const totals = useMemo(() => tiers.reduce((result, tier) => ({
    count: result.count + tier.count,
    spent: result.spent + tier.spent,
    received: result.received + tier.received,
  }), { count: 0, spent: 0, received: 0 }), [tiers]);

  function toggle(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  if (loading) return <main className="flex items-center justify-center p-10 text-sm text-vscode-muted">Chargement de l’historique des tiers…</main>;

  return <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="flex flex-wrap items-center gap-2 border-b border-vscode-border bg-vscode-panel px-5 py-3">
      <div className="mr-2"><h2 className="text-sm font-semibold">Tiers personnels</h2><p className="text-[10px] text-vscode-muted">Commerçants et organismes regroupés sur tout l’historique, hors virements internes.</p></div>
      <input aria-label="Rechercher un tiers" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Rechercher un tiers…" className="w-48 rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs" />
      <select aria-label="Type de mouvements des tiers" value={direction} onChange={(event) => setDirection(event.target.value as Direction)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="expenses">Dépenses</option><option value="income">Revenus</option><option value="all">Tous les mouvements</option></select>
      <select aria-label="Catégorie des tiers" value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Toutes les catégories</option>{snapshot.categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <select aria-label="Compte des tiers" value={account} onChange={(event) => setAccount(event.target.value)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Tous les comptes</option>{snapshot.accounts.map((item) => <option key={item.id} value={`${item.sourceWorkspaceId}:${item.sourceAccountId}`}>{item.name}</option>)}</select>
      <select aria-label="Année des tiers" value={year} onChange={(event) => setYear(event.target.value)} className="rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="">Toutes les années</option>{years.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select aria-label="Trier les tiers" value={sort} onChange={(event) => setSort(event.target.value as Sort)} className="ml-auto rounded border border-vscode-border bg-vscode-bg px-2 py-1.5 text-xs"><option value="spent">Plus dépensé</option><option value="received">Plus reçu</option><option value="count">Plus d’opérations</option><option value="last">Plus récent</option><option value="name">Nom</option></select>
    </div>

    <div className="grid shrink-0 gap-3 border-b border-vscode-border px-5 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <div><div className="text-[10px] uppercase text-vscode-muted">Tiers affichés</div><strong className="font-mono text-blue-300">{tiers.length}</strong></div>
      <div><div className="text-[10px] uppercase text-vscode-muted">Opérations</div><strong className="font-mono">{totals.count}</strong></div>
      <div><div className="text-[10px] uppercase text-vscode-muted">Dépensé</div><strong className="font-mono text-red-300">{money.format(totals.spent)}</strong></div>
      <div><div className="text-[10px] uppercase text-vscode-muted">Reçu</div><strong className="font-mono text-green-300">{money.format(totals.received)}</strong></div>
    </div>

    <div className="min-h-0 flex-1 overflow-auto">
      {tiers.length === 0 ? <div className="p-12 text-center text-sm text-vscode-muted">Aucun tiers ne correspond à ces filtres.</div> : <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 border-b border-vscode-border bg-vscode-panel"><tr><th className="px-5 py-2 text-left font-medium text-vscode-muted">Tiers</th><th className="px-3 py-2 text-left font-medium text-vscode-muted">Catégorie principale</th><th className="px-3 py-2 text-right font-medium text-vscode-muted">Opérations</th><th className="px-3 py-2 text-right font-medium text-red-300/80">Dépensé</th><th className="px-3 py-2 text-right font-medium text-green-300/80">Reçu</th><th className="px-5 py-2 text-right font-medium text-vscode-muted">Dernière opération</th></tr></thead>
        <tbody>{tiers.map((tier) => <Fragment key={tier.key}>
          <tr onClick={() => toggle(tier.key)} className="cursor-pointer border-b border-vscode-border hover:bg-vscode-panel/70"><td className="px-5 py-2 font-medium"><span className={`mr-2 inline-block text-[9px] transition-transform ${expanded.has(tier.key) ? "rotate-90" : ""}`}>▶</span>{tier.name}</td><td className="px-3 py-2 text-vscode-muted">{tier.mainCategory}</td><td className="px-3 py-2 text-right font-mono">{tier.count}</td><td className="px-3 py-2 text-right font-mono text-red-300">{tier.spent ? money.format(tier.spent) : "—"}</td><td className="px-3 py-2 text-right font-mono text-green-300">{tier.received ? money.format(tier.received) : "—"}</td><td className="px-5 py-2 text-right text-vscode-muted">{parseDate(tier.lastDate)}</td></tr>
          {expanded.has(tier.key) && tier.transactions.map((transaction) => <tr key={transaction.key} className="border-b border-vscode-border/60 bg-black/10"><td className="py-1.5 pl-11 pr-3 text-vscode-muted">{transaction.label}</td><td className="px-3 py-1.5 text-vscode-muted">{categoryLabels.get(transaction.personalCategory) ?? transaction.personalCategory}</td><td className="px-3 py-1.5 text-right text-vscode-muted">{transaction.accountName}</td><td colSpan={2} className={`px-3 py-1.5 text-right font-mono ${transaction.amount_ttc < 0 ? "text-red-300" : "text-green-300"}`}>{money.format(transaction.amount_ttc)}</td><td className="px-5 py-1.5 text-right text-vscode-muted">{parseDate(transaction.date)}</td></tr>)}
        </Fragment>)}</tbody>
      </table>}
    </div>
  </main>;
}
