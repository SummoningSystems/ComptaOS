import { FastifyInstance } from "fastify";
import { generateReport, ReportType } from "../services/reportService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { loadCompanyProfile } from "../services/settingsService.js";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

// ── Helpers PDF partagés ──────────────────────────────────────────────────────
const MARGIN = 50;
const PAGE_W = 595;
const PAGE_H = 842;
const COL_ACCENT = rgb(0.11, 0.47, 0.82);
const COL_TEXT   = rgb(0.12, 0.12, 0.14);
const COL_MUTED  = rgb(0.5, 0.5, 0.52);
const COL_GREY   = rgb(0.96, 0.96, 0.97);
const COL_GREEN  = rgb(0.07, 0.53, 0.29);
const COL_RED    = rgb(0.72, 0.12, 0.12);

function dt(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = COL_TEXT) {
  page.drawText(String(text ?? ""), { x, y, font, size, color });
}
function fmtEur(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function pdfHeader(page: PDFPage, title: string, subtitle: string, fontBold: PDFFont, fontReg: PDFFont) {
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: COL_ACCENT });
  dt(page, title, MARGIN, PAGE_H - MARGIN, fontBold, 18, COL_ACCENT);
  dt(page, subtitle, MARGIN, PAGE_H - MARGIN - 22, fontReg, 10, COL_MUTED);
  page.drawLine({ start: { x: MARGIN, y: PAGE_H - MARGIN - 36 }, end: { x: PAGE_W - MARGIN, y: PAGE_H - MARGIN - 36 }, thickness: 0.5, color: COL_MUTED });
}

