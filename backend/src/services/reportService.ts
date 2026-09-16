import { loadAllTransactions } from "./transactionService.js";
import { Transaction, Category } from "../types/index.js";
import { writeFile } from "./fileSystem.js";
import { format } from "../utils/date.js";
import { transactionAccountingNature } from "./categoryCatalogService.js";

export type ReportType = "monthly" | "vat" | "activity";

export interface ReportOptions {
  type: ReportType;
  /** YYYY-MM pour monthly, YYYY-QN pour vat (ex: 2026-Q2), YYYY pour activity */
  period: string;
}

const natureOf = (transaction: Transaction) => transactionAccountingNature(transaction.category, transaction.amount_ttc, transaction.accountingTreatment);
const expenseTotal = (transactions: Transaction[], field: "amount_ttc" | "amount_ht") => transactions.reduce((sum, transaction) => natureOf(transaction) === "expense" ? sum + Math.abs(transaction[field]) : natureOf(transaction) === "expense_refund" ? sum - Math.abs(transaction[field]) : sum, 0);
const revenueTotal = (transactions: Transaction[], field: "amount_ttc" | "amount_ht") => transactions.filter((transaction) => natureOf(transaction) === "revenue").reduce((sum, transaction) => sum + transaction[field], 0);
const deductibleVat = (transactions: Transaction[]) => transactions.reduce((sum, transaction) => natureOf(transaction) === "expense" ? sum + Math.abs(transaction.vat) : natureOf(transaction) === "expense_refund" ? sum - Math.abs(transaction.vat) : sum, 0);

/** Génère un rapport Markdown, le sauvegarde et retourne son contenu + chemin. */
export async function generateReport(options: ReportOptions): Promise<{ content: string; filePath: string }> {
  // Une transaction rejetée représente notamment un doublon explicitement ignoré.
  // Elle reste conservée dans l'historique, mais ne doit jamais alimenter un rapport comptable.
  const transactions = (await loadAllTransactions()).filter((transaction) => transaction.status !== "rejected");

  let content: string;
  let filePath: string;

  switch (options.type) {
    case "monthly":
      ({ content, filePath } = buildMonthlyReport(transactions, options.period));
      break;
    case "vat":
      ({ content, filePath } = buildVatReport(transactions, options.period));
      break;
    case "activity":
      ({ content, filePath } = buildActivityReport(transactions, options.period));
      break;
  }

  await writeFile(filePath, content);
  return { content, filePath };
}

// ── Monthly ───────────────────────────────────────────────────────────────────

function buildMonthlyReport(
  all: Transaction[],
  month: string // YYYY-MM
): { content: string; filePath: string } {
  const txns = all.filter((t) => t.date.startsWith(month));
  const revenue = txns.filter((t) => natureOf(t) === "revenue");
  const expenses = txns.filter((t) => natureOf(t) === "expense");
  const expenseRefunds = txns.filter((t) => natureOf(t) === "expense_refund");
  const totalRev = revenueTotal(txns, "amount_ttc");
  const totalExp = expenseTotal(txns, "amount_ttc");
  const balance = totalRev - totalExp;

  const lines: string[] = [
    `# Rapport mensuel — ${month}`,
    "",
    `> Généré le ${format(new Date())}`,
    "",
    "## Résumé",
    "",
    `| | Montant |`,
    `|---|---|`,
    `| Revenus | **${totalRev.toFixed(2)} €** |`,
    `| Dépenses | **${totalExp.toFixed(2)} €** |`,
    `| Balance | **${balance >= 0 ? "+" : ""}${balance.toFixed(2)} €** |`,
    "",
  ];

  if (revenue.length > 0) {
    lines.push("## Revenus", "");
    lines.push("| Date | Libellé | Montant TTC | Catégorie |");
    lines.push("|---|---|---|---|");
    for (const t of revenue) {
      lines.push(`| ${t.date} | ${t.label} | +${t.amount_ttc.toFixed(2)} € | ${t.category} |`);
    }
    lines.push("");
  }

  if (expenses.length > 0) {
    lines.push("## Dépenses", "");
    lines.push("| Date | Libellé | Montant TTC | Catégorie |");
    lines.push("|---|---|---|---|");
    for (const t of expenses) {
      lines.push(`| ${t.date} | ${t.label} | ${t.amount_ttc.toFixed(2)} € | ${t.category} |`);
    }
    lines.push("");
  }

  if (expenseRefunds.length > 0) {
    lines.push("## Avoirs et remboursements fournisseurs", "");
    lines.push("| Date | Libellé | Montant TTC | Charge diminuée |");
    lines.push("|---|---|---|---|");
    for (const t of expenseRefunds) lines.push(`| ${t.date} | ${t.label} | +${t.amount_ttc.toFixed(2)} € | ${t.category} |`);
    lines.push("");
  }

  if (txns.length === 0) lines.push("_Aucune transaction ce mois-ci._", "");

  return {
    content: lines.join("\n"),
    filePath: `reports/mensuel_${month}.md`,
  };
}

// ── VAT ───────────────────────────────────────────────────────────────────────

