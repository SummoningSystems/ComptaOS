import { useEffect, useState } from "react";
import { fetchTransactions, fetchBudgets, saveBudgets } from "../../api/client";
import { Category, CategoryBudget, Transaction } from "../../types";
import { format } from "date-fns";
import { fr } from "date-fns/locale";

const ALL_CATEGORIES: Category[] = [
  "hosting", "software", "salary", "subcontracting", "professional_fees", "external_services", "travel", "restaurant", "food",
  "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc",
];

const CATEGORY_LABELS: Record<Category, string> = {
  hosting: "Hébergement",
  software: "Logiciel",
  salary: "Salaire",
  subcontracting: "Sous-traitance",
  professional_fees: "Conseil et honoraires",
  external_services: "Autres prestations",
  travel: "Transport",
  restaurant: "Restaurant",
  food: "Alimentaire",
  taxes: "Impôts/Taxes",
  equipment: "Matériel",
  subscription: "Abonnement",
  rent: "Loyer",
  legal: "Juridique",
  insurance: "Assurance",
  misc: "Divers",
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function BudgetsView() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<CategoryBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [saved, setSaved] = useState(false);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    Promise.all([fetchTransactions(), fetchBudgets()])
      .then(([txns, b]) => { setTransactions(txns); setBudgets(b); })
      .finally(() => setLoading(false));
  }, []);

  // Dépenses du mois sélectionné par catégorie
  const monthTxns = transactions.filter(
    (t) => t.date.startsWith(month) && t.amount_ttc < 0 && t.status !== "rejected"
  );
  const spendingByCategory: Record<string, number> = {};
  for (const t of monthTxns) {
    spendingByCategory[t.category] = (spendingByCategory[t.category] ?? 0) + Math.abs(t.amount_ttc);
  }

  // Catégories avec budget ou avec des dépenses ce mois
  const trackedCategories = ALL_CATEGORIES.filter(
    (c) => budgets.some((b) => b.category === c) || (spendingByCategory[c] ?? 0) > 0
  );

  function getBudget(cat: string): number {
    return budgets.find((b) => b.category === cat)?.monthlyLimit ?? 0;
  }

  function setBudgetFor(cat: string, limit: number) {
    setBudgets((prev) => {
      const existing = prev.find((b) => b.category === cat);
      if (existing) {
        return prev.map((b) => b.category === cat ? { ...b, monthlyLimit: limit } : b);
      }
      return [...prev, { category: cat, monthlyLimit: limit }];
    });
  }

  async function handleSave() {
    await saveBudgets(budgets.filter((b) => b.monthlyLimit > 0));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function startEdit(cat: string) {
    setEditingCategory(cat);
    setEditValue(String(getBudget(cat) || ""));
  }

  function commitEdit(cat: string) {
    const val = parseFloat(editValue);
    if (!isNaN(val) && val >= 0) setBudgetFor(cat, val);
    setEditingCategory(null);
    setEditValue("");
  }

  const monthLabel = (() => {
    try { return format(new Date(`${month}-01`), "MMMM yyyy", { locale: fr }); }
    catch { return month; }
  })();

  if (loading) {
    return <div className="flex items-center justify-center h-full text-vscode-muted text-sm">Chargement…</div>;
  }

  const totalBudget = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const totalSpent = Object.values(spendingByCategory).reduce((s, v) => s + v, 0);
  const overBudgetCount = trackedCategories.filter((c) => {
    const limit = getBudget(c);
    return limit > 0 && (spendingByCategory[c] ?? 0) > limit;
  }).length;

  return (
    <div className="flex flex-col h-full overflow-auto p-6 gap-6">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="text-vscode-text text-base font-semibold">Budgets par catégorie</h2>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-vscode-bg border border-vscode-border text-vscode-text text-xs rounded px-2 py-1 focus:outline-none focus:border-vscode-accent"
        />
        <span className="text-vscode-muted text-xs capitalize">{monthLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          {saved && <span className="text-green-400 text-xs">✓ Sauvegardé</span>}
          <button
            onClick={handleSave}
            className="bg-vscode-accent hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded"
          >
            Sauvegarder les budgets
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 max-w-2xl">
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-3">
          <p className="text-[11px] text-vscode-muted uppercase tracking-wide">Budget total/mois</p>
          <p className="text-lg font-mono font-semibold text-vscode-text">{totalBudget.toFixed(0)} €</p>
        </div>
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-3">
          <p className="text-[11px] text-vscode-muted uppercase tracking-wide">Dépensé ce mois</p>
          <p className={`text-lg font-mono font-semibold ${totalSpent > totalBudget && totalBudget > 0 ? "text-red-300" : "text-vscode-text"}`}>
            {totalSpent.toFixed(0)} €
          </p>
        </div>
        <div className="bg-vscode-sidebar border border-vscode-border rounded-lg p-3">
          <p className="text-[11px] text-vscode-muted uppercase tracking-wide">Catég. dépassées</p>
          <p className={`text-lg font-mono font-semibold ${overBudgetCount > 0 ? "text-red-300" : "text-green-300"}`}>
            {overBudgetCount}
          </p>
        </div>
      </div>

      {/* Budget editor / progress */}
      <div className="max-w-2xl space-y-2">
        <p className="text-xs text-vscode-muted mb-3">
          Cliquez sur le montant budget pour le modifier. Les barres montrent la consommation du mois sélectionné.
        </p>

        {ALL_CATEGORIES.map((cat) => {
          const limit = getBudget(cat);
          const spent = spendingByCategory[cat] ?? 0;
          const pct = limit > 0 ? Math.min((spent / limit) * 100, 100) : 0;
          const over = limit > 0 && spent > limit;
          const hasActivity = spent > 0 || limit > 0;

          if (!hasActivity) return null;

          return (
            <div key={cat} className="bg-vscode-sidebar border border-vscode-border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-vscode-text">{CATEGORY_LABELS[cat]}</span>
                <div className="flex items-center gap-3 text-xs">
                  <span className={`tabular-nums ${over ? "text-red-300 font-semibold" : "text-vscode-muted"}`}>
                    {spent.toFixed(2)} €
                  </span>
                  <span className="text-vscode-muted">/</span>
                  {editingCategory === cat ? (
                    <input
                      type="number"
                      min={0}
                      step={50}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitEdit(cat)}
                      onKeyDown={(e) => { if (e.key === "Enter") commitEdit(cat); if (e.key === "Escape") setEditingCategory(null); }}
                      autoFocus
                      className="w-20 bg-vscode-bg border border-vscode-accent rounded px-1 py-0.5 text-xs text-vscode-text focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startEdit(cat)}
                      className="tabular-nums text-vscode-muted hover:text-vscode-text hover:underline"
                      title="Cliquer pour modifier le budget"
                    >
                      {limit > 0 ? `${limit.toFixed(0)} €/mois` : "+ budget"}
                    </button>
                  )}
                </div>
              </div>
              {limit > 0 && (
                <div className="h-1.5 bg-vscode-border rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-yellow-500" : "bg-vscode-accent"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              {over && (
                <p className="text-[10px] text-red-400 mt-1">
                  Dépassement de {(spent - limit).toFixed(2)} € ({Math.round((spent / limit) * 100)}% du budget)
                </p>
              )}
            </div>
          );
        })}

        {/* Ajouter une catégorie sans activité */}
        <details className="mt-4">
          <summary className="text-xs text-vscode-muted cursor-pointer hover:text-vscode-text select-none">
            + Ajouter un budget pour d'autres catégories
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {ALL_CATEGORIES.filter((c) => !budgets.some((b) => b.category === c) && !(spendingByCategory[c] ?? 0)).map((cat) => (
              <button
                key={cat}
                onClick={() => { setBudgetFor(cat, 500); startEdit(cat); }}
                className="text-left text-xs text-vscode-muted hover:text-vscode-text border border-dashed border-vscode-border rounded px-2 py-1 hover:border-vscode-accent"
              >
                + {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
