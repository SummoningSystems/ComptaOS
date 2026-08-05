import axios from "axios";
import {
  FileNode,
  Transaction,
  DashboardData,
  CsvMappingConfig,
  ManualRecurring,
  CategoryRule,
  OutgoingInvoice,
  Quote,
  TreasuryAlert,
  AiConfig,
  AiConfigStatus,
  CategoryBudget,
  Company,
  CompanyProfile,
} from "../types";
import { compressAttachment, type CompressionResult } from "../utils/imageCompression";

// En production (base path configuré dans vite.config.ts), l'API est sous BASE_URL/api
export function buildApiUrl(basePath: string, path = ""): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}api${normalizedPath ? `/${normalizedPath}` : ""}`;
}

export const api = axios.create({ baseURL: buildApiUrl(import.meta.env.BASE_URL) });

export interface ReceiptOcrProposal {
  supplier: string; date?: string; invoiceRef?: string; amountHt: number; amountTtc: number;
  category: Transaction["category"]; vatSplits: Array<{ rate: number; amountTtc: number }>;
  confidence: "high" | "medium" | "low";
}
export interface AttachmentOcrResult { status: "success" | "unavailable" | "error"; proposal?: ReceiptOcrProposal; message?: string }
export interface PendingReceipt { id: string; filename: string; originalName: string; mimetype: string; createdAt: string; ocr: AttachmentOcrResult }

/** Construit une URL d'API navigable (liens et téléchargements) en respectant BASE_URL. */
export function apiUrl(path: string): string {
  return buildApiUrl(import.meta.env.BASE_URL, path);
}

// Injecte automatiquement X-API-Key si configurée (stockée dans localStorage)
const _apiKey = localStorage.getItem("comptaos_api_key");
if (_apiKey) api.defaults.headers.common["X-API-Key"] = _apiKey;

// ── OCR ───────────────────────────────────────────────────────────────────────

export async function uploadInvoicePdf(file: File): Promise<{
  invoice: Partial<import("../types").Invoice>;
  rawText: string;
}> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post("/ocr/invoice", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

// ── Files ────────────────────────────────────────────────────────────────────

export async function fetchFileTree(): Promise<FileNode[]> {
  const { data } = await api.get<FileNode[]>("/files");
  return data;
}

export async function fetchFileContent(path: string): Promise<string> {
  const { data } = await api.get<{ content: string }>("/files/content", {
    params: { path },
  });
  return data.content;
}

export async function saveFileContent(path: string, content: string): Promise<void> {
  await api.put("/files/content", { path, content });
}

export async function deleteFile(path: string): Promise<void> {
  await api.delete("/files", { params: { path } });
}

export async function createDirectory(path: string): Promise<void> {
  await api.post("/files/directory", { path });
}

export async function renameNode(oldPath: string, newPath: string): Promise<void> {
  await api.post("/files/rename", { oldPath, newPath });
}

// ── Transactions ──────────────────────────────────────────────────────────────

export async function fetchTransactions(): Promise<Transaction[]> {
  const { data } = await api.get<Transaction[]>("/transactions");
  return data;
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<Transaction> {
  const { data } = await api.patch<Transaction>(`/transactions/${id}`, patch);
  return data;
}

export async function deleteTransaction(id: string): Promise<void> {
  await api.delete(`/transactions/${id}`);
}

export async function deleteTransactions(ids: string[]): Promise<void> {
  await api.delete("/transactions", { data: { ids } });
}

export async function bulkUpdateStatus(
  ids: string[],
  status: Transaction["status"]
): Promise<{ updated: number }> {
  const { data } = await api.patch<{ updated: number }>("/transactions/bulk-status", { ids, status });
  return data;
}

export async function createTransaction(txn: Omit<Transaction, "id">): Promise<Transaction> {
  const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data } = await api.post<Transaction>("/transactions", { id, ...txn });
  return data;
}

export async function uploadAttachment(
  txnId: string,
  file: File
): Promise<{ filename: string; transaction: Transaction; compression: CompressionResult; ocr: AttachmentOcrResult }> {
  let compression: CompressionResult;
  try {
    compression = await compressAttachment(file);
  } catch (error) {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new Error("Cette photo HEIC ne peut pas être lue par ce navigateur. Choisissez JPEG dans les réglages de l'appareil ou convertissez la photo.");
    compression = { file, compressed: false, originalBytes: file.size, uploadedBytes: file.size, savedPercent: 0 };
  }
  const form = new FormData();
  form.append("file", compression.file);
  const { data } = await api.post(`/attachments/upload/${txnId}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return { ...data, compression };
}

export async function fetchPendingReceipts(): Promise<PendingReceipt[]> {
  const { data } = await api.get<PendingReceipt[]>("/attachments/inbox");
  return data;
}

