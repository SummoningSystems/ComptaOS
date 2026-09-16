import { FastifyInstance } from "fastify";
import * as XLSX from "xlsx";
import { loadAllTransactions } from "../services/transactionService.js";
import { transactionAccountingNature } from "../services/categoryCatalogService.js";

interface ExportQuery {
  year?: string;
  month?: string;
  format?: "xlsx" | "csv";
}

export async function exportRoutes(app: FastifyInstance) {
  /**
   * GET /api/export/xlsx?year=2025
   * Génère un classeur Excel avec 3 feuilles :
   *   1. Grand Livre — toutes les transactions ligne par ligne
   *   2. Balance — totaux par catégorie (débit / crédit / net)
   *   3. TVA — TVA collectée / déductible / à reverser par trimestre
   */
  app.get<{ Querystring: ExportQuery }>("/xlsx", async (req, reply) => {
    const year = req.query.year ?? String(new Date().getFullYear());
    const month = req.query.month; // optionnel — filtre sur un mois

    const all = await loadAllTransactions();
    const txns = all.filter((t) => {
      if (!t.date.startsWith(year)) return false;
      if (month && t.date.slice(5, 7) !== month.padStart(2, "0")) return false;
      if (t.status === "rejected") return false;
      return true;
    });

    const wb = XLSX.utils.book_new();

    // ── Feuille 1 : Grand Livre ─────────────────────────────────────────────
    const grandLivreRows = [
      ["Date", "Libellé", "Catégorie", "Compte", "Statut", "HT (€)", "TVA (€)", "TTC (€)", "Justifié", "Référence"],
      ...txns.map((t) => [
        t.date,
        t.label,
        t.category,
        t.account ?? "main",
        t.status,
        t.amount_ht,
        t.vat,
        t.amount_ttc,
        t.justified ? "Oui" : t.justified === false ? "Non" : "",
        t.invoiceRef ?? "",
      ]),
    ];
    const wsGL = XLSX.utils.aoa_to_sheet(grandLivreRows);
    // Largeurs des colonnes
    wsGL["!cols"] = [
      { wch: 12 }, { wch: 40 }, { wch: 16 }, { wch: 14 }, { wch: 12 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsGL, "Grand Livre");

    // ── Feuille 2 : Balance par catégorie ───────────────────────────────────
    const catMap = new Map<string, { debit: number; credit: number }>();
    for (const t of txns) {
      const cat = t.category ?? "misc";
      if (!catMap.has(cat)) catMap.set(cat, { debit: 0, credit: 0 });
      const entry = catMap.get(cat)!;
      if (t.amount_ht < 0) entry.debit += Math.abs(t.amount_ht);
      else entry.credit += t.amount_ht;
    }
    const balanceRows = [
      ["Catégorie", "Charges HT (€)", "Produits HT (€)", "Solde HT (€)"],
      ...[...catMap.entries()].map(([cat, { debit, credit }]) => [
        cat,
        parseFloat(debit.toFixed(2)),
        parseFloat(credit.toFixed(2)),
        parseFloat((credit - debit).toFixed(2)),
      ]),
    ];
    const wsBalance = XLSX.utils.aoa_to_sheet(balanceRows);
    wsBalance["!cols"] = [{ wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsBalance, "Balance");

    // ── Feuille 3 : TVA par trimestre ───────────────────────────────────────
    const quarters = [
      { label: "T1", months: ["01", "02", "03"] },
      { label: "T2", months: ["04", "05", "06"] },
      { label: "T3", months: ["07", "08", "09"] },
      { label: "T4", months: ["10", "11", "12"] },
    ];
    const vatRows = [
      ["Trimestre", "TVA Collectée (€)", "TVA Déductible (€)", "TVA Nette à Reverser (€)"],
      ...quarters.map(({ label, months }) => {
        const qt = txns.filter((t) => months.includes(t.date.slice(5, 7)));
        const collected = parseFloat(qt.filter((t) => transactionAccountingNature(t.category, t.amount_ttc, t.accountingTreatment) === "revenue").reduce((s, t) => s + t.vat, 0).toFixed(2));
        const deductible = parseFloat(qt.reduce((s, t) => {
          const nature = transactionAccountingNature(t.category, t.amount_ttc, t.accountingTreatment);
          return nature === "expense" ? s + Math.abs(t.vat) : nature === "expense_refund" ? s - Math.abs(t.vat) : s;
        }, 0).toFixed(2));
        return [label, collected, deductible, parseFloat((collected - deductible).toFixed(2))];
      }),
    ];
    const wsVat = XLSX.utils.aoa_to_sheet(vatRows);
    wsVat["!cols"] = [{ wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, wsVat, "TVA");

    // ── Envoi ───────────────────────────────────────────────────────────────
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = month
      ? `compta_${year}_${month.padStart(2, "0")}.xlsx`
      : `compta_${year}.xlsx`;

    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(buffer);
  });

  /**
   * GET /api/export/csv?year=2025&month=05
   * Exporte le grand livre en CSV UTF-8 avec BOM (compatible Excel FR).
   */
  app.get<{ Querystring: ExportQuery }>("/csv", async (req, reply) => {
    const year = req.query.year ?? String(new Date().getFullYear());
    const month = req.query.month;

    const all = await loadAllTransactions();
    const txns = all.filter((t) => {
      if (!t.date.startsWith(year)) return false;
      if (month && t.date.slice(5, 7) !== month.padStart(2, "0")) return false;
      if (t.status === "rejected") return false;
      return true;
    });

    const headers = ["Date", "Libellé", "Catégorie", "Compte", "Statut", "HT", "TVA", "TTC", "Justifié", "Référence"];
    const rows = txns.map((t) =>
      [
        t.date, t.label, t.category, t.account ?? "main", t.status,
        t.amount_ht, t.vat, t.amount_ttc,
        t.justified ? "Oui" : t.justified === false ? "Non" : "",
        t.invoiceRef ?? "",
      ].map(String).map((v) => `"${v.replace(/"/g, '""')}"`).join(";")
    );

    // BOM UTF-8 pour compatibilité Excel FR
    const csv = "\uFEFF" + [headers.map((h) => `"${h}"`).join(";"), ...rows].join("\r\n");

    const filename = month
      ? `compta_${year}_${month.padStart(2, "0")}.csv`
      : `compta_${year}.csv`;

    reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(csv);
  });
}
