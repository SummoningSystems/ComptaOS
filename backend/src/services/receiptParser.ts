import type { Category } from "../types/index.js";
import type { ReceiptProposal } from "./ocrService.js";

const round2 = (value: number) => Math.round(value * 100) / 100;
const amount = (value: string) => Number(value.replace(/\s/g, "").replace(",", "."));
const AMOUNT = "([0-9]{1,6}(?:[\\s.]?[0-9]{3})*[,.][0-9]{2})";

function findLastAmount(text: string, patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const matches = [...text.matchAll(pattern)];
    const value = matches.at(-1)?.[1];
    if (value) return round2(amount(value));
  }
  return 0;
}

function detectCategory(text: string): Category {
  const normalized = text.toLowerCase();
  if (/restaurant|brasserie|bistro|grill|cafe|café|repas|addition|boulangerie|sandwich/.test(normalized)) return "restaurant";
  if (/hotel|sncf|train|taxi|uber|stationnement|parking/.test(normalized)) return "travel";
  if (/freebox|free pro/.test(normalized)) return "telecom";
  if (/kandbaz|domiciliation/.test(normalized)) return "subscription";
  if (/logiciel|software|licence|license|abonnement|unity asset store|digital asset/.test(normalized)) return "software";
  if (/sous[- ]traitance|subcontract/.test(normalized)) return "subcontracting";
  if (/honoraires|consultant|consulting|conseil/.test(normalized)) return "professional_fees";
  if (/prestataire|prestation de service|services? extérieurs?/.test(normalized)) return "external_services";
  if (/assurance/.test(normalized)) return "insurance";
  if (/loyer|location immobili/.test(normalized)) return "rent";
  if (/materiel|matériel|equipement|équipement/.test(normalized)) return "equipment";
  return "misc";
}

function detectDate(text: string): string | undefined {
  const match = text.match(/\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2}|\d{2})\b/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  const english = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i);
  if (!english) return undefined;
  const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  return `${english[3]}-${String(months.indexOf(english[1].toLowerCase()) + 1).padStart(2, "0")}-${english[2].padStart(2, "0")}`;
}

function detectSupplier(text: string): string {
  const known = text.match(/\b(Free Pro|Unity Technologies(?:\s+SF)?|Unity Asset Store)\b/i)?.[1];
  if (known) return known;
  const ignored = /ticket|facture|note|duplicata|client|adresse|telephone|tél[.:]|siret|tva|bill\s+\d/i;
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 3 && line.length <= 60 && /[a-zà-ÿ]{3}/i.test(line) && !ignored.test(line)) ?? "Inconnu";
}

