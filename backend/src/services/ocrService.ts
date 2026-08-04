import { Mistral } from "@mistralai/mistralai";
import { Category, Invoice } from "../types/index.js";
import { nanoid } from "../utils/id.js";
import { loadAiConfig } from "./settingsService.js";
import { callAi } from "./aiService.js";
import { extractTextLocally, localOcrUrl } from "./localOcrService.js";
import { parseReceiptTextLocally } from "./receiptParser.js";

function getMistralClient(): Mistral {
  const config = loadAiConfig();
  const apiKey = config?.mistralApiKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("Clé Mistral OCR non configurée. Ajoutez-la dans Paramètres → OCR Mistral.");
  return new Mistral({ apiKey });
}

/**
 * Extrait le texte d'un PDF via l'API OCR de Mistral.
 */
export interface ReceiptProposal {
  supplier: string;
  date?: string;
  invoiceRef?: string;
  amountHt: number;
  amountTtc: number;
  category: Category;
  vatSplits: Array<{ rate: number; amountTtc: number }>;
  confidence: "high" | "medium" | "low";
}

const CATEGORIES: Category[] = ["hosting", "software", "salary", "travel", "restaurant", "food", "taxes", "equipment", "subscription", "rent", "legal", "insurance", "misc"];
const round2 = (value: number) => Math.round(value * 100) / 100;

export function normalizeReceiptProposal(value: unknown): ReceiptProposal {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const amountTtc = Number(input.amount_ttc ?? 0); const amountHt = Number(input.amount_ht ?? 0);
  const rawSplits = Array.isArray(input.vat_splits) ? input.vat_splits : [];
  const vatSplits = rawSplits.flatMap((split) => {
    if (!split || typeof split !== "object") return [];
    const row = split as Record<string, unknown>; const rate = Number(row.rate); const splitTtc = Number(row.amount_ttc);
    return Number.isFinite(rate) && rate >= 0 && Number.isFinite(splitTtc) && splitTtc > 0 ? [{ rate: round2(rate), amountTtc: round2(splitTtc) }] : [];
  });
  const category = CATEGORIES.includes(input.category as Category) ? input.category as Category : "misc";
  const confidence = ["high", "medium", "low"].includes(String(input.confidence)) ? input.confidence as ReceiptProposal["confidence"] : "low";
  return { supplier: typeof input.supplier === "string" ? input.supplier.trim() : "Inconnu", date: typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : undefined, invoiceRef: typeof input.invoice_ref === "string" ? input.invoice_ref.trim() : undefined, amountHt: Number.isFinite(amountHt) ? round2(Math.abs(amountHt)) : 0, amountTtc: Number.isFinite(amountTtc) ? round2(Math.abs(amountTtc)) : 0, category, vatSplits, confidence };
}

async function extractTextRemotely(buffer: Buffer, mimetype: string): Promise<string> {
  const mistral = getMistralClient();
  const base64 = buffer.toString("base64");
  const document = mimetype === "application/pdf"
    ? { type: "document_url" as const, documentUrl: `data:application/pdf;base64,${base64}` }
    : { type: "image_url" as const, imageUrl: `data:${mimetype};base64,${base64}` };
  const response = await mistral.ocr.process({ model: "mistral-ocr-latest", document });

  // Concatenate all pages markdown
  return response.pages.map((p: { markdown: string }) => p.markdown).join("\n\n");
}

/**
 * Parse le texte extrait par OCR en structure de facture via le fournisseur IA configuré.
 */
async function parseReceiptTextRemotely(rawText: string): Promise<ReceiptProposal> {
  const system = `Tu extrais fidèlement les données d'un justificatif comptable français. Réponds UNIQUEMENT avec un JSON valide, sans inventer les valeurs illisibles.`;
  const prompt = `Analyse ce ticket ou cette facture. Retourne ce JSON exact :
{
  "supplier": "<nom du fournisseur>",
  "date": "<YYYY-MM-DD ou null>",
  "invoice_ref": "<numéro de note/facture ou null>",
  "amount_ht": <montant HT en nombre>,
  "amount_ttc": <montant TTC en nombre>,
  "vat_splits": [{ "rate": <taux>, "amount_ttc": <part TTC soumise à ce taux> }],
  "category": "<hosting|software|salary|travel|restaurant|food|taxes|equipment|subscription|rent|legal|insurance|misc>",
  "confidence": "<high|medium|low>"
}

Pour vat_splits, restitue une ligne par taux visible. La somme des amount_ttc doit correspondre au TTC. Si la ventilation n'est pas lisible, retourne un tableau vide et confidence low.

Texte de la facture :
${rawText.slice(0, 3000)}`;

  const text = await callAi(system, prompt, 512);
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return normalizeReceiptProposal(jsonMatch ? JSON.parse(jsonMatch[0]) : {});
  } catch {
    return normalizeReceiptProposal({});
  }
}

export async function extractReceiptFromDocument(buffer: Buffer, mimetype: string): Promise<{ proposal: ReceiptProposal; rawText: string }> {
  if (localOcrUrl()) {
    try {
      const rawText = await extractTextLocally(buffer, mimetype);
      const proposal = parseReceiptTextLocally(rawText);
      if (proposal.confidence !== "low" || process.env.OCR_REMOTE_FALLBACK !== "true") return { proposal, rawText };
    } catch (error) {
      if (process.env.OCR_REMOTE_FALLBACK !== "true") throw error;
    }
  }
  const rawText = await extractTextRemotely(buffer, mimetype);
  return { proposal: await parseReceiptTextRemotely(rawText), rawText };
}

/**
 * Pipeline complet : PDF buffer → texte OCR → facture structurée.
 */
export async function extractInvoiceFromPdf(
  pdfBuffer: Buffer,
  filename: string
): Promise<{ invoice: Partial<Invoice>; rawText: string }> {
  const { proposal: parsed, rawText } = await extractReceiptFromDocument(pdfBuffer, "application/pdf");

  const invoice: Partial<Invoice> = {
    id: `inv_${nanoid()}`,
    supplier: parsed.supplier ?? "Inconnu",
    date: parsed.date ?? new Date().toISOString().slice(0, 10),
    vat_rate: parsed.vatSplits[0]?.rate ?? 0,
    amount_ht: parsed.amountHt,
    amount_ttc: parsed.amountTtc,
    category: parsed.category,
    file: `attachments/${filename}`,
  };

  return { invoice, rawText };
}