function buildVatReport(
  all: Transaction[],
  period: string // YYYY-QN ou YYYY (année complète)
): { content: string; filePath: string } {
  // Détecte si c'est une année complète (ex: "2026") ou un trimestre (ex: "2026-Q2")
  const isFullYear = /^\d{4}$/.test(period.trim());

  let months: string[];
  let title: string;

  if (isFullYear) {
    const year = period.trim();
    months = Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, "0")}`
    );
    title = `Année ${year}`;
  } else {
    const [year, qStr] = period.split("-");
    const q = parseInt(qStr?.replace("Q", "") ?? "1");
    const monthStart = (q - 1) * 3 + 1;
    months = [monthStart, monthStart + 1, monthStart + 2].map(
      (m) => `${year}-${String(m).padStart(2, "0")}`
    );
    title = period;
  }

  const txns = all.filter((t) => months.some((m) => t.date.startsWith(m)));
  const vatCollected = txns.filter((t) => natureOf(t) === "revenue").reduce((s, t) => s + t.vat, 0);
  const vatDeductible = deductibleVat(txns);
  const vatDue = vatCollected - vatDeductible;

  const lines: string[] = [
    `# Rapport TVA — ${title}`,
    "",
    `> Généré le ${format(new Date())} — **Estimation non officielle**`,
    "",
    "## Synthèse TVA",
    "",
    `| | Montant |`,
    `|---|---|`,
    `| TVA collectée (ventes) | ${vatCollected.toFixed(2)} € |`,
    `| TVA déductible (achats) | ${vatDeductible.toFixed(2)} € |`,
    `| **TVA nette à reverser** | **${vatDue.toFixed(2)} €** |`,
    "",
    "> ⚠️ Ces chiffres sont des estimations. Consultez un expert-comptable pour la déclaration officielle.",
    "",
    "## Détail par mois",
    "",
  ];

  for (const m of months) {
    const mt = txns.filter((t) => t.date.startsWith(m));
    const mc = mt.filter((t) => natureOf(t) === "revenue").reduce((s, t) => s + t.vat, 0);
    const md = deductibleVat(mt);
    lines.push(`### ${m}`);
    lines.push(`- TVA collectée : ${mc.toFixed(2)} €`);
    lines.push(`- TVA déductible : ${md.toFixed(2)} €`);
    lines.push(`- Net : ${(mc - md).toFixed(2)} €`);
    lines.push("");
  }

  return {
    content: lines.join("\n"),
    filePath: `reports/tva_${period}.md`,
  };
}

// ── Activity ──────────────────────────────────────────────────────────────────

function buildActivityReport(
  all: Transaction[],
  year: string // YYYY
): { content: string; filePath: string } {
  const txns = all.filter((t) => t.date.startsWith(year));
  const byCategory: Partial<Record<Category, number>> = {};

  for (const t of txns) {
    if (natureOf(t) === "expense") {
      byCategory[t.category] = (byCategory[t.category] ?? 0) + Math.abs(t.amount_ttc);
    } else if (natureOf(t) === "expense_refund") {
      byCategory[t.category] = (byCategory[t.category] ?? 0) - t.amount_ttc;
    }
  }

  const totalRev = revenueTotal(txns, "amount_ttc");
  const totalExp = expenseTotal(txns, "amount_ttc");

  // IS estimé (IS PME France) sur résultat HT
  const totalRevHt = revenueTotal(txns, "amount_ht");
  const totalExpHt = expenseTotal(txns, "amount_ht");
  const resultHt = totalRevHt - totalExpHt;
  const is =
    resultHt <= 0
      ? 0
      : resultHt <= 42500
      ? resultHt * 0.15
      : 42500 * 0.15 + (resultHt - 42500) * 0.25;
  const isAcompte = is / 4;

  const lines: string[] = [
    `# Récapitulatif d'activité — ${year}`,
    "",
    `> Généré le ${format(new Date())}`,
    "",
    "## Vue d'ensemble",
    "",
    `| | Montant |`,
    `|---|---|`,
    `| Revenus totaux | **${totalRev.toFixed(2)} €** |`,
    `| Dépenses totales | **${totalExp.toFixed(2)} €** |`,
    `| Balance | **${(totalRev - totalExp).toFixed(2)} €** |`,
    `| Transactions | ${txns.length} |`,
    "",
    "## Répartition des dépenses par catégorie",
    "",
    "| Catégorie | Montant | % |",
    "|---|---|---|",
  ];

  const sorted = Object.entries(byCategory).filter((entry): entry is [string, number] => typeof entry[1] === "number").sort((a, b) => b[1] - a[1]);
  for (const [cat, amount] of sorted) {
    const pct = totalExp > 0 ? ((amount / totalExp) * 100).toFixed(1) : "0.0";
    lines.push(`| ${cat} | ${amount.toFixed(2)} € | ${pct}% |`);
  }

  lines.push("");

  lines.push("## IS estimé", "");
  lines.push(`| | Montant |`);
  lines.push(`|---|---|`);
  lines.push(`| Résultat fiscal HT | ${resultHt.toFixed(2)} € |`);
  lines.push(`| Taux appliqué | ${resultHt <= 42500 ? "15 %" : "15 % → 25 %"} |`);
  lines.push(`| **IS estimé** | **${is.toFixed(2)} €** |`);
  lines.push(`| Acompte trimestriel indicatif | ${isAcompte.toFixed(2)} € |`);
  lines.push("");
  lines.push("> ⚠️ Estimation indicative. Tranche à 15 % jusqu'à 42 500 € de bénéfice (IS PME). Consultez un expert-comptable.", "");

  return {
    content: lines.join("\n"),
    filePath: `reports/activite_${year}.md`,
  };
}
