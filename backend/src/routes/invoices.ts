import { FastifyInstance } from "fastify";
import { loadOutgoingInvoices, saveOutgoingInvoices } from "../services/invoiceService.js";
import { loadCompanyProfile } from "../services/settingsService.js";
import { OutgoingInvoice } from "../types/index.js";
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

// ── Helpers PDF ───────────────────────────────────────────────────────────────

const MARGIN = 50;
const PAGE_W = 595;  // A4 width in points
const PAGE_H = 842;  // A4 height in points
const COL_GREY = rgb(0.96, 0.96, 0.97);
const COL_ACCENT = rgb(0.11, 0.47, 0.82);
const COL_TEXT = rgb(0.12, 0.12, 0.14);
const COL_MUTED = rgb(0.5, 0.5, 0.52);

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  color = COL_TEXT,
) {
  page.drawText(String(text ?? "").replace(/[\u202f\u00a0]/g," "), { x, y, font, size, color });
}

export async function generateInvoicePdf(inv: OutgoingInvoice, title = "FACTURE"): Promise<Uint8Array> {
  const profile = loadCompanyProfile();
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);

  const fontReg  = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  // ── Bande accent supérieure ──────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: COL_ACCENT });

  // ── En-tête : nom de l'entreprise (gauche) ───────────────────────────────
  drawText(page, profile.name || "Mon entreprise", MARGIN, y - 18, fontBold, 20, COL_ACCENT);

  if (profile.legalForm || profile.siren) {
    drawText(page, [profile.legalForm, profile.siren ? `SIREN ${profile.siren}` : ""].filter(Boolean).join(" · "), MARGIN, y - 36, fontReg, 8, COL_MUTED);
  }
  if (profile.vatNumber) {
    drawText(page, `TVA intracommunautaire : ${profile.vatNumber}`, MARGIN, y - 48, fontReg, 8, COL_MUTED);
  }
  if (profile.address) {
    drawText(page, profile.address, MARGIN, y - 60, fontReg, 8, COL_MUTED);
    if (profile.postalCode || profile.city) {
      drawText(page, [profile.postalCode, profile.city].filter(Boolean).join(" "), MARGIN, y - 72, fontReg, 8, COL_MUTED);
    }
  }

  // ── En-tête : numéro de facture (droite) ─────────────────────────────────
  drawText(page, title, PAGE_W - MARGIN - 120, y - 18, fontBold, 22, COL_ACCENT);
  drawText(page, inv.number, PAGE_W - MARGIN - 120, y - 38, fontBold, 13, COL_TEXT);
  drawText(page, `Date : ${inv.date}`, PAGE_W - MARGIN - 120, y - 54, fontReg, 9, COL_MUTED);
  if (inv.dueDate) {
    drawText(page, `Échéance : ${inv.dueDate}`, PAGE_W - MARGIN - 120, y - 66, fontReg, 9, COL_MUTED);
  }

  // ── Ligne de séparation ──────────────────────────────────────────────────
  y -= 95;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: COL_MUTED });

  // ── Client ───────────────────────────────────────────────────────────────
  y -= 20;
  drawText(page, title === "DEVIS" ? "DESTINATAIRE" : "FACTURER À", MARGIN, y, fontBold, 8, COL_MUTED);
  drawText(page, inv.client, MARGIN, y - 16, fontBold, 12, COL_TEXT);

  // ── Tableau ───────────────────────────────────────────────────────────────
  y -= 60;
  const colDesc = MARGIN;
  const colHt   = PAGE_W - MARGIN - 220;
  const colTva  = PAGE_W - MARGIN - 130;
  const colTtc  = PAGE_W - MARGIN - 60;

  // En-tête tableau
  page.drawRectangle({ x: MARGIN, y: y - 4, width: PAGE_W - 2 * MARGIN, height: 20, color: COL_ACCENT });
  drawText(page, "Description",    colDesc + 4, y + 8, fontBold, 9, rgb(1,1,1));
  drawText(page, "H.T.",           colHt,       y + 8, fontBold, 9, rgb(1,1,1));
  drawText(page, "TVA",            colTva,      y + 8, fontBold, 9, rgb(1,1,1));
  drawText(page, "T.T.C.",         colTtc,      y + 8, fontBold, 9, rgb(1,1,1));

  // Ligne description
  y -= 20;
  page.drawRectangle({ x: MARGIN, y: y - 8, width: PAGE_W - 2 * MARGIN, height: 24, color: COL_GREY });
  // Wrapping basique : tronquer à 60 chars
  const desc = (inv.description ?? "").slice(0, 80);
  drawText(page, desc, colDesc + 4, y + 8, fontReg, 9);

  const vatAmount = inv.amount_ht * (inv.vat_rate / 100);
  drawText(page, fmt(inv.amount_ht),  colHt,  y + 8, fontReg, 9);
  drawText(page, `${inv.vat_rate} %`, colTva, y + 8, fontReg, 9);
  drawText(page, fmt(inv.amount_ttc), colTtc, y + 8, fontBold, 9);

  // ── Totaux ────────────────────────────────────────────────────────────────
  y -= 50;
  const totX = PAGE_W - MARGIN - 200;
  const totW = 200;

  page.drawLine({ start: { x: totX, y: y + 16 }, end: { x: PAGE_W - MARGIN, y: y + 16 }, thickness: 0.5, color: COL_MUTED });
  drawText(page, "Sous-total H.T.",        totX,          y, fontReg, 9, COL_MUTED);
  drawText(page, fmt(inv.amount_ht),       totX + 120, y, fontReg, 9);
  drawText(page, `TVA (${inv.vat_rate}%)`, totX,          y - 16, fontReg, 9, COL_MUTED);
  drawText(page, fmt(vatAmount),           totX + 120, y - 16, fontReg, 9);

  // Total TTC mis en valeur
  page.drawRectangle({ x: totX - 4, y: y - 40, width: totW + 4, height: 22, color: COL_ACCENT });
  drawText(page, "TOTAL T.T.C.",   totX + 2,   y - 30, fontBold, 10, rgb(1,1,1));
  drawText(page, fmt(inv.amount_ttc), totX + 120, y - 30, fontBold, 10, rgb(1,1,1));

  // ── Notes ─────────────────────────────────────────────────────────────────
  if (inv.notes) {
    y -= 80;
    drawText(page, "Notes", MARGIN, y, fontBold, 9, COL_MUTED);
    drawText(page, inv.notes.slice(0, 120), MARGIN, y - 14, fontReg, 8, COL_MUTED);
  }

  // ── Pied de page ─────────────────────────────────────────────────────────
  page.drawLine({ start: { x: MARGIN, y: 60 }, end: { x: PAGE_W - MARGIN, y: 60 }, thickness: 0.5, color: COL_MUTED });
  const footer = [
    profile.email,
    profile.phone,
    profile.iban ? `IBAN : ${profile.iban}` : null,
    profile.rcs ? `RCS ${profile.rcs}` : null,
  ].filter(Boolean).join("   ·   ");
  if (footer) drawText(page, footer, MARGIN, 45, fontReg, 7, COL_MUTED);

  // Bande accent inférieure
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 8, color: COL_ACCENT });

  return doc.save();
}