export async function reportsRoutes(app: FastifyInstance) {
  type VatTransactionDetail = {
    id: string;
    date: string;
    label: string;
    category: string;
    amount_ttc: number;
    amount_ht: number;
    vat: number;
    vat_rate: number;
    direction: "collected" | "deductible";
    quarter: string;
  };

  /**
   * POST /api/reports/generate
   */
  app.post<{ Body: { type: ReportType; period: string } }>("/generate", async (req, reply) => {
    const { type, period } = req.body;
    if (!type || !period) return reply.status(400).send({ error: "type et period requis" });
    const validTypes: ReportType[] = ["monthly", "vat", "activity"];
    if (!validTypes.includes(type)) return reply.status(400).send({ error: `type invalide` });
    const { content, filePath } = await generateReport({ type, period });
    return reply.send({ content, filePath });
  });

  /**
   * GET /api/reports/vat-summary?year=2025
   * Retourne la TVA collectée, déductible et à reverser par trimestre.
   */
  app.get<{ Querystring: { year?: string } }>("/vat-summary", async (req, reply) => {
    const year = req.query.year ?? String(new Date().getFullYear());
    const all = await loadAllTransactions();
    const txns = all.filter(
      (t) => t.date.startsWith(year) && t.status !== "rejected"
    );

    // Calcul par trimestre
    const quarters = [
      { label: "T1", months: ["01", "02", "03"] },
      { label: "T2", months: ["04", "05", "06"] },
      { label: "T3", months: ["07", "08", "09"] },
      { label: "T4", months: ["10", "11", "12"] },
    ];

    const rows = quarters.map(({ label, months }) => {
      const qt = txns.filter((t) => months.includes(t.date.slice(5, 7)));
      const collected = qt
        .filter((t) => t.amount_ttc > 0)
        .reduce((s, t) => s + t.vat, 0);
      const deductible = qt
        .filter((t) => t.amount_ttc < 0)
        .reduce((s, t) => s + Math.abs(t.vat), 0);
      return {
        quarter: label,
        collected: parseFloat(collected.toFixed(2)),
        deductible: parseFloat(deductible.toFixed(2)),
        net: parseFloat((collected - deductible).toFixed(2)),
        revenue: parseFloat(qt.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0).toFixed(2)),
        expenses: parseFloat(qt.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.amount_ttc), 0).toFixed(2)),
      };
    });

    const details: VatTransactionDetail[] = txns
      .filter((t) => Math.abs(t.vat) > 0.0001)
      .map((t) => {
        const month = t.date.slice(5, 7);
        const quarter = quarters.find((q) => q.months.includes(month))?.label ?? "T1";
        const direction: "collected" | "deductible" = t.amount_ttc >= 0 ? "collected" : "deductible";
        const inferredVatRate = typeof t.vat_rate === "number"
          ? t.vat_rate
          : Math.abs(t.amount_ht) > 0
            ? parseFloat(((Math.abs(t.vat) / Math.abs(t.amount_ht)) * 100).toFixed(2))
            : 0;

        return {
          id: t.id,
          date: t.date,
          label: t.label,
          category: t.category,
          amount_ttc: parseFloat(t.amount_ttc.toFixed(2)),
          amount_ht: parseFloat(t.amount_ht.toFixed(2)),
          vat: parseFloat(t.vat.toFixed(2)),
          vat_rate: inferredVatRate,
          vat_splits: t.vat_splits ?? [],
          direction,
          quarter,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const totalCollected = rows.reduce((s, r) => s + r.collected, 0);
    const totalDeductible = rows.reduce((s, r) => s + r.deductible, 0);

    return reply.send({
      year,
      quarters: rows,
      total: {
        collected: parseFloat(totalCollected.toFixed(2)),
        deductible: parseFloat(totalDeductible.toFixed(2)),
        net: parseFloat((totalCollected - totalDeductible).toFixed(2)),
      },
      details,
    });
  });

  /**
   * GET /api/reports/pnl?year=2025
   * Retourne le compte de résultat structuré (PCG), avec SIG.
   */
  app.get<{ Querystring: { year?: string } }>("/pnl", async (req, reply) => {
    const year = req.query.year ?? String(new Date().getFullYear());
    const all = await loadAllTransactions();
    const txns = all.filter((t) => t.date.startsWith(year) && t.status !== "rejected");

    const CHARGES_PCG: Record<string, [string, string]> = {
      hosting:      ["616200", "Hébergement web"],
      software:     ["615600", "Logiciels"],
      salary:       ["641100", "Salaires bruts"],
      subcontracting: ["611000", "Sous-traitance générale"],
      professional_fees: ["622600", "Honoraires"],
      external_services: ["628000", "Autres services extérieurs"],
      travel:       ["625100", "Voyages et déplacements"],
      restaurant:   ["625700", "Réceptions"],
      food:         ["606000", "Achats divers"],
      taxes:        ["447900", "Impôts et taxes"],
      equipment:    ["218300", "Matériel informatique"],
      subscription: ["622600", "Abonnements"],
      rent:         ["613200", "Loyers"],
      legal:        ["622200", "Honoraires"],
      insurance:    ["616000", "Assurances"],
      misc:         ["628800", "Charges diverses"],
    };

    const chargesMap: Record<string, { account: string; label: string; amount: number; count: number }> = {};
    let totalRevHT = 0;
    let revenueCount = 0;

    for (const t of txns) {
      if (t.amount_ht < 0) {
        const [account, label] = CHARGES_PCG[t.category] ?? ["628800", "Charges diverses"];
        if (!chargesMap[account]) chargesMap[account] = { account, label, amount: 0, count: 0 };
        chargesMap[account].amount += Math.abs(t.amount_ht);
        chargesMap[account].count++;
      } else if (t.amount_ht > 0) {
        totalRevHT += t.amount_ht;
        revenueCount++;
      }
    }

    const charges = Object.values(chargesMap).sort((a, b) => b.amount - a.amount);
    const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
    const resultatBrut = totalRevHT - totalCharges;
    const isEstimate = resultatBrut > 0 ? resultatBrut * 0.25 : 0;

    return reply.send({
      year,
      produits: [{ account: "706000", label: "Prestations de services / Ventes", amount: parseFloat(totalRevHT.toFixed(2)), count: revenueCount }],
      charges: charges.map((c) => ({ ...c, amount: parseFloat(c.amount.toFixed(2)) })),
      total_produits: parseFloat(totalRevHT.toFixed(2)),
      total_charges: parseFloat(totalCharges.toFixed(2)),
      resultat_brut: parseFloat(resultatBrut.toFixed(2)),
      is_estimate: parseFloat(isEstimate.toFixed(2)),
      resultat_net: parseFloat((resultatBrut - isEstimate).toFixed(2)),
    });
  });

  // ── GET /api/reports/vat-pdf?year=2025&quarter=T2 ─────────────────────────
  app.get<{ Querystring: { year?: string; quarter?: string } }>("/vat-pdf", async (req, reply) => {
    const year    = req.query.year ?? String(new Date().getFullYear());
    const quarter = req.query.quarter ?? "annual";
    const all     = await loadAllTransactions();
    const profile = loadCompanyProfile();

    const quarterDef: Record<string, string[]> = {
      T1: ["01","02","03"], T2: ["04","05","06"],
      T3: ["07","08","09"], T4: ["10","11","12"],
    };

    const txns = all.filter((t) => {
      if (t.status === "rejected" || !t.date.startsWith(year)) return false;
      if (quarter !== "annual") {
        const m = t.date.slice(5, 7);
        return (quarterDef[quarter] ?? []).includes(m);
      }
      return true;
    });

    const collected  = txns.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.vat, 0);
    const deductible = txns.filter((t) => t.amount_ttc < 0).reduce((s, t) => s + Math.abs(t.vat), 0);
    const net        = collected - deductible;
    const revenue    = txns.filter((t) => t.amount_ttc > 0).reduce((s, t) => s + t.amount_ttc, 0);
    const baseHT     = revenue > 0 ? revenue - collected : 0;

    const doc      = await PDFDocument.create();
    const page     = doc.addPage([PAGE_W, PAGE_H]);
    const fontReg  = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    const label    = quarter === "annual" ? `Annuel ${year}` : `${quarter} ${year}`;

    pdfHeader(page, "Déclaration de TVA — CA3", `${profile.name || "Mon entreprise"} · ${label} · Généré le ${new Date().toLocaleDateString("fr-FR")}`, fontBold, fontReg);

    let y = PAGE_H - MARGIN - 60;

    // En-tête entreprise
    dt(page, profile.name || "Mon entreprise", MARGIN, y, fontBold, 11);
    if (profile.vatNumber) dt(page, `N° TVA : ${profile.vatNumber}`, MARGIN, y - 14, fontReg, 9, COL_MUTED);
    if (profile.siren)     dt(page, `SIREN : ${profile.siren}`,       MARGIN, y - 26, fontReg, 9, COL_MUTED);
    y -= 60;

    // Tableau CA3
    const rows = [
      { code: "A",  label: "Base HT — ventes (taux 20%)",     value: baseHT,     bold: false },
      { code: "08", label: "TVA collectée",                    value: collected,  bold: false },
      { code: "20", label: "TVA déductible (achats & frais)",  value: deductible, bold: false },
      { code: "28", label: "Total taxe due (ligne 08)",        value: collected,  bold: false },
      { code: "29", label: "Total taxe déductible (ligne 20)", value: deductible, bold: false },
      { code: "52", label: "TVA à payer (28 − 29)",            value: net,        bold: true  },
    ];

    // En-tête tableau
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - 2 * MARGIN, height: 20, color: COL_ACCENT });
    dt(page, "Code", MARGIN + 4,       y + 8, fontBold, 9, rgb(1,1,1));
    dt(page, "Libellé",MARGIN + 44,    y + 8, fontBold, 9, rgb(1,1,1));
    dt(page, "Montant", PAGE_W - MARGIN - 90, y + 8, fontBold, 9, rgb(1,1,1));
    y -= 24;

    for (const row of rows) {
      const bg = row.bold ? rgb(0.93, 0.96, 1) : (rows.indexOf(row) % 2 === 0 ? COL_GREY : rgb(1,1,1));
      page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - 2 * MARGIN, height: 20, color: bg });
      dt(page, row.code,  MARGIN + 4, y + 6, row.bold ? fontBold : fontReg, 9);
      dt(page, row.label, MARGIN + 44, y + 6, row.bold ? fontBold : fontReg, 9);
      const col = row.code === "52" ? (net >= 0 ? COL_RED : COL_GREEN) : COL_TEXT;
      dt(page, fmtEur(row.value), PAGE_W - MARGIN - 90, y + 6, row.bold ? fontBold : fontReg, 9, col);
      y -= 22;
    }

    y -= 20;
    dt(page, "⚠ Ce document est une simulation. Il ne constitue pas une déclaration officielle.", MARGIN, y, fontReg, 8, COL_MUTED);
    dt(page, `Période : ${label}  ·  ${txns.length} transactions analysées`, MARGIN, y - 14, fontReg, 8, COL_MUTED);

    const pdfBytes = await doc.save();
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="TVA_${year}_${quarter}.pdf"`)
      .send(Buffer.from(pdfBytes));
  });

  // ── GET /api/reports/pl-pdf?year=2025 ─────────────────────────────────────
  app.get<{ Querystring: { year?: string } }>("/pl-pdf", async (req, reply) => {
    const year    = req.query.year ?? String(new Date().getFullYear());
    const all     = await loadAllTransactions();
    const profile = loadCompanyProfile();
    const txns    = all.filter((t) => t.date.startsWith(year) && t.status !== "rejected");

    const CHARGES_PCG: Record<string, [string, string]> = {
      hosting:      ["616200", "Hébergement web"],
      software:     ["615600", "Logiciels"],
      salary:       ["641100", "Salaires bruts"],
      subcontracting: ["611000", "Sous-traitance générale"],
      professional_fees: ["622600", "Honoraires"],
      external_services: ["628000", "Autres services extérieurs"],
      travel:       ["625100", "Voyages et déplacements"],
      restaurant:   ["625700", "Réceptions"],
      food:         ["606000", "Achats divers"],
      taxes:        ["447900", "Impôts et taxes"],
      equipment:    ["218300", "Matériel informatique"],
      subscription: ["622600", "Abonnements"],
      rent:         ["613200", "Loyers"],
      legal:        ["622200", "Honoraires"],
      insurance:    ["616000", "Assurances"],
      misc:         ["628800", "Charges diverses"],
    };

    const chargesMap: Record<string, { account: string; label: string; amount: number }> = {};
    let totalRevHT = 0;
    for (const t of txns) {
      if (t.amount_ht < 0) {
        const [account, label] = CHARGES_PCG[t.category] ?? ["628800", "Charges diverses"];
        if (!chargesMap[account]) chargesMap[account] = { account, label, amount: 0 };
        chargesMap[account].amount += Math.abs(t.amount_ht);
      } else if (t.amount_ht > 0) { totalRevHT += t.amount_ht; }
    }
    const charges      = Object.values(chargesMap).sort((a, b) => b.amount - a.amount);
    const totalCharges = charges.reduce((s, c) => s + c.amount, 0);
    const resultat     = totalRevHT - totalCharges;
    const isEstimate   = resultat > 0 ? resultat * 0.25 : 0;
    const resultatNet  = resultat - isEstimate;

    const doc      = await PDFDocument.create();
    const page     = doc.addPage([PAGE_W, PAGE_H]);
    const fontReg  = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    pdfHeader(page, `Compte de résultat ${year}`, `${profile.name || "Mon entreprise"} · Généré le ${new Date().toLocaleDateString("fr-FR")}`, fontBold, fontReg);
    let y = PAGE_H - MARGIN - 60;

    // En-tête
    dt(page, profile.name || "Mon entreprise", MARGIN, y, fontBold, 11);
    if (profile.siren) dt(page, `SIREN : ${profile.siren}`, MARGIN, y - 14, fontReg, 9, COL_MUTED);
    y -= 50;

    // Section Produits
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - 2 * MARGIN, height: 18, color: COL_ACCENT });
    dt(page, "PRODUITS", MARGIN + 4, y + 6, fontBold, 9, rgb(1,1,1));
    dt(page, "Compte", PAGE_W - MARGIN - 170, y + 6, fontBold, 9, rgb(1,1,1));
    dt(page, "Montant HT", PAGE_W - MARGIN - 80, y + 6, fontBold, 9, rgb(1,1,1));
    y -= 22;
    page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - 2 * MARGIN, height: 20, color: COL_GREY });
    dt(page, "Prestations de services / Ventes", MARGIN + 4, y + 6, fontReg, 9);
    dt(page, "706000", PAGE_W - MARGIN - 170, y + 6, fontReg, 9, COL_MUTED);
    dt(page, fmtEur(totalRevHT), PAGE_W - MARGIN - 80, y + 6, fontReg, 9, COL_GREEN);
    y -= 26;
    dt(page, "Total produits", MARGIN + 4, y + 6, fontBold, 9);
    dt(page, fmtEur(totalRevHT), PAGE_W - MARGIN - 80, y + 6, fontBold, 9, COL_GREEN);
    y -= 30;

    // Section Charges
    page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - 2 * MARGIN, height: 18, color: rgb(0.3, 0.3, 0.35) });
    dt(page, "CHARGES", MARGIN + 4, y + 6, fontBold, 9, rgb(1,1,1));
    dt(page, "Compte", PAGE_W - MARGIN - 170, y + 6, fontBold, 9, rgb(1,1,1));
    dt(page, "Montant HT", PAGE_W - MARGIN - 80, y + 6, fontBold, 9, rgb(1,1,1));
    y -= 22;

    for (let i = 0; i < charges.length && y > 120; i++) {
      const c = charges[i];
      const bg = i % 2 === 0 ? COL_GREY : rgb(1,1,1);
      page.drawRectangle({ x: MARGIN, y: y - 6, width: PAGE_W - 2 * MARGIN, height: 20, color: bg });
      dt(page, c.label, MARGIN + 4, y + 6, fontReg, 9);
      dt(page, c.account, PAGE_W - MARGIN - 170, y + 6, fontReg, 9, COL_MUTED);
      dt(page, fmtEur(c.amount), PAGE_W - MARGIN - 80, y + 6, fontReg, 9, COL_RED);
      y -= 22;
    }
    y -= 8;
    dt(page, "Total charges", MARGIN + 4, y + 6, fontBold, 9);
    dt(page, fmtEur(totalCharges), PAGE_W - MARGIN - 80, y + 6, fontBold, 9, COL_RED);
    y -= 30;

    // Résultat
    page.drawRectangle({ x: MARGIN, y: y - 8, width: PAGE_W - 2 * MARGIN, height: 56, color: rgb(0.93, 0.96, 1) });
    dt(page, "Résultat brut (avant IS estimé)", MARGIN + 4, y + 34, fontReg, 9);
    dt(page, fmtEur(resultat), PAGE_W - MARGIN - 80, y + 34, fontReg, 9, resultat >= 0 ? COL_GREEN : COL_RED);
    dt(page, "IS estimé (25%)", MARGIN + 4, y + 18, fontReg, 9, COL_MUTED);
    dt(page, fmtEur(isEstimate), PAGE_W - MARGIN - 80, y + 18, fontReg, 9, COL_MUTED);
    dt(page, `RÉSULTAT NET ${year}`, MARGIN + 4, y + 2, fontBold, 10);
    dt(page, fmtEur(resultatNet), PAGE_W - MARGIN - 80, y + 2, fontBold, 10, resultatNet >= 0 ? COL_GREEN : COL_RED);

    dt(page, "⚠ Document non certifié — estimation à titre indicatif.", MARGIN, 30, fontReg, 8, COL_MUTED);

    const pdfBytes = await doc.save();
    reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="Bilan_${year}.pdf"`)
      .send(Buffer.from(pdfBytes));
  });
}

