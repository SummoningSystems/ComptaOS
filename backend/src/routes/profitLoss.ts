import { FastifyInstance } from "fastify";
import { loadAllTransactions } from "../services/transactionService.js";
import { Category } from "../types/index.js";

const CATEGORY_LABELS: Record<Category, string> = {
  hosting: "Hébergement",
  software: "Logiciels",
  salary: "Salaires",
  subcontracting: "Sous-traitance",
  professional_fees: "Conseil et honoraires",
  external_services: "Autres prestations",
  travel: "Déplacements",
  restaurant: "Restauration",
  food: "Alimentation",
  taxes: "Impôts & Taxes",
  equipment: "Équipements",
  subscription: "Abonnements",
  rent: "Loyers",
  legal: "Frais juridiques",
  insurance: "Assurances",
  misc: "Divers",
};

export async function profitLossRoutes(app: FastifyInstance) {
  /**
   * GET /api/pl?year=2025
   * Retourne le compte de résultat N vs N-1 :
   *   - produits (amount_ttc > 0) par catégorie
   *   - charges (amount_ttc < 0) par catégorie
   *   - comparaison avec l'année précédente
   */
  app.get<{ Querystring: { year?: string } }>("/", async (req, reply) => {
    const year = req.query.year ?? String(new Date().getFullYear());
    const prevYear = String(parseInt(year) - 1);

    const all = await loadAllTransactions();
    const active = all.filter((t) => t.status !== "rejected");

    function computeForYear(y: string) {
      const txns = active.filter((t) => t.date.startsWith(y));

      // Regrouper par catégorie
      const revenue: Record<string, number> = {};
      const expenses: Record<string, number> = {};

      for (const t of txns) {
        const cat = t.category ?? "misc";
        if (t.amount_ht > 0) {
          revenue[cat] = (revenue[cat] ?? 0) + t.amount_ht;
        } else {
          expenses[cat] = (expenses[cat] ?? 0) + Math.abs(t.amount_ht);
        }
      }

      // Totaux mensuels pour graphique
      const monthly: Record<string, { revenue: number; expenses: number }> = {};
      for (const t of txns) {
        const m = t.date.slice(0, 7); // "YYYY-MM"
        if (!monthly[m]) monthly[m] = { revenue: 0, expenses: 0 };
        if (t.amount_ht > 0) monthly[m].revenue += t.amount_ht;
        else monthly[m].expenses += Math.abs(t.amount_ht);
      }

      const totalRevenue = Object.values(revenue).reduce((s, v) => s + v, 0);
      const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);

      return {
        revenue: Object.entries(revenue).map(([cat, amount]) => ({
          category: cat,
          label: CATEGORY_LABELS[cat as Category] ?? cat,
          amount: parseFloat(amount.toFixed(2)),
        })).sort((a, b) => b.amount - a.amount),
        expenses: Object.entries(expenses).map(([cat, amount]) => ({
          category: cat,
          label: CATEGORY_LABELS[cat as Category] ?? cat,
          amount: parseFloat(amount.toFixed(2)),
        })).sort((a, b) => b.amount - a.amount),
        totalRevenue: parseFloat(totalRevenue.toFixed(2)),
        totalExpenses: parseFloat(totalExpenses.toFixed(2)),
        netResult: parseFloat((totalRevenue - totalExpenses).toFixed(2)),
        monthly: Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
          month,
          revenue: parseFloat(v.revenue.toFixed(2)),
          expenses: parseFloat(v.expenses.toFixed(2)),
          net: parseFloat((v.revenue - v.expenses).toFixed(2)),
        })),
      };
    }

    const current = computeForYear(year);
    const previous = computeForYear(prevYear);

    return reply.send({ year, prevYear, current, previous });
  });
}