export async function invoicesRoutes(app: FastifyInstance) {
  app.get("/", async (_req, reply) => {
    return reply.send(loadOutgoingInvoices());
  });

  app.post<{ Body: OutgoingInvoice }>("/", async (req, reply) => {
    const invoices = loadOutgoingInvoices();
    invoices.push(req.body);
    saveOutgoingInvoices(invoices);
    return reply.status(201).send(req.body);
  });

  app.put<{ Params: { id: string }; Body: OutgoingInvoice }>("/:id", async (req, reply) => {
    const invoices = loadOutgoingInvoices().map((inv) =>
      inv.id === req.params.id ? req.body : inv
    );
    saveOutgoingInvoices(invoices);
    return reply.send(req.body);
  });

  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const invoices = loadOutgoingInvoices().filter((inv) => inv.id !== req.params.id);
    saveOutgoingInvoices(invoices);
    return reply.status(204).send();
  });

  /** GET /api/invoices/:id/pdf — Génère et retourne la facture en PDF */
  app.get<{ Params: { id: string } }>("/:id/pdf", async (req, reply) => {
    const inv = loadOutgoingInvoices().find((i) => i.id === req.params.id);
    if (!inv) return reply.status(404).send({ error: "Facture introuvable" });

    const pdfBytes = await generateInvoicePdf(inv);
    const filename = `facture-${inv.number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;

    return reply
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(Buffer.from(pdfBytes));
  });
}