function detectInvoiceRef(text: string): string | undefined {
  return text.match(/n[°o]?\s*de\s*facture\s*[:#-]?\s*([a-z0-9][a-z0-9/_-]{2,})/i)?.[1]
    ?? text.match(/invoice\s*(?:no\.?|number|#)\s*[:#-]?\s*([a-z0-9][a-z0-9/_-]{2,})/i)?.[1]
    ?? text.match(/(?:bill|facture|ticket|note|reçu|réf(?:érence)?)[ \t#:n°-]*([a-z0-9][a-z0-9/_-]{2,})/i)?.[1];
}

interface VatSummary { amountHt: number; amountTtc: number; vatSplits: Array<{ rate: number; amountTtc: number }> }

/** Tickets Lightspeed : "TVA 10% sur 25.08: € 2.51 (27.58)". */
function detectTaxBaseSummary(text: string): VatSummary | undefined {
  const rows: Array<{ rate: number; amountHt: number; amountVat: number; amountTtc: number }> = [];
  const pattern = new RegExp(`tva\\s*(5[,.]5|10|20)\\s*%\\s*sur\\s*${AMOUNT}\\s*:?[^\\d]{0,8}${AMOUNT}\\s*\\(\\s*${AMOUNT}\\s*\\)`, "gi");
  for (const match of text.matchAll(pattern)) {
    const rate = Number(match[1].replace(",", "."));
    const amountHt = round2(amount(match[2]));
    const amountVat = round2(amount(match[3]));
    const amountTtc = round2(amount(match[4]));
    if (Math.abs(amountHt + amountVat - amountTtc) >= 0.06 || Math.abs(amountHt * rate / 100 - amountVat) >= 0.08) continue;
    rows.push({ rate, amountHt, amountVat, amountTtc });
  }
  if (!rows.length) return undefined;
  return { amountHt: round2(rows.reduce((sum, row) => sum + row.amountHt, 0)), amountTtc: round2(rows.reduce((sum, row) => sum + row.amountTtc, 0)), vatSplits: rows.map(({ rate, amountTtc }) => ({ rate, amountTtc })) };
}

/** Tableaux PDF lus colonne par colonne : tous les en-têtes, puis toutes les valeurs. */
function detectColumnSummary(text: string): VatSummary | undefined {
  const compact = text.replace(/\s+/g, " ");
  const match = compact.match(new RegExp(
    `total\\s*ht\\s+taux\\s*tva\\s+total\\s*tva\\s+total\\s*ttc\\s+${AMOUNT}(?:\\s*euros?)?\\s+${AMOUNT}\\s*%\\s+${AMOUNT}(?:\\s*euros?)?\\s+${AMOUNT}`,
    "i",
  ));
  if (!match) return undefined;
  const amountHt = round2(amount(match[1]));
  const rate = round2(amount(match[2]));
  const vat = round2(amount(match[3]));
  const amountTtc = round2(amount(match[4]));
  if (rate < 0 || rate > 100 || Math.abs(amountHt + vat - amountTtc) >= 0.06 || Math.abs(amountHt * rate / 100 - vat) >= 0.08) return undefined;
  return { amountHt, amountTtc, vatSplits: [{ rate, amountTtc }] };
}

/** Tickets dont l'OCR restitue d'abord les en-têtes TVA/TTC/HT, puis leurs valeurs. */
function detectReorderedHeaderSummary(text: string): VatSummary | undefined {
  const compact = text.replace(/\s+/g, " ");
  const match = compact.match(new RegExp(`tva\\s+ttc\\s+ht\\s+${AMOUNT}\\s+${AMOUNT}\\s+${AMOUNT}`, "i"));
  if (!match) return undefined;
  const vat = round2(amount(match[1]));
  const amountTtc = round2(amount(match[2]));
  const amountHt = round2(amount(match[3]));
  if (amountHt <= 0 || vat <= 0 || Math.abs(amountHt + vat - amountTtc) >= 0.06) return undefined;
  const printedRate = compact.match(/tva\s*(2[,.]1|5[,.]5|10(?:[,.]0+)?|20(?:[,.]0+)?)\s*%/i)?.[1];
  const rate = printedRate ? Number(printedRate.replace(",", ".")) : [2.1, 5.5, 10, 20].find((candidate) => Math.abs(amountHt * candidate / 100 - vat) < 0.08);
  if (rate === undefined || Math.abs(amountHt * rate / 100 - vat) >= 0.08) return undefined;
  return { amountHt, amountTtc, vatSplits: [{ rate, amountTtc }] };
}

/** Factures françaises : "Total € HT", "TVA_20 (20%)", "Total € TTC". */
function detectFrenchInvoiceSummary(text: string): VatSummary | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const htLine = lines.find((line) => /total\s*(?:€|eur(?:os?)?)?\s*ht/i.test(line));
  const ttcLine = lines.find((line) => /total\s*(?:€|eur(?:os?)?)?\s*ttc/i.test(line));
  const vatLine = lines.find((line) => /(?:^|\s)(?:tva|vat)(?:[_\s-]|$)/i.test(line));
  const lastAmount = (line: string | undefined): number => {
    if (!line) return 0;
    const values = [...line.matchAll(new RegExp(AMOUNT, "g"))];
    return values.length ? round2(amount(values.at(-1)![1])) : 0;
  };
  const amountHt = lastAmount(htLine);
  const amountTtc = lastAmount(ttcLine);
  const vat = lastAmount(vatLine);
  if (amountHt <= 0 || amountTtc <= 0 || vat <= 0 || Math.abs(amountHt + vat - amountTtc) >= 0.06) return undefined;
  const rateText = vatLine?.match(/(?:tva|vat)[_\s-]*(2[,.]1|5[,.]5|10|20)|\((2[,.]1|5[,.]5|10|20)\s*%\)/i);
  const rate = rateText ? Number((rateText[1] ?? rateText[2]).replace(",", ".")) : [2.1, 5.5, 10, 20].find((candidate) => Math.abs(amountHt * candidate / 100 - vat) < 0.08);
  if (rate === undefined || Math.abs(amountHt * rate / 100 - vat) >= 0.08) return undefined;
  return { amountHt, amountTtc, vatSplits: [{ rate, amountTtc }] };
}

/** Tickets lus verticalement : taux sur une ligne, puis HT, TVA et TTC sur trois lignes. */
function detectVerticalVatSummary(text: string): VatSummary | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const vatSplits: Array<{ rate: number; amountTtc: number }> = [];
  let amountHt = 0;
  let vatTotal = 0;
  for (let index = 0; index < lines.length; index++) {
    const rateMatch = lines[index].match(/^tva\s+(5[,.]5|10|20)\s*%$/i);
    if (!rateMatch) continue;
    const values: number[] = [];
    for (let next = index + 1; next < Math.min(lines.length, index + 7) && values.length < 3; next++) {
      const value = lines[next].match(/^([0-9]{1,6}[,.][0-9]{2})(?:\s*(?:€|eur(?:os?)?))?$/i)?.[1];
      if (value) values.push(amount(value));
      else if (/^tva\s+/i.test(lines[next]) || /^total/i.test(lines[next])) break;
    }
    if (values.length !== 3) continue;
    const rate = Number(rateMatch[1].replace(",", "."));
    const [ht, vat, ttc] = values.map(round2);
    if (Math.abs(ht + vat - ttc) >= 0.06 || Math.abs(ht * rate / 100 - vat) >= 0.08) continue;
    amountHt += ht; vatTotal += vat; vatSplits.push({ rate, amountTtc: ttc });
  }
  if (!vatSplits.length) return undefined;
  const amountTtc = round2(vatSplits.reduce((sum, split) => sum + split.amountTtc, 0));
  amountHt = round2(amountHt); vatTotal = round2(vatTotal);
  if (Math.abs(amountHt + vatTotal - amountTtc) >= 0.06) return undefined;
  return { amountHt, amountTtc, vatSplits };
}

function detectVatSplits(text: string): Array<{ rate: number; amountTtc: number }> {
  const rows: Array<{ rate: number; amountTtc: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const rateMatch = line.match(/(?:tva\s*)?(5[,.]5|10(?:[,.]0+)?|20(?:[,.]0+)?)\s*%/i);
    if (!rateMatch) continue;
    const rate = Number(rateMatch[1].replace(",", "."));
    const values = [...line.matchAll(new RegExp(AMOUNT, "g"))].map((match) => amount(match[1]));
    if (!values.length) continue;
    let splitTtc = 0;
    if (/ttc/i.test(line)) splitTtc = values.at(-1) ?? 0;
    else if (values.length >= 2) {
      const ht = values.at(-2) ?? 0;
      const vat = values.at(-1) ?? 0;
      if (Math.abs(ht * rate / 100 - vat) < 0.06) splitTtc = ht + vat;
    }
    if (splitTtc > 0 && !rows.some((row) => row.rate === rate)) rows.push({ rate, amountTtc: round2(splitTtc) });
  }
  return rows;
}

/** Transforme le texte OCR en proposition prudente, sans LLM ni donnée inventée. */
export function parseReceiptTextLocally(rawText: string): ReceiptProposal {
  const text = rawText.replace(/\u00a0/g, " ");
  const summary = detectTaxBaseSummary(text) ?? detectColumnSummary(text) ?? detectReorderedHeaderSummary(text) ?? detectFrenchInvoiceSummary(text) ?? detectVerticalVatSummary(text);
  const amountTtc = summary?.amountTtc ?? findLastAmount(text, [
    new RegExp(`(?:net|total)\\s*(?:a|à)?\\s*payer[^\\d]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`total\\s*ttc[^\\d]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`(?:^|\\n)\\s*total(?!\\s*(?:tva|vat|tax|ht|hors|excl))[^\\d\\n]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`ttc[^\\d]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`total\\s*incl\\.?\\s*(?:tax|vat)[^\\d]{0,16}${AMOUNT}`, "gim"),
  ]);
  let amountHt = summary?.amountHt ?? findLastAmount(text, [new RegExp(`total\\s*ht[^\\d]{0,12}${AMOUNT}`, "gim"), new RegExp(`hors\\s*taxe[^\\d]{0,12}${AMOUNT}`, "gim"), new RegExp(`ht[^\\d]{0,12}${AMOUNT}`, "gim"), new RegExp(`total\\s*excl\\.?\\s*(?:tax|vat)[^\\d]{0,16}${AMOUNT}`, "gim")]);
  let vatSplits = summary?.vatSplits ?? detectVatSplits(text);
  const explicitVat = findLastAmount(text, [new RegExp(`(?:^|\\n)\\s*(?:total\\s*)?(?:tax|vat|tva)(?:\\s+(?:2[,.]1|5[,.]5|10(?:[,.]0+)?|20(?:[,.]0+)?)\\s*%)?\\s*:?[^\\d]{0,16}${AMOUNT}`, "gim")]);
  if (!amountHt && amountTtc > explicitVat && explicitVat > 0) amountHt = round2(amountTtc - explicitVat);
  if (!vatSplits.length && amountHt > 0 && amountTtc > 0 && explicitVat > 0 && Math.abs(amountHt + explicitVat - amountTtc) < 0.06) {
    const printedRate = [...text.matchAll(/\b(2[,.]1|5[,.]5|10(?:[,.]0+)?|20(?:[,.]0+)?)\s*%/g)].map((match) => Number(match[1].replace(",", "."))).at(-1);
    const inferredRate = [2.1, 5.5, 10, 20].find((candidate) => Math.abs(amountHt * candidate / 100 - explicitVat) < 0.08);
    const rate = printedRate ?? inferredRate;
    if (rate !== undefined && Math.abs(amountHt * rate / 100 - explicitVat) < 0.08) vatSplits = [{ rate, amountTtc }];
  }
  const splitTotal = round2(vatSplits.reduce((sum, split) => sum + split.amountTtc, 0));
  const coherent = amountTtc > 0 && (!vatSplits.length || Math.abs(splitTotal - amountTtc) < 0.06);
  const fields = [amountTtc > 0, amountHt > 0, Boolean(detectDate(text)), vatSplits.length > 0].filter(Boolean).length;
  const enrichedSplits = coherent ? vatSplits.map((split) => { const splitHt = round2(split.amountTtc / (1 + split.rate / 100)); return { ...split, amountHt: splitHt, amountVat: round2(split.amountTtc - splitHt) }; }) : [];
  return { supplier: detectSupplier(text), date: detectDate(text), invoiceRef: detectInvoiceRef(text), amountHt, amountVat: round2(Math.max(0, amountTtc - amountHt)), amountTtc, category: detectCategory(text), vatSplits: enrichedSplits, confidence: coherent && fields >= 3 ? "high" : fields >= 2 ? "medium" : "low" };
}
