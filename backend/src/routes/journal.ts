import { FastifyInstance } from "fastify";
import { loadAllTransactions } from "../services/transactionService.js";
import { loadCategoryCatalog } from "../services/categoryCatalogService.js";

/** Map catégorie → comptes PCG débit/crédit */
const PCG_MAP: Record<string, { debit: string; credit: string; label: string }> = {
  salary:       { debit: "641000", credit: "512000", label: "Rémunérations" },
  subcontracting: { debit: "611000", credit: "512000", label: "Sous-traitance générale" },
  professional_fees: { debit: "622600", credit: "512000", label: "Honoraires" },
  external_services: { debit: "628000", credit: "512000", label: "Autres services extérieurs" },
  hosting:      { debit: "626000", credit: "512000", label: "Frais hébergement/cloud" },
  software:     { debit: "605000", credit: "512000", label: "Logiciels & licences" },
  travel:       { debit: "625000", credit: "512000", label: "Déplacements & transport" },
  restaurant:   { debit: "625100", credit: "512000", label: "Repas professionnels" },
  food:         { debit: "625100", credit: "512000", label: "Repas / alimentation" },
  taxes:        { debit: "695000", credit: "512000", label: "Impôts & taxes" },
  equipment:    { debit: "606000", credit: "512000", label: "Matériel & équipement" },
  subscription: { debit: "626100", credit: "512000", label: "Abonnements" },
  rent:         { debit: "613000", credit: "512000", label: "Loyers" },
  legal:        { debit: "622000", credit: "512000", label: "Honoraires & frais juridiques" },
  insurance:    { debit: "616000", credit: "512000", label: "Assurances" },
  misc:         { debit: "658000", credit: "512000", label: "Charges diverses" },
};

export async function journalRoutes(app: FastifyInstance) {
  /** GET /api/journal?year=2025&month=01 */
  app.get<{ Querystring: { year?: string; month?: string } }>("/", async (req, reply) => {
    const { year, month } = req.query;
    const all = await loadAllTransactions();
    const categoryAccounts = new Map(loadCategoryCatalog().map((category) => [category.id, category.account]));

    const filtered = all.filter((t) => {
      if (t.status === "rejected") return false;
      if (year && !t.date.startsWith(year)) return false;
      if (month && !t.date.startsWith(`${year ?? t.date.slice(0, 4)}-${month}`)) return false;
      return true;
    });

    const entries = filtered.map((t) => {
      const pcg = PCG_MAP[t.category] ?? PCG_MAP["misc"];
      const isRevenue = t.amount_ttc > 0;
      const abs = Math.abs(t.amount_ttc);
      const absHt = Math.abs(t.amount_ht);
      const absVat = Math.abs(t.vat);

      if (isRevenue) {
        const configuredAccount = categoryAccounts.get(t.category);
        const revenueAccount = configuredAccount?.number.startsWith("7") ? configuredAccount : { number: "706000", label: "Prestations de services" };
        return {
          date: t.date,
          label: t.label,
          account_debit: "512000",
          account_credit: revenueAccount.number,
          account_vat: absVat > 0 ? "445710" : undefined,
          amount_ht: parseFloat(absHt.toFixed(2)),
          amount_vat: parseFloat(absVat.toFixed(2)),
          amount_ttc: parseFloat(abs.toFixed(2)),
          category: t.category,
          pcg_label: revenueAccount.label,
          reconciled: t.reconciled ?? false,
          txn_id: t.id,
        };
      } else {
        return {
          date: t.date,
          label: t.label,
          account_debit: pcg.debit,
          account_credit: "512000",
          account_vat: absVat > 0 ? "445660" : undefined,
          amount_ht: parseFloat(absHt.toFixed(2)),
          amount_vat: parseFloat(absVat.toFixed(2)),
          amount_ttc: parseFloat(abs.toFixed(2)),
          category: t.category,
          pcg_label: pcg.label,
          reconciled: t.reconciled ?? false,
          txn_id: t.id,
        };
      }
    }).sort((a, b) => a.date.localeCompare(b.date));

    const totalDebit  = entries.reduce((s, e) => s + e.amount_ttc, 0);
    const totalCredit = totalDebit; // journal équilibré
    const years = [...new Set(all.map((t) => t.date.slice(0, 4)))].sort().reverse();

    return reply.send({ entries, totalDebit, totalCredit, years });
  });
}
