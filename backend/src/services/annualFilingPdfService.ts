import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

type Row = { code: string; value: number };
type Owner = { kind: "person" | "entity"; name: string; ownershipPercent: number | null; shareCount: number | null; address: string; birthDate: string; birthPlace: string; legalForm: string; siren: string };
type Subsidiary = { name: string; ownershipPercent: number | null; address: string; postalCode: string; city: string; country: string; legalForm: string; siren: string };

export interface AnnualFilingPdfInput {
  period: { startDate: string; endDate: string };
  package: {
    identity: { name: string; address: string; siret: string; siren: string; email: string; activity: string };
    form2065: { taxableAt15: number; taxableAt25: number; deficit: number; accountingSoftware: string; signatory: { name: string; role: string; city: string; date: string } };
    form2033C: { fixedAssets: Array<{ code: string; openingGross: number; increases: number; decreases: number; closingGross: number; openingDepreciation: number; depreciationCharge: number; depreciationDecrease: number; closingDepreciation: number }>; capitalGains: { saleProceeds: number; netBookValueDisposed: number; netGain: number } };
    form2033D: { provisions: Array<{ label: string; amount: number }>; lossCarryforwards: number; vatCollected?: number; vatDeductible?: number };
    form2033E: { turnover: number; production: number; externalConsumption: number; valueAdded: number; taxes: number; averageEmployees: number | null };
    form2033F: { owners: Owner[]; totalShares: number };
    form2033G: { subsidiaries: Subsidiary[] };
  };
  statements: {
    balanceSheet: { assets: Row[]; liabilities: Row[]; fixedAssetsTotal: number; currentAssetsTotal: number; totalAssets: number; equityTotal: number; debtsTotal: number; totalLiabilities: number };
    profitAndLoss: { fields: Row[] };
    fiscalTable: { fields: Row[] };
  };
}

