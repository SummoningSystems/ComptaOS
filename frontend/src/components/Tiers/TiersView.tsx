import { useEffect, useState } from "react";
import { fetchTransactions } from "../../api/client";
import { Transaction } from "../../types";
import { useCategoryCatalog } from "../../hooks/useCategoryCatalog";

interface TierStats {
  name: string;
  count: number;
  totalIn: number;   // somme des montants > 0
  totalOut: number;  // somme abs des montants < 0
  balance: number;
  lastDate: string;
  transactions: Transaction[];
}

export function TiersView() {
  const { categories } = useCategoryCatalog();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"balance" | "count" | "name" | "last">("balance");
  const [directionFilter, setDirectionFilter] = useState<"" | "in" | "out">("");

  useEffect(() => {
    fetchTransactions()
      .then(setTransactions)
      .finally(() => setLoading(false));
  }, []);

  // Grouper par tiers (notes field)
  const tierMap = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const name = t.notes?.trim() || "(sans tiers)";
    if (!tierMap.has(name)) tierMap.set(name, []);
    tierMap.get(name)!.push(t);
  }

  const tiers: TierStats[] = [];
  for (const [name, txns] of tierMap) {
    const totalIn = txns.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0);
    const totalOut = txns.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.amount_ttc), 0);
    tiers.push({
      name,
      count: txns.length,
      totalIn,
      totalOut,
      balance: totalIn - totalOut,
      lastDate: txns.map((t) => t.date).sort().at(-1) ?? "",
      transactions: txns.sort((a, b) => b.date.localeCompare(a.date)),
    });
  }

  const filtered = tiers
    .filter((t) => {
      const matchSearch = t.name.toLowerCase().includes(search.toLowerCase());
      const matchDir =
        directionFilter === "" ? true :
        directionFilter === "in" ? t.totalIn > 0 :
        t.totalOut > 0;
      return matchSearch && matchDir;
    })
    .sort((a, b) => {
      if (sortBy === "balance") return b.balance - a.balance;
      if (sortBy === "count") return b.count - a.count;
      if (sortBy === "last") return b.lastDate.localeCompare(a.lastDate);
      return a.name.localeCompare(b.name);
    });

  const totalTiers = filtered.length;
  const totalIn = filtered.reduce((s, t) => s + t.totalIn, 0);
  const totalOut = filtered.reduce((s, t) => s + t.totalOut, 0);

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const s = new Set(prev);
      s.has(name) ? s.delete(name) : s.add(name);
      return s;
    });
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-vscode-panel border-b border-vscode-border shrink-0 flex-wrap">
        <span className="text-vscode-muted text-xs">{totalTiers} tiers</span>
        <input
          type="text"
          placeholder="Rechercher un tiers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs px-2 py-1 rounded w-48 focus:outline-none focus:border-vscode-accent"
        />
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value as "" | "in" | "out")}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-0.5"
        >
          <option value="">Tous</option>
          <option value="in">Entrées seulement</option>
          <option value="out">Sorties seulement</option>
        </select>
        <div className="ml-auto flex items-center gap-2 text-xs">
          <span className="text-vscode-muted">Trier :</span>
          {(["balance", "count", "last", "name"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                sortBy === s
                  ? "bg-vscode-accent text-white border-vscode-accent"
                  : "border-vscode-border text-vscode-muted hover:text-vscode-text"
              }`}
            >
              {s === "balance" ? "Solde" : s === "count" ? "Nb txn" : s === "last" ? "Récent" : "Nom"}
            </button>
          ))}
        </div>
      </div>

      {/* Résumé */}
      <div className="flex items-center gap-6 px-4 py-2 bg-vscode-sidebar border-b border-vscode-border text-xs shrink-0">
        <span className="text-green-400">Entrées totales : +{totalIn.toFixed(2)} €</span>
        <span className="text-red-400">Sorties totales : −{totalOut.toFixed(2)} €</span>
        <span className={`font-semibold ${(totalIn - totalOut) >= 0 ? "text-green-300" : "text-red-300"}`}>
          Balance : {(totalIn - totalOut) >= 0 ? "+" : ""}{(totalIn - totalOut).toFixed(2)} €
        </span>
      </div>

      {/* Liste tiers */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="text-center text-vscode-muted py-16 text-sm">Aucun tiers trouvé</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-vscode-panel border-b border-vscode-border z-10">
              <tr>
                <th className="text-left px-4 py-2 text-vscode-muted font-medium">Tiers</th>
                <th className="text-right px-3 py-2 text-vscode-muted font-medium">Txn</th>
                <th className="text-right px-3 py-2 text-green-400/70 font-medium">Entrées</th>
                <th className="text-right px-3 py-2 text-red-400/70 font-medium">Sorties</th>
                <th className="text-right px-4 py-2 text-vscode-muted font-medium">Solde</th>
                <th className="text-right px-4 py-2 text-vscode-muted font-medium">Dernière</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tier) => {
                const isExpanded = expanded.has(tier.name);
                return (
                  <>
                    <tr
                      key={tier.name}
                      onClick={() => toggleExpand(tier.name)}
                      className="border-b border-vscode-border hover:bg-vscode-panel cursor-pointer select-none"
                    >
                      <td className="px-4 py-2 flex items-center gap-2">
                        <span className={`text-[10px] transition-transform inline-block ${isExpanded ? "rotate-90" : ""}`}>▶</span>
                        <span className="text-vscode-text font-medium">{tier.name}</span>
                      </td>
                      <td className="text-right px-3 py-2 text-vscode-muted">{tier.count}</td>
                      <td className="text-right px-3 py-2 text-green-400 tabular-nums">
                        {tier.totalIn > 0 ? `+${tier.totalIn.toFixed(2)} €` : "—"}
                      </td>
                      <td className="text-right px-3 py-2 text-red-400 tabular-nums">
                        {tier.totalOut > 0 ? `−${tier.totalOut.toFixed(2)} €` : "—"}
                      </td>
                      <td className={`text-right px-4 py-2 font-mono font-semibold tabular-nums ${tier.balance >= 0 ? "text-green-300" : "text-red-300"}`}>
                        {tier.balance >= 0 ? "+" : ""}{tier.balance.toFixed(2)} €
                      </td>
                      <td className="text-right px-4 py-2 text-vscode-muted">{tier.lastDate}</td>
                    </tr>
                    {isExpanded && tier.transactions.map((t) => (
                      <tr key={t.id} className="border-b border-vscode-border/50 bg-vscode-bg/50">
                        <td className="px-8 py-1.5 text-vscode-muted max-w-xs truncate" title={t.label}>{t.label}</td>
                        <td className="text-right px-3 py-1.5 text-vscode-muted">{t.date}</td>
                        <td colSpan={2} />
                        <td className={`text-right px-4 py-1.5 font-mono tabular-nums ${t.amount_ttc >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {t.amount_ttc >= 0 ? "+" : ""}{t.amount_ttc.toFixed(2)} €
                        </td>
                        <td className="px-4 py-1.5 text-vscode-muted text-[10px]">{categories.find((category) => category.id === t.category)?.label ?? t.category}</td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