export async function uploadPendingReceipt(file: File): Promise<{ receipt: PendingReceipt; compression: CompressionResult }> {
  let compression: CompressionResult;
  try {
    compression = await compressAttachment(file);
  } catch (error) {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new Error("Cette photo HEIC ne peut pas être lue par ce navigateur. Choisissez JPEG dans les réglages de l'appareil ou convertissez la photo.");
    compression = { file, compressed: false, originalBytes: file.size, uploadedBytes: file.size, savedPercent: 0 };
  }
  const form = new FormData(); form.append("file", compression.file);
  const { data } = await api.post<PendingReceipt>("/attachments/inbox", form, { headers: { "Content-Type": "multipart/form-data" } });
  return { receipt: data, compression };
}

export async function linkPendingReceipt(receiptId: string, transactionId: string): Promise<{ transaction: Transaction; proposal?: ReceiptOcrProposal }> {
  const { data } = await api.post<{ transaction: Transaction; proposal?: ReceiptOcrProposal }>(`/attachments/inbox/${receiptId}/link`, { transactionId });
  return data;
}

export async function deletePendingReceipt(receiptId: string): Promise<void> {
  await api.delete(`/attachments/inbox/${receiptId}`);
}

export async function deleteAttachment(txnId: string, filename: string): Promise<Transaction> {
  const { data } = await api.delete<{ transaction: Transaction }>(`/attachments/${txnId}`, {
    data: { filename },
  });
  return data.transaction;
}

export function attachmentUrl(filename: string): string {
  return apiUrl(`/attachments/file/${encodeURIComponent(filename)}`);
}

// ── Import CSV ────────────────────────────────────────────────────────────────

export async function previewCsv(content: string): Promise<{
  columns: string[];
  samples: string[][];
}> {
  const { data } = await api.post("/import/preview", { content });
  return data;
}

export async function importCsv(
  content: string,
  mapping: CsvMappingConfig
): Promise<{ imported: number; skipped: number; transactions: Transaction[] }> {
  const { data } = await api.post("/import/csv", { content, mapping });
  return data;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>("/dashboard");
  return data;
}

// ── Frais récurrents manuels ──────────────────────────────────────────────────

export async function fetchManualRecurring(): Promise<ManualRecurring[]> {
  const { data } = await api.get<ManualRecurring[]>("/recurring/manual");
  return data;
}

export async function saveManualRecurring(entries: ManualRecurring[]): Promise<void> {
  await api.put("/recurring/manual", entries);
}

// ── Paramètres (règles + alerte) ──────────────────────────────────────────────────────

export async function fetchCategoryRules(): Promise<CategoryRule[]> {
  const { data } = await api.get<CategoryRule[]>("/settings/category-rules");
  return data;
}

export async function saveCategoryRules(rules: CategoryRule[]): Promise<void> {
  await api.put("/settings/category-rules", rules);
}

export async function fetchTreasuryAlert(): Promise<TreasuryAlert> {
  const { data } = await api.get<TreasuryAlert>("/settings/treasury-alert");
  return data;
}

export async function saveTreasuryAlert(alert: TreasuryAlert): Promise<void> {
  await api.put("/settings/treasury-alert", alert);
}

// ── Factures clients ───────────────────────────────────────────────────────────────────

export async function fetchInvoices(): Promise<OutgoingInvoice[]> {
  const { data } = await api.get<OutgoingInvoice[]>("/invoices/");
  return data;
}

export async function createInvoice(inv: Omit<OutgoingInvoice, "id"> & { id?: string }): Promise<OutgoingInvoice> {
  const { data } = await api.post<OutgoingInvoice>("/invoices/", inv);
  return data;
}

export async function updateInvoice(id: string, inv: OutgoingInvoice): Promise<OutgoingInvoice> {
  const { data } = await api.put<OutgoingInvoice>(`/invoices/${id}`, inv);
  return data;
}

export async function deleteInvoice(id: string): Promise<void> {
  await api.delete(`/invoices/${id}`);
}

// ── Devis ─────────────────────────────────────────────────────────────────────

export async function fetchQuotes(): Promise<Quote[]> {
  const { data } = await api.get<Quote[]>("/quotes/");
  return data;
}

export async function createQuote(q: Quote): Promise<Quote> {
  const { data } = await api.post<Quote>("/quotes/", q);
  return data;
}

export async function updateQuote(id: string, q: Quote): Promise<Quote> {
  const { data } = await api.put<Quote>(`/quotes/${id}`, q);
  return data;
}

export async function deleteQuote(id: string): Promise<void> {
  await api.delete(`/quotes/${id}`);
}

export async function convertQuoteToInvoice(id: string): Promise<OutgoingInvoice> {
  const { data } = await api.post<OutgoingInvoice>(`/quotes/${id}/convert`);
  return data;
}

// ── Configuration IA ─────────────────────────────────────────────────────

export async function fetchAiConfig(): Promise<AiConfigStatus> {
  const { data } = await api.get<AiConfigStatus>("/settings/ai");
  return data;
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  await api.put("/settings/ai", config);
}

// ── Budgets par catégorie ─────────────────────────────────────────────────────

export async function fetchBudgets(): Promise<CategoryBudget[]> {
  const { data } = await api.get<CategoryBudget[]>("/settings/budgets");
  return data;
}