const template = (name: string) => {
  const candidates = [join(process.cwd(), "assets", "tax-forms", name), join(process.cwd(), "backend", "assets", "tax-forms", name)];
  const found = candidates.find(existsSync); if (!found) throw new Error(`Modèle fiscal officiel absent : ${name}`); return readFileSync(found);
};
const frDate = (value: string) => { const [y, m, d] = value.split("-"); return y && m && d ? `${d}/${m}/${y}` : value; };
const months = (start: string, end: string) => { const a = new Date(`${start}T00:00:00Z`), b = new Date(`${end}T00:00:00Z`); return Math.max(1, Math.round((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + (b.getUTCDate() >= a.getUTCDate() ? 1 : 0))); };
const amount = (value: number) => value ? Math.round(value).toLocaleString("fr-FR").replace(/\u202f/g, " ") : "";
const at = (rows: Row[], code: string) => rows.find((row) => row.code.split("/").includes(code))?.value ?? 0;
const fit = (font: PDFFont, value: string, maxWidth: number, preferred = 9) => { let size = preferred; while (size > 5 && font.widthOfTextAtSize(value, size) > maxWidth) size -= .25; return size; };
const write = (page: PDFPage, font: PDFFont, value: unknown, x: number, y: number, maxWidth = 250, size = 9) => { const text = String(value ?? "").trim(); if (text) page.drawText(text, { x, y, size: fit(font, text, maxWidth, size), font, color: rgb(0, 0, 0), maxWidth }); };
const right = (page: PDFPage, font: PDFFont, value: number, xRight: number, y: number, size = 9) => { const text = amount(value); if (text) page.drawText(text, { x: xRight - font.widthOfTextAtSize(text, size), y, size, font, color: rgb(0, 0, 0) }); };
const watermark = (page: PDFPage, font: PDFFont) => page.drawText("DOSSIER DE SAISIE CONTROLE - TRANSMISSION NON EFFECTUEE", { x: 113, y: 12, size: 6, font, color: rgb(.65, .12, .12) });
const header = (page: PDFPage, font: PDFFont, name: string, x: number, y: number) => write(page, font, name, x, y, 220, 9);
const siretDigits = (page: PDFPage, font: PDFFont, value: string, x: number, y: number, step = 15) => [...value.replace(/\D/g, "")].forEach((digit, index) => write(page, font, digit, x + index * step, y, 8, 9));

function fill2065(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  const { identity, form2065 } = input.package;
  write(page, font, frDate(input.period.startDate), 132, 730, 80, 9); write(page, font, frDate(input.period.endDate), 243, 730, 80, 9);
  write(page, font, identity.name, 26, 653, 230, 10); write(page, font, identity.address, 296, 653, 250, 8); write(page, font, identity.address, 26, 619, 250, 8);
  siretDigits(page, font, identity.siret, 104, 640, 13.93); write(page, font, identity.email, 320, 640, 190, 8); write(page, font, identity.activity, 129, 541, 180, 8);
  right(page, font, form2065.taxableAt25, 181, 494, 10); right(page, font, form2065.deficit, 374, 494, 10); right(page, font, form2065.taxableAt15, 566, 494, 10);
  write(page, font, form2065.accountingSoftware, 439, 227, 110, 8); write(page, font, form2065.signatory.city, 260, 148, 100, 8); write(page, font, frDate(form2065.signatory.date), 315, 161, 75, 8); write(page, font, `${form2065.signatory.name} - ${form2065.signatory.role}`, 385, 148, 170, 8);
}

function fill2033A(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  const { identity, form2033C } = input.package, bs = input.statements.balanceSheet;
  header(page, font, identity.name, 135, 743); write(page, font, identity.address, 135, 729, 240, 8); siretDigits(page, font, identity.siret, 93, 703, 15.03); write(page, font, months(input.period.startDate, input.period.endDate), 180, 690, 20, 9); write(page, font, frDate(input.period.endDate).replaceAll("/", "  "), 484, 657, 80, 8);
  const fixed = new Map(form2033C.fixedAssets.map((row) => [row.code, row]));
  const fixedRows = [{ key: "immaterial", y: 601 }, { key: "tangible", y: 586 }, { key: "financial", y: 571 }];
  for (const row of fixedRows) { const item = fixed.get(row.key); if (!item) continue; right(page, font, item.closingGross, 371, row.y); right(page, font, item.closingDepreciation, 468, row.y); right(page, font, item.closingGross - item.closingDepreciation, 565, row.y); }
  const currentY: Record<string, number> = { "050": 542, "060": 527, "064": 512, "068": 498, "072": 483, "080": 469, "084": 454, "092": 439 };
  for (const [code, y] of Object.entries(currentY)) { const value = at(bs.assets, code); right(page, font, value, 371, y); right(page, font, value, 565, y); }
  const grossFixed = form2033C.fixedAssets.reduce((sum, row) => sum + row.closingGross, 0), depreciation = form2033C.fixedAssets.reduce((sum, row) => sum + row.closingDepreciation, 0);
  right(page, font, grossFixed, 371, 557); right(page, font, depreciation, 468, 557); right(page, font, bs.fixedAssetsTotal, 565, 557); right(page, font, bs.currentAssetsTotal, 371, 424); right(page, font, bs.currentAssetsTotal, 565, 424); right(page, font, grossFixed + bs.currentAssetsTotal, 371, 409); right(page, font, depreciation, 468, 409); right(page, font, bs.totalAssets, 565, 409);
  const liabilityY: Record<string, number> = { "120": 366, "124": 352, "126": 337, "130": 322, "132": 307, "134": 293, "136": 278, "137": 263, "140": 248, "156": 204, "164": 190, "166": 175, "172": 159, "173": 143, "175": 128, "174": 113 };
  for (const [code, y] of Object.entries(liabilityY)) right(page, font, at(bs.liabilities, code), 565, y);
  right(page, font, bs.equityTotal, 565, 234); right(page, font, bs.debtsTotal, 565, 98); right(page, font, bs.totalLiabilities, 565, 83);
}

function fill2033B(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  header(page, font, input.package.identity.name, 298, 783); write(page, font, frDate(input.period.endDate).replaceAll("/", "  "), 447, 764, 80, 8);
  const pnlY: Record<string, number> = { "210": 751, "214": 739, "218": 726, "222": 714, "224": 702, "226": 690, "230": 679, "232": 667, "234": 656, "236": 646, "238": 635, "240": 623, "242": 612, "244": 600, "250": 588, "252": 576, "254": 563, "256": 551, "262": 539, "264": 515, "270": 502, "280": 490, "294": 490, "290": 479, "300": 464, "306": 434, "310": 422 };
  for (const [code, y] of Object.entries(pnlY)) right(page, font, at(input.statements.profitAndLoss.fields, code), 504, y);
  const fiscal = input.statements.fiscalTable.fields; right(page, font, at(fiscal, "312"), 424, 409); right(page, font, at(fiscal, "314"), 504, 409); right(page, font, at(fiscal, "330"), 424, 345); right(page, font, at(fiscal, "344"), 343, 206); right(page, font, at(fiscal, "352"), 424, 80); right(page, font, at(fiscal, "354"), 504, 80); right(page, font, at(fiscal, "360"), 504, 56); right(page, font, at(fiscal, "370"), 424, 44); right(page, font, at(fiscal, "372"), 504, 44);
}

function fill2033C(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  header(page, font, input.package.identity.name, 332, 774); const rows = input.package.form2033C.fixedAssets, y: Record<string, number> = { immaterial: 701, tangible: 610, financial: 595 };
  for (const row of rows) { const yy = y[row.code]; if (!yy) continue; right(page, font, row.openingGross, 246, yy); right(page, font, row.increases, 327, yy); right(page, font, row.decreases, 408, yy); right(page, font, row.closingGross, 488, yy); }
  const totals = rows.reduce((a, row) => ({ openingGross: a.openingGross + row.openingGross, increases: a.increases + row.increases, decreases: a.decreases + row.decreases, closingGross: a.closingGross + row.closingGross }), { openingGross: 0, increases: 0, decreases: 0, closingGross: 0 });
  right(page, font, totals.openingGross, 246, 581); right(page, font, totals.increases, 327, 581); right(page, font, totals.decreases, 408, 581); right(page, font, totals.closingGross, 488, 581);
  const amortY: Record<string, number> = { immaterial: 519, tangible: 430 }; for (const row of rows) { const yy = amortY[row.code]; if (!yy) continue; right(page, font, row.openingDepreciation, 311, yy); right(page, font, row.depreciationCharge, 392, yy); right(page, font, row.depreciationDecrease, 473, yy); right(page, font, row.closingDepreciation, 556, yy); }
  const amort = rows.reduce((a, row) => ({ opening: a.opening + row.openingDepreciation, charge: a.charge + row.depreciationCharge, decrease: a.decrease + row.depreciationDecrease, closing: a.closing + row.closingDepreciation }), { opening: 0, charge: 0, decrease: 0, closing: 0 });
  right(page, font, amort.opening, 311, 415); right(page, font, amort.charge, 392, 415); right(page, font, amort.decrease, 473, 415); right(page, font, amort.closing, 556, 415);
}

function fill2033D(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  header(page, font, input.package.identity.name, 319, 760); const d = input.package.form2033D; right(page, font, d.provisions[0]?.amount ?? 0, 543, 675); right(page, font, d.provisions[1]?.amount ?? 0, 543, 659); right(page, font, d.provisions[2]?.amount ?? 0, 543, 598); right(page, font, d.provisions.reduce((s, row) => s + row.amount, 0), 543, 582); right(page, font, d.lossCarryforwards, 300, 317); right(page, font, d.vatCollected ?? 0, 543, 201); right(page, font, d.vatDeductible ?? 0, 543, 185);
}

function fill2033E(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  const { identity, form2033E } = input.package; header(page, font, identity.name, 311, 768); write(page, font, frDate(input.period.startDate), 96, 749, 80, 8); write(page, font, frDate(input.period.endDate), 217, 749, 80, 8); right(page, font, form2033E.averageEmployees ?? 0, 565, 706); right(page, font, form2033E.turnover, 565, 619); right(page, font, form2033E.turnover, 565, 575); right(page, font, form2033E.externalConsumption, 565, 406); right(page, font, form2033E.taxes, 565, 374); right(page, font, form2033E.externalConsumption + form2033E.taxes, 565, 298); right(page, font, form2033E.valueAdded - form2033E.taxes, 565, 267); right(page, font, Math.max(0, form2033E.valueAdded - form2033E.taxes), 565, 231);
}

function fill2033F(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput, people: Owner[], index: number, count: number) {
  const { identity, form2033F } = input.package; header(page, font, identity.name, 305, 722); write(page, font, identity.address, 260, 705, 220, 7); siretDigits(page, font, identity.siren, 400, 736, 15.32); write(page, font, frDate(input.period.endDate).replaceAll("/", "  "), 233, 736, 115, 8); write(page, font, `${index + 1}/${count}`, 42, 736, 30, 7);
  const legal = form2033F.owners.filter((owner) => owner.kind === "entity"), physical = form2033F.owners.filter((owner) => owner.kind === "person"); right(page, font, legal.length, 286, 663); right(page, font, legal.reduce((s, o) => s + (o.shareCount ?? 0), 0), 558, 663); right(page, font, physical.length, 286, 644); right(page, font, physical.reduce((s, o) => s + (o.shareCount ?? 0), 0), 558, 644); right(page, font, form2033F.owners.length, 286, 625); right(page, font, form2033F.totalShares, 558, 625);
  const slotY = [273, 176]; people.forEach((owner, i) => { const yy = slotY[i]; const parts = owner.name.trim().split(/\s+/); write(page, font, "M", 154, yy, 20, 8); write(page, font, parts.slice(-1).join(" "), 307, yy, 130, 8); write(page, font, parts.slice(0, -1).join(" "), 522, yy, 35, 7); right(page, font, owner.ownershipPercent ?? 0, 424, yy - 18); right(page, font, owner.shareCount ?? 0, 548, yy - 18); write(page, font, frDate(owner.birthDate), 155, yy - 36, 80, 7); write(page, font, owner.birthPlace, 399, yy - 36, 95, 7); write(page, font, owner.address, 155, yy - 55, 330, 6); write(page, font, "France", 519, yy - 73, 35, 7); });
}

function fill2033G(page: PDFPage, font: PDFFont, input: AnnualFilingPdfInput) {
  const { identity, form2033G } = input.package; header(page, font, identity.name, 306, 724); write(page, font, identity.address, 263, 708, 220, 7); siretDigits(page, font, identity.siren, 405, 736, 15.54); write(page, font, frDate(input.period.endDate).replaceAll("/", "  "), 234, 736, 115, 8); right(page, font, form2033G.subsidiaries.length, 375, 673);
  if (!form2033G.subsidiaries.length) { write(page, font, "X", 467, 789, 15, 9); return; }
  const ys = [635, 562, 489, 415, 343, 270, 194, 120]; form2033G.subsidiaries.slice(0, ys.length).forEach((row, i) => { const y = ys[i]; write(page, font, row.legalForm, 150, y + 17, 80, 7); write(page, font, row.name, 310, y + 17, 200, 7); write(page, font, row.siren, 150, y, 80, 7); right(page, font, row.ownershipPercent ?? 0, 550, y); write(page, font, `${row.address} ${row.postalCode} ${row.city}`, 150, y - 18, 340, 6); write(page, font, row.country, 515, y - 18, 40, 6); });
}

export async function generateAnnualFilingPdf(input: AnnualFilingPdfInput) {
  const source2065 = await PDFDocument.load(template("2065-sd-2026.pdf")), source2033 = await PDFDocument.load(template("2033-sd-2026.pdf")); const output = await PDFDocument.create(); const font = await output.embedFont(StandardFonts.Helvetica); const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const pages2065 = await output.copyPages(source2065, [0, 1]); pages2065.forEach((page) => output.addPage(page)); const pages2033 = await output.copyPages(source2033, [0, 1, 2, 3, 4]); pages2033.forEach((page) => output.addPage(page));
  const people = input.package.form2033F.owners.filter((owner) => owner.kind === "person"), chunks = Array.from({ length: Math.max(1, Math.ceil(people.length / 2)) }, (_, i) => people.slice(i * 2, i * 2 + 2)); for (let i = 0; i < chunks.length; i++) { const [page] = await output.copyPages(source2033, [5]); output.addPage(page); fill2033F(page, font, input, chunks[i], i, chunks.length); }
  const [pageG] = await output.copyPages(source2033, [6]); output.addPage(pageG);
  const pages = output.getPages(); fill2065(pages[0], font, input); fill2033A(pages[2], font, input); fill2033B(pages[3], font, input); fill2033C(pages[4], font, input); fill2033D(pages[5], font, input); fill2033E(pages[6], font, input); fill2033G(pageG, font, input); pages.forEach((page) => watermark(page, bold)); output.setTitle(`Liasse fiscale 2065 et 2033 - ${input.package.identity.name}`); output.setSubject("Dossier de saisie contrôlé - transmission non effectuée"); return output.save();
}
