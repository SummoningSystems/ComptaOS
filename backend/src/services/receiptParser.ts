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
  if (/restaurant|brasserie|bistro|cafe|café|repas|addition/.test(normalized)) return "restaurant";
  if (/hotel|sncf|train|taxi|uber|stationnement|parking/.test(normalized)) return "travel";
  if (/logiciel|software|licence|abonnement/.test(normalized)) return "software";
  if (/assurance/.test(normalized)) return "insurance";
  if (/loyer|location immobili/.test(normalized)) return "rent";
  if (/materiel|matériel|equipement|équipement/.test(normalized)) return "equipment";
  return "misc";
}

function detectDate(text: string): string | undefined {
  const match = text.match(/\b(0?[1-9]|[12]\d|3[01])[/.-](0?[1-9]|1[0-2])[/.-](20\d{2}|\d{2})\b/);
  if (!match) return undefined;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function detectSupplier(text: string): string {
  const ignored = /ticket|facture|note|duplicata|client|adresse|telephone|tél[.:]|siret|tva|bill\s+\d/i;
  return text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 3 && line.length <= 60 && /[a-zà-ÿ]{3}/i.test(line) && !ignored.test(line)) ?? "Inconnu";
}

function detectInvoiceRef(text: string): string | undefined {
  return text.match(/(?:bill|facture|ticket|note|reçu|réf(?:érence)?)[ \t#:n°-]*([a-z0-9][a-z0-9/_-]{2,})/i)?.[1];
}

interface VatSummary { amountHt: number; amountTtc: number; vatSplits: Array<{ rate: number; amountTtc: number }> }

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

function detectVatSplits(text: string): Array<{ rate: number; amountTtc: number }> {
  const rows: Array<{ rate: number; amountTtc: number }> = [];
  for (const line of text.split(/\r?\n/)) {
    const rateMatch = line.match(/(?:tva\s*)?(5[,.]5|10|20)\s*%/i);
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
  const summary = detectColumnSummary(text);
  const amountTtc = summary?.amountTtc ?? findLastAmount(text, [
    new RegExp(`(?:net|total)\\s*(?:a|à)?\\s*payer[^\\d]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`total\\s*ttc[^\\d]{0,12}${AMOUNT}`, "gim"),
    new RegExp(`ttc[^\\d]{0,12}${AMOUNT}`, "gim"),
  ]);
  const amountHt = summary?.amountHt ?? findLastAmount(text, [new RegExp(`total\\s*ht[^\\d]{0,12}${AMOUNT}`, "gim"), new RegExp(`ht[^\\d]{0,12}${AMOUNT}`, "gim")]);
  const vatSplits = summary?.vatSplits ?? detectVatSplits(text);
  const splitTotal = round2(vatSplits.reduce((sum, split) => sum + split.amountTtc, 0));
  const coherent = amountTtc > 0 && (!vatSplits.length || Math.abs(splitTotal - amountTtc) < 0.06);
  const fields = [amountTtc > 0, amountHt > 0, Boolean(detectDate(text)), vatSplits.length > 0].filter(Boolean).length;
  return { supplier: detectSupplier(text), date: detectDate(text), invoiceRef: detectInvoiceRef(text), amountHt, amountTtc, category: detectCategory(text), vatSplits: coherent ? vatSplits : [], confidence: coherent && fields >= 3 ? "high" : fields >= 2 ? "medium" : "low" };
}