export async function saveBudgets(budgets: CategoryBudget[]): Promise<void> {
  await api.put("/settings/budgets", budgets);
}

// ── Entreprises (multi-dossiers) ──────────────────────────────────────────────

export async function fetchCompanies(): Promise<Company[]> {
  const { data } = await api.get<Company[]>("/companies");
  return data;
}

export async function fetchActiveCompany(): Promise<Company | null> {
  const { data } = await api.get<Company | null>("/companies/active");
  return data;
}

export async function setActiveCompanyApi(companyId: string): Promise<void> {
  await api.put("/companies/active", { companyId });
}

export async function createCompanyApi(name: string): Promise<Company> {
  const { data } = await api.post<Company>("/companies", { name });
  return data;
}

// ── Smart catégorisation ───────────────────────────────────────────────────────

export interface SmartSuggestion {
  id: string;
  label: string;
  amount_ttc: number;
  suggestedCategory: string;
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number;
  matchedKeyword: string;
}

export async function fetchSmartSuggestions(): Promise<{ suggestions: SmartSuggestion[]; learnedPatterns: number }> {
  const { data } = await api.get<{ suggestions: SmartSuggestion[]; learnedPatterns: number }>("/transactions/smart-categorize");
  return data;
}

// ── Synchronisation git distante ──────────────────────────────────────────────

export type GitProvider = "github" | "gitlab" | "gitea" | "custom";

export interface GitSyncStatus {
  configured: boolean;
  provider?: GitProvider;
  remoteUrl?: string;
  branch?: string;
  hasToken: boolean;
  ahead: number;
  behind: number;
}

export interface GitSyncConfig {
  provider: GitProvider;
  remoteUrl: string;
  token: string;
  branch: string;
}

export async function fetchGitSyncStatus(): Promise<GitSyncStatus> {
  const { data } = await api.get<GitSyncStatus>("/git/sync");
  return data;
}

export async function configureGitSync(config: GitSyncConfig): Promise<void> {
  await api.post("/git/sync/configure", config);
}

export async function testGitSync(config: Omit<GitSyncConfig, "provider"> & { provider?: GitProvider }): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post<{ ok: boolean; error?: string }>("/git/sync/test", config);
  return data;
}

export async function gitSyncPush(): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post<{ ok: boolean; message: string }>("/git/sync/push");
  return data;
}

export async function gitSyncPull(): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post<{ ok: boolean; message: string }>("/git/sync/pull");
  return data;
}

export async function deleteGitSync(): Promise<void> {
  await api.delete("/git/sync");
}

// ── Profil entreprise ─────────────────────────────────────────────────────────

export async function fetchCompanyProfile(): Promise<CompanyProfile> {
  const { data } = await api.get<CompanyProfile>("/settings/profile");
  return data;
}

export async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
  await api.put("/settings/profile", profile);
}

// ── Téléchargement PDF facture ────────────────────────────────────────────────

export async function downloadInvoicePdf(id: string, number: string): Promise<void> {
  const { data } = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `facture-${number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function applySmartCategories(changes: { id: string; category: string }[]): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>("/transactions/smart-categorize/apply", { changes });
  return data;
}

// ── Compte de résultat (P&L) ──────────────────────────────────────────────────

export interface PnlLine {
  account: string;
  label: string;
  amount: number;
  count: number;
}

export interface PnlData {
  year: string;
  produits: PnlLine[];
  charges: PnlLine[];
  total_produits: number;
  total_charges: number;
  resultat_brut: number;
  is_estimate: number;
  resultat_net: number;
}

export interface VatTransactionDetail {
  id: string;
  date: string;
  label: string;
  category: string;
  amount_ttc: number;
  amount_ht: number;
  vat: number;
  vat_rate: number;
  vat_splits: { rate: number; amount_ttc: number }[];
  direction: "collected" | "deductible";
  quarter: string;
}

export interface VatQuarterData {
  quarter: string;
  collected: number;
  deductible: number;
  net: number;
  revenue: number;
  expenses: number;
}

export interface VatSummaryData {
  year: string;
  quarters: VatQuarterData[];
  total: { collected: number; deductible: number; net: number };
  details: VatTransactionDetail[];
}

export async function fetchVatSummary(year: string): Promise<VatSummaryData> {
  const { data } = await api.get<VatSummaryData>(`/reports/vat-summary?year=${year}`);
  return data;
}

export async function fetchPnl(year: string): Promise<PnlData> {
  const { data } = await api.get<PnlData>(`/reports/pnl?year=${year}`);
  return data;
}

// ── Git / Historique ──────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
  filesChanged: number;
}

export async function fetchGitLog(): Promise<{ commits: GitCommit[]; initialized: boolean }> {
  const { data } = await api.get<{ commits: GitCommit[]; initialized: boolean }>("/git/log");
  return data;
}

export async function fetchGitDiff(hash: string): Promise<string> {
  const { data } = await api.get<{ diff: string }>(`/git/diff/${hash}`);
  return data.diff;
}
