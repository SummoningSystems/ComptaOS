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
  CategoryDefinition,
  Company,
  CompanyProfile,
} from "../types";
import { compressAttachment, type CompressionResult } from "../utils/imageCompression";
export function buildApiUrl(basePath: string, path = ""): string {
  const normalizedBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
  const normalizedPath = path.replace(/^\/+/, "");
  return `${normalizedBase}api${normalizedPath ? `/${normalizedPath}` : ""}`;
}
export const api = axios.create({ baseURL: buildApiUrl(import.meta.env.BASE_URL) });
let workspaceId = new URLSearchParams(window.location.search).get("workspace") ?? "";
let preferenceKey = "comptaos_workspace_local";
export function currentWorkspaceId() { return workspaceId; }
function scopedPath(path: string) {
  const clean = path.replace(/^\//, "");
  if (!workspaceId || /^(auth|companies|workspaces|ecosystems|health|backups|license|waitlist|stripe)(\/|$)/.test(clean)) return clean;
  return "workspaces/" + encodeURIComponent(workspaceId) + "/" + clean;
}
api.interceptors.request.use(config => { config.url = scopedPath(config.url ?? ""); return config; });
api.interceptors.response.use(response => {
  const match = /^workspaces\/([^/]+)\//.exec(response.config.url ?? "");
  if (match && decodeURIComponent(match[1]) !== workspaceId) throw new axios.CanceledError("Espace changé");
  return response;
});
export async function initializeWorkspace(userId = "local"): Promise<Company | null> {
  preferenceKey = "comptaos_workspace_" + userId;
  const list = await fetchCompanies();
  const requested = new URLSearchParams(window.location.search).get("workspace") ?? localStorage.getItem(preferenceKey);
  const selected = list.find(c => c.id === requested) ?? list.find(c => c.kind === "household") ?? list[0] ?? null;
  if (selected) selectWorkspace(selected.id);
  return selected;
}
export function selectWorkspace(id: string) {
  workspaceId = id;
  localStorage.setItem(preferenceKey, id);
  const url = new URL(window.location.href);
  url.searchParams.set("workspace", id);
  window.history.replaceState(null, "", url);
}
export function apiUrl(path: string): string {
  return buildApiUrl(import.meta.env.BASE_URL, scopedPath(path));
}
const _apiKey = localStorage.getItem("comptaos_api_key");
if (_apiKey) api.defaults.headers.common["X-API-Key"] = _apiKey;
export interface ReceiptOcrProposal {
  supplier: string; date?: string; invoiceRef?: string; amountHt: number; amountVat?: number; amountTtc: number;
  category: Transaction["category"]; vatSplits: Array<{ rate: number; amountHt?: number; amountVat?: number; amountTtc: number }>;
  confidence: "high" | "medium" | "low";
}
export interface AttachmentOcrResult { status: "success" | "unavailable" | "error"; proposal?: ReceiptOcrProposal; automaticProposal?: ReceiptOcrProposal; rawText?: string; validatedAt?: string; message?: string }
export interface PendingReceipt { id: string; filename: string; originalName: string; mimetype: string; createdAt: string; ocr: AttachmentOcrResult }
export interface BatchOcrProgress { running: boolean; done: number; total: number; succeeded: number; failed: number; currentName: string }
export interface ReconciliationResult { transaction: Transaction; transactions: Transaction[]; proposal?: ReceiptOcrProposal; appliedProposal: boolean }
export interface SmartSuggestion {
  id: string;
  label: string;
  amount_ttc: number;
  suggestedCategory: string;
  suggestedVatRate?: number;
  confidenceLevel: "high" | "medium" | "low";
  confidenceScore: number;
  matchedKeyword: string;
  reason: string;
}
export type GitProvider = "github" | "gitlab" | "gitea" | "custom" | "local";
export interface GitSyncStatus {
  configured: boolean;
  provider?: GitProvider;
  remoteUrl?: string;
  branch?: string;
  hasToken: boolean;
  ahead: number;
  behind: number;
  local: { ready: boolean; error?: string; uncommitted: number; lastCommit?: string; lastAutoCommitAt?: string };
  localDestinationAllowed: boolean;
}
export interface GitSyncConfig {
  provider: GitProvider;
  remoteUrl: string;
  token?: string;
  branch: string;
}
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
  regime?: import("../types").CompanyProfile["vatRegime"];
  referenceYear?: number;
  referenceAmount?: number;
  reserve?: number;
  payments?: number;
  nextDue?: { period: string; label: string; estimatedAmount: number; provisional: boolean };
  details: VatTransactionDetail[];
}
export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  message: string;
  author: string;
  filesChanged: number;
}
export function createWorkspaceApi(workspaceId: string) {
 const revisions=new Map<string,number>();
 const api=axios.create({baseURL:buildApiUrl(import.meta.env.BASE_URL)});
 if(_apiKey)api.defaults.headers.common['X-API-Key']=_apiKey;
 const scoped=(path:string)=>{const clean=path.replace(/^\//,'');return !workspaceId || /^(auth|companies|workspaces|ecosystems|health|backups|license|waitlist|stripe)(\/|$)/.test(clean)?clean:'workspaces/'+encodeURIComponent(workspaceId)+'/'+clean;};
 api.interceptors.request.use(config=>{config.url=scoped(config.url??'');return config;});
 const apiUrl=(path:string)=>buildApiUrl(import.meta.env.BASE_URL,scoped(path));
 async function uploadInvoicePdf(file: File): Promise<{
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
async function fetchFileTree(): Promise<FileNode[]> {
  const { data } = await api.get<FileNode[]>("/files");
  return data;
}
async function fetchFileContent(path: string): Promise<string> {
  const { data } = await api.get<{ content: string }>("/files/content", {
    params: { path },
  });
  return data.content;
}
async function saveFileContent(path: string, content: string): Promise<void> {
  await api.put("/files/content", { path, content });
}
async function deleteFile(path: string): Promise<void> {
  await api.delete("/files", { params: { path } });
}
async function createDirectory(path: string): Promise<void> {
  await api.post("/files/directory", { path });
}
async function renameNode(oldPath: string, newPath: string): Promise<void> {
  await api.post("/files/rename", { oldPath, newPath });
}
async function fetchTransactions(): Promise<Transaction[]> {
  const { data } = await api.get<Transaction[]>("/transactions");
  for(const transaction of data)if(transaction.revision!==undefined)revisions.set(transaction.id,transaction.revision);
  return data;
}
async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<Transaction> {
  const { data } = await api.patch<Transaction>(`/transactions/${id}`, {revision:revisions.get(id),...patch});
  if(data.revision!==undefined)revisions.set(id,data.revision);
  return data;
}
async function deleteTransaction(id: string): Promise<void> {
  await api.delete(`/transactions/${id}`);
}
async function deleteTransactions(ids: string[]): Promise<void> {
  await api.delete("/transactions", { data: { ids } });
}
async function bulkUpdateStatus(
  ids: string[],
  status: Transaction["status"]
): Promise<{ updated: number }> {
  const { data } = await api.patch<{ updated: number }>("/transactions/bulk-status", { ids, status });
  return data;
}
async function createTransaction(txn: Omit<Transaction, "id">): Promise<Transaction> {
  const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const { data } = await api.post<Transaction>("/transactions", { id, ...txn });
  return data;
}
async function uploadAttachment(
  txnId: string,
  file: File,
  options?: { skipOcr?: boolean; signal?: AbortSignal },
): Promise<{ filename: string; transaction: Transaction; compression: CompressionResult; ocr: AttachmentOcrResult }> {
  let compression: CompressionResult;
  try {
    compression = await compressAttachment(file);
  } catch {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new Error("Cette photo HEIC ne peut pas être lue par ce navigateur. Choisissez JPEG dans les réglages de l'appareil ou convertissez la photo.");
    compression = { file, compressed: false, originalBytes: file.size, uploadedBytes: file.size, savedPercent: 0 };
  }
  const form = new FormData();
  form.append("file", compression.file);
  const { data } = await api.post(`/attachments/upload/${txnId}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
    params: options?.skipOcr ? { skipOcr: "true" } : undefined,
    signal: options?.signal,
  });
  return { ...data, compression };
}
async function analyzeAttachment(txnId: string, signal?: AbortSignal): Promise<{ transaction: Transaction; ocr: AttachmentOcrResult }> {
  const { data } = await api.post(`/attachments/analyze/${txnId}`, undefined, { signal });
  return data;
}
function rawFileUrl(path: string): string {
  return `${apiUrl("files/raw")}?path=${encodeURIComponent(path)}`;
}
async function fetchPendingReceipts(): Promise<PendingReceipt[]> {
  const { data } = await api.get<PendingReceipt[]>("/attachments/inbox");
  return data;
}
async function uploadPendingReceipt(file: File, options?: { skipOcr?: boolean }): Promise<{ receipt: PendingReceipt; compression: CompressionResult }> {
  let compression: CompressionResult;
  try {
    compression = await compressAttachment(file);
  } catch {
    if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) throw new Error("Cette photo HEIC ne peut pas être lue par ce navigateur. Choisissez JPEG dans les réglages de l'appareil ou convertissez la photo.");
    compression = { file, compressed: false, originalBytes: file.size, uploadedBytes: file.size, savedPercent: 0 };
  }
  const form = new FormData(); form.append("file", compression.file);
  const { data } = await api.post<PendingReceipt>("/attachments/inbox", form, { headers: { "Content-Type": "multipart/form-data" }, params: options?.skipOcr ? { skipOcr: "true" } : undefined });
  return { receipt: data, compression };
}
async function analyzePendingReceipt(receiptId: string): Promise<PendingReceipt> {
  const { data } = await api.post<PendingReceipt>(`/attachments/inbox/${receiptId}/analyze`);
  return data;
}
async function updatePendingReceiptOcr(receiptId: string, proposal: ReceiptOcrProposal): Promise<PendingReceipt> {
  const { data } = await api.patch<PendingReceipt>(`/attachments/inbox/${receiptId}/ocr`, { proposal: { supplier: proposal.supplier, date: proposal.date, invoice_ref: proposal.invoiceRef, amount_ht: proposal.amountHt, amount_vat: proposal.amountVat, amount_ttc: proposal.amountTtc, category: proposal.category, confidence: "high", vat_splits: proposal.vatSplits.map((row) => ({ rate: row.rate, amount_ht: row.amountHt, amount_vat: row.amountVat, amount_ttc: row.amountTtc })) } });
  return data;
}
async function rotatePendingReceipt(receiptId: string, degrees: -90 | 90 | 180): Promise<PendingReceipt> {
  const { data } = await api.post<PendingReceipt>(`/attachments/inbox/${receiptId}/rotate`, { degrees });
  return data;
}
async function transformPendingReceipt(receiptId: string, operation: "enhance" | "crop"): Promise<PendingReceipt> {
  const { data } = await api.post<PendingReceipt>(`/attachments/inbox/${receiptId}/transform`, { operation }); return data;
}
async function startPendingReceiptBatchOcr(ids?: string[]): Promise<BatchOcrProgress> {
  const { data } = await api.post<BatchOcrProgress>("/attachments/inbox/analyze-batch", ids ? { ids } : {});
  return data;
}
async function fetchPendingReceiptBatchOcr(): Promise<BatchOcrProgress> {
  const { data } = await api.get<BatchOcrProgress>("/attachments/inbox/analyze-batch");
  return data;
}
async function linkPendingReceipt(receiptId: string, transactionId: string, match?: { score?: number; reasons?: string[] }): Promise<ReconciliationResult> {
  const { data } = await api.post<ReconciliationResult>(`/attachments/inbox/${receiptId}/link`, { transactionId, applyProposal: true, ...match });
  return data;
}
async function linkPendingReceiptGroup(receiptIds: string[], transactionId: string, match?: { score?: number; reasons?: string[] }): Promise<ReconciliationResult> {
  const { data } = await api.post<ReconciliationResult>("/attachments/inbox/link-group", { receiptIds, transactionId, ...match }); return data;
}
async function linkPendingReceiptToMany(receiptId: string, transactionIds: string[], match?: { score?: number; reasons?: string[] }): Promise<ReconciliationResult> {
  const { data } = await api.post<ReconciliationResult>(`/attachments/inbox/${receiptId}/link-many`, { transactionIds, ...match }); return data;
}
async function deletePendingReceipt(receiptId: string): Promise<void> {
  await api.delete(`/attachments/inbox/${receiptId}`);
}
async function deleteAttachment(txnId: string, filename: string): Promise<Transaction> {
  const { data } = await api.delete<{ transaction: Transaction }>(`/attachments/${txnId}`, {
    data: { filename },
  });
  return data.transaction;
}
function attachmentUrl(filename: string): string {
  return apiUrl(`/attachments/file/${encodeURIComponent(filename)}`);
}
async function fetchAttachmentBlob(filename: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/attachments/file/${encodeURIComponent(filename)}`, { responseType: "blob" });
  return data;
}
async function fetchAttachmentObjectUrl(filename: string): Promise<string> {
  return URL.createObjectURL(await fetchAttachmentBlob(filename));
}
async function previewCsv(content: string): Promise<{
  columns: string[];
  samples: string[][];
}> {
  const { data } = await api.post("/import/preview", { content });
  return data;
}
async function importCsv(
  content: string,
  mapping: CsvMappingConfig
): Promise<{ imported: number; skipped: number; transactions: Transaction[] }> {
  const { data } = await api.post("/import/csv", { content, mapping });
  return data;
}
async function fetchDashboard(year?: string): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>("/dashboard", { params: year ? { year } : undefined });
  return data;
}
async function fetchManualRecurring(): Promise<ManualRecurring[]> {
  const { data } = await api.get<ManualRecurring[]>("/recurring/manual");
  return data;
}
async function saveManualRecurring(entries: ManualRecurring[]): Promise<void> {
  await api.put("/recurring/manual", entries);
}
async function fetchHrEmployees(): Promise<import("../types").HrEmployee[]> {
  const { data } = await api.get<import("../types").HrEmployee[]>("/hr/employees");
  return data;
}
async function saveHrEmployees(entries: import("../types").HrEmployee[]): Promise<void> {
  await api.put("/hr/employees", entries);
}
async function fetchHrWorkspace(): Promise<import("../types").HrStore> {
  const { data } = await api.get<import("../types").HrStore>("/hr/workspace"); return data;
}
async function saveHrWorkspace(store: import("../types").HrStore): Promise<void> { await api.put("/hr/workspace", store); }
async function uploadHrDocument(employeeId: string, type: import("../types").HrDocumentType, month: string, file: File): Promise<import("../types").HrDocument> {
  const form = new FormData(); form.append("file", file); const { data } = await api.post(`/hr/documents/${employeeId}`, form, { params: { type, month: month || undefined }, headers: { "Content-Type": "multipart/form-data" } }); return data;
}
async function deleteHrDocument(id: string): Promise<void> { await api.delete(`/hr/documents/${id}`); }
async function linkHrPayslip(id: string, transactionId?: string): Promise<void> { await api.post(`/hr/documents/${id}/link`, { transactionId }); }
async function fetchCategoryRules(): Promise<CategoryRule[]> {
  const { data } = await api.get<CategoryRule[]>("/settings/category-rules");
  return data;
}
async function saveCategoryRules(rules: CategoryRule[]): Promise<void> {
  await api.put("/settings/category-rules", rules);
}
async function fetchTreasuryAlert(): Promise<TreasuryAlert> {
  const { data } = await api.get<TreasuryAlert>("/settings/treasury-alert");
  return data;
}
async function saveTreasuryAlert(alert: TreasuryAlert): Promise<void> {
  await api.put("/settings/treasury-alert", alert);
}
async function fetchInvoices(): Promise<OutgoingInvoice[]> {
  const { data } = await api.get<OutgoingInvoice[]>("/invoices/");
  return data;
}
async function createInvoice(inv: Omit<OutgoingInvoice, "id"> & { id?: string }): Promise<OutgoingInvoice> {
  const { data } = await api.post<OutgoingInvoice>("/invoices/", inv);
  return data;
}
async function updateInvoice(id: string, inv: OutgoingInvoice): Promise<OutgoingInvoice> {
  const { data } = await api.put<OutgoingInvoice>(`/invoices/${id}`, inv);
  return data;
}
async function deleteInvoice(id: string): Promise<void> {
  await api.delete(`/invoices/${id}`);
}
async function fetchQuotes(): Promise<Quote[]> {
  const { data } = await api.get<Quote[]>("/quotes/");
  return data;
}
async function createQuote(q: Quote): Promise<Quote> {
  const { data } = await api.post<Quote>("/quotes/", q);
  return data;
}
async function updateQuote(id: string, q: Quote): Promise<Quote> {
  const { data } = await api.put<Quote>(`/quotes/${id}`, q);
  return data;
}
async function deleteQuote(id: string): Promise<void> {
  await api.delete(`/quotes/${id}`);
}
async function convertQuoteToInvoice(id: string): Promise<OutgoingInvoice> {
  const { data } = await api.post<OutgoingInvoice>(`/quotes/${id}/convert`);
  return data;
}
async function fetchAiConfig(): Promise<AiConfigStatus> {
  const { data } = await api.get<AiConfigStatus>("/settings/ai");
  return data;
}
async function saveAiConfig(config: AiConfig): Promise<void> {
  await api.put("/settings/ai", config);
}
async function fetchBudgets(): Promise<CategoryBudget[]> {
  const { data } = await api.get<CategoryBudget[]>("/settings/budgets");
  return data;
}
async function saveBudgets(budgets: CategoryBudget[]): Promise<void> {
  await api.put("/settings/budgets", budgets);
}
async function fetchCompanies(): Promise<Company[]> {
  const { data } = await api.get<Company[]>("/companies");
  return data;
}
async function fetchActiveCompany(): Promise<Company | null> {
  const list = await fetchCompanies();
  return list.find(c => c.id === workspaceId) ?? list[0] ?? null;
}
async function setActiveCompanyApi(companyId: string): Promise<void> {
  await api.put("/companies/active", { companyId });
  selectWorkspace(companyId);
}
async function createCompanyApi(name: string): Promise<Company> {
  const { data } = await api.post<Company>("/companies", { name });
  return data;
}
async function fetchSmartSuggestions(): Promise<{ suggestions: SmartSuggestion[]; learnedPatterns: number }> {
  const { data } = await api.get<{ suggestions: SmartSuggestion[]; learnedPatterns: number }>("/transactions/smart-categorize");
  return data;
}
async function fetchCategories(): Promise<CategoryDefinition[]> {
  const { data } = await api.get<CategoryDefinition[]>("/settings/categories");
  return data;
}
async function createCategory(category: Omit<CategoryDefinition, "builtin">): Promise<CategoryDefinition> {
  const { data } = await api.post<CategoryDefinition>("/settings/categories", category);
  return data;
}
async function updateCategoryDefinition(category: Omit<CategoryDefinition, "builtin">): Promise<CategoryDefinition> {
  const { data } = await api.put<CategoryDefinition>(`/settings/categories/${category.id}`, category);
  return data;
}
async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/settings/categories/${id}`);
}
async function fetchGitSyncStatus(): Promise<GitSyncStatus> {
  const { data } = await api.get<GitSyncStatus>("/git/sync");
  return data;
}
async function configureGitSync(config: GitSyncConfig): Promise<void> {
  await api.post("/git/sync/configure", config);
}
async function testGitSync(config: Omit<GitSyncConfig, "provider"> & { provider?: GitProvider }): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post<{ ok: boolean; error?: string }>("/git/sync/test", config);
  return data;
}
async function gitSyncPush(): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post<{ ok: boolean; message: string }>("/git/sync/push");
  return data;
}
async function gitSyncPull(): Promise<{ ok: boolean; message: string }> {
  const { data } = await api.post<{ ok: boolean; message: string }>("/git/sync/pull");
  return data;
}
async function deleteGitSync(): Promise<void> {
  await api.delete("/git/sync");
}
async function fetchCompanyProfile(): Promise<CompanyProfile> {
  const { data } = await api.get<CompanyProfile>("/settings/profile");
  return data;
}
async function saveCompanyProfile(profile: CompanyProfile): Promise<void> {
  await api.put("/settings/profile", profile);
}
async function downloadInvoicePdf(id: string, number: string): Promise<void> {
  const { data } = await api.get(`/invoices/${id}/pdf`, { responseType: "blob" });
  const url = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `facture-${number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
async function applySmartCategories(changes: { id: string; category: string; vat_rate?: number }[]): Promise<{ updated: number }> {
  const { data } = await api.post<{ updated: number }>("/transactions/smart-categorize/apply", { changes });
  return data;
}
async function fetchVatSummary(year: string): Promise<VatSummaryData> {
  const { data } = await api.get<VatSummaryData>(`/reports/vat-summary?year=${year}`);
  return data;
}
async function fetchPnl(year: string): Promise<PnlData> {
  const { data } = await api.get<PnlData>(`/reports/pnl?year=${year}`);
  return data;
}
async function fetchGitLog(): Promise<{ commits: GitCommit[]; initialized: boolean }> {
  const { data } = await api.get<{ commits: GitCommit[]; initialized: boolean }>("/git/log");
  return data;
}
async function fetchGitDiff(hash: string): Promise<string> {
  const { data } = await api.get<{ diff: string }>(`/git/diff/${hash}`);
  return data.diff;
}
return {api,apiUrl,uploadInvoicePdf,fetchFileTree,fetchFileContent,saveFileContent,deleteFile,createDirectory,renameNode,fetchTransactions,updateTransaction,deleteTransaction,deleteTransactions,bulkUpdateStatus,createTransaction,uploadAttachment,analyzeAttachment,rawFileUrl,fetchPendingReceipts,uploadPendingReceipt,analyzePendingReceipt,updatePendingReceiptOcr,rotatePendingReceipt,transformPendingReceipt,startPendingReceiptBatchOcr,fetchPendingReceiptBatchOcr,linkPendingReceipt,linkPendingReceiptGroup,linkPendingReceiptToMany,deletePendingReceipt,deleteAttachment,attachmentUrl,fetchAttachmentBlob,fetchAttachmentObjectUrl,previewCsv,importCsv,fetchDashboard,fetchManualRecurring,saveManualRecurring,fetchHrEmployees,saveHrEmployees,fetchHrWorkspace,saveHrWorkspace,uploadHrDocument,deleteHrDocument,linkHrPayslip,fetchCategoryRules,saveCategoryRules,fetchTreasuryAlert,saveTreasuryAlert,fetchInvoices,createInvoice,updateInvoice,deleteInvoice,fetchQuotes,createQuote,updateQuote,deleteQuote,convertQuoteToInvoice,fetchAiConfig,saveAiConfig,fetchBudgets,saveBudgets,fetchCompanies,fetchActiveCompany,setActiveCompanyApi,createCompanyApi,fetchSmartSuggestions,fetchCategories,createCategory,updateCategoryDefinition,deleteCategory,fetchGitSyncStatus,configureGitSync,testGitSync,gitSyncPush,gitSyncPull,deleteGitSync,fetchCompanyProfile,saveCompanyProfile,downloadInvoicePdf,applySmartCategories,fetchVatSummary,fetchPnl,fetchGitLog,fetchGitDiff};
}
export const uploadInvoicePdf = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['uploadInvoicePdf']>) => createWorkspaceApi(workspaceId).uploadInvoicePdf(...args);
export const fetchFileTree = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchFileTree']>) => createWorkspaceApi(workspaceId).fetchFileTree(...args);
export const fetchFileContent = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchFileContent']>) => createWorkspaceApi(workspaceId).fetchFileContent(...args);
export const saveFileContent = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveFileContent']>) => createWorkspaceApi(workspaceId).saveFileContent(...args);
export const deleteFile = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteFile']>) => createWorkspaceApi(workspaceId).deleteFile(...args);
export const createDirectory = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createDirectory']>) => createWorkspaceApi(workspaceId).createDirectory(...args);
export const renameNode = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['renameNode']>) => createWorkspaceApi(workspaceId).renameNode(...args);
export const fetchTransactions = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchTransactions']>) => createWorkspaceApi(workspaceId).fetchTransactions(...args);
export const updateTransaction = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['updateTransaction']>) => createWorkspaceApi(workspaceId).updateTransaction(...args);
export const deleteTransaction = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteTransaction']>) => createWorkspaceApi(workspaceId).deleteTransaction(...args);
export const deleteTransactions = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteTransactions']>) => createWorkspaceApi(workspaceId).deleteTransactions(...args);
export const bulkUpdateStatus = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['bulkUpdateStatus']>) => createWorkspaceApi(workspaceId).bulkUpdateStatus(...args);
export const createTransaction = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createTransaction']>) => createWorkspaceApi(workspaceId).createTransaction(...args);
export const uploadAttachment = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['uploadAttachment']>) => createWorkspaceApi(workspaceId).uploadAttachment(...args);
export const analyzeAttachment = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['analyzeAttachment']>) => createWorkspaceApi(workspaceId).analyzeAttachment(...args);
export const rawFileUrl = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['rawFileUrl']>) => createWorkspaceApi(workspaceId).rawFileUrl(...args);
export const fetchPendingReceipts = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchPendingReceipts']>) => createWorkspaceApi(workspaceId).fetchPendingReceipts(...args);
export const uploadPendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['uploadPendingReceipt']>) => createWorkspaceApi(workspaceId).uploadPendingReceipt(...args);
export const analyzePendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['analyzePendingReceipt']>) => createWorkspaceApi(workspaceId).analyzePendingReceipt(...args);
export const updatePendingReceiptOcr = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['updatePendingReceiptOcr']>) => createWorkspaceApi(workspaceId).updatePendingReceiptOcr(...args);
export const rotatePendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['rotatePendingReceipt']>) => createWorkspaceApi(workspaceId).rotatePendingReceipt(...args);
export const transformPendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['transformPendingReceipt']>) => createWorkspaceApi(workspaceId).transformPendingReceipt(...args);
export const startPendingReceiptBatchOcr = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['startPendingReceiptBatchOcr']>) => createWorkspaceApi(workspaceId).startPendingReceiptBatchOcr(...args);
export const fetchPendingReceiptBatchOcr = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchPendingReceiptBatchOcr']>) => createWorkspaceApi(workspaceId).fetchPendingReceiptBatchOcr(...args);
export const linkPendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['linkPendingReceipt']>) => createWorkspaceApi(workspaceId).linkPendingReceipt(...args);
export const linkPendingReceiptGroup = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['linkPendingReceiptGroup']>) => createWorkspaceApi(workspaceId).linkPendingReceiptGroup(...args);
export const linkPendingReceiptToMany = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['linkPendingReceiptToMany']>) => createWorkspaceApi(workspaceId).linkPendingReceiptToMany(...args);
export const deletePendingReceipt = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deletePendingReceipt']>) => createWorkspaceApi(workspaceId).deletePendingReceipt(...args);
export const deleteAttachment = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteAttachment']>) => createWorkspaceApi(workspaceId).deleteAttachment(...args);
export const attachmentUrl = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['attachmentUrl']>) => createWorkspaceApi(workspaceId).attachmentUrl(...args);
export const fetchAttachmentBlob = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchAttachmentBlob']>) => createWorkspaceApi(workspaceId).fetchAttachmentBlob(...args);
export const fetchAttachmentObjectUrl = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchAttachmentObjectUrl']>) => createWorkspaceApi(workspaceId).fetchAttachmentObjectUrl(...args);
export const previewCsv = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['previewCsv']>) => createWorkspaceApi(workspaceId).previewCsv(...args);
export const importCsv = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['importCsv']>) => createWorkspaceApi(workspaceId).importCsv(...args);
export const fetchDashboard = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchDashboard']>) => createWorkspaceApi(workspaceId).fetchDashboard(...args);
export const fetchManualRecurring = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchManualRecurring']>) => createWorkspaceApi(workspaceId).fetchManualRecurring(...args);
export const saveManualRecurring = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveManualRecurring']>) => createWorkspaceApi(workspaceId).saveManualRecurring(...args);
export const fetchHrEmployees = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchHrEmployees']>) => createWorkspaceApi(workspaceId).fetchHrEmployees(...args);
export const saveHrEmployees = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveHrEmployees']>) => createWorkspaceApi(workspaceId).saveHrEmployees(...args);
export const fetchHrWorkspace = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchHrWorkspace']>) => createWorkspaceApi(workspaceId).fetchHrWorkspace(...args);
export const saveHrWorkspace = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveHrWorkspace']>) => createWorkspaceApi(workspaceId).saveHrWorkspace(...args);
export const uploadHrDocument = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['uploadHrDocument']>) => createWorkspaceApi(workspaceId).uploadHrDocument(...args);
export const deleteHrDocument = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteHrDocument']>) => createWorkspaceApi(workspaceId).deleteHrDocument(...args);
export const linkHrPayslip = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['linkHrPayslip']>) => createWorkspaceApi(workspaceId).linkHrPayslip(...args);
export const fetchCategoryRules = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchCategoryRules']>) => createWorkspaceApi(workspaceId).fetchCategoryRules(...args);
export const saveCategoryRules = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveCategoryRules']>) => createWorkspaceApi(workspaceId).saveCategoryRules(...args);
export const fetchTreasuryAlert = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchTreasuryAlert']>) => createWorkspaceApi(workspaceId).fetchTreasuryAlert(...args);
export const saveTreasuryAlert = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveTreasuryAlert']>) => createWorkspaceApi(workspaceId).saveTreasuryAlert(...args);
export const fetchInvoices = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchInvoices']>) => createWorkspaceApi(workspaceId).fetchInvoices(...args);
export const createInvoice = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createInvoice']>) => createWorkspaceApi(workspaceId).createInvoice(...args);
export const updateInvoice = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['updateInvoice']>) => createWorkspaceApi(workspaceId).updateInvoice(...args);
export const deleteInvoice = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteInvoice']>) => createWorkspaceApi(workspaceId).deleteInvoice(...args);
export const fetchQuotes = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchQuotes']>) => createWorkspaceApi(workspaceId).fetchQuotes(...args);
export const createQuote = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createQuote']>) => createWorkspaceApi(workspaceId).createQuote(...args);
export const updateQuote = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['updateQuote']>) => createWorkspaceApi(workspaceId).updateQuote(...args);
export const deleteQuote = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteQuote']>) => createWorkspaceApi(workspaceId).deleteQuote(...args);
export const convertQuoteToInvoice = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['convertQuoteToInvoice']>) => createWorkspaceApi(workspaceId).convertQuoteToInvoice(...args);
export const fetchAiConfig = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchAiConfig']>) => createWorkspaceApi(workspaceId).fetchAiConfig(...args);
export const saveAiConfig = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveAiConfig']>) => createWorkspaceApi(workspaceId).saveAiConfig(...args);
export const fetchBudgets = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchBudgets']>) => createWorkspaceApi(workspaceId).fetchBudgets(...args);
export const saveBudgets = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveBudgets']>) => createWorkspaceApi(workspaceId).saveBudgets(...args);
export const fetchCompanies = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchCompanies']>) => createWorkspaceApi(workspaceId).fetchCompanies(...args);
export const fetchActiveCompany = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchActiveCompany']>) => createWorkspaceApi(workspaceId).fetchActiveCompany(...args);
export const setActiveCompanyApi = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['setActiveCompanyApi']>) => createWorkspaceApi(workspaceId).setActiveCompanyApi(...args);
export const createCompanyApi = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createCompanyApi']>) => createWorkspaceApi(workspaceId).createCompanyApi(...args);
export const fetchSmartSuggestions = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchSmartSuggestions']>) => createWorkspaceApi(workspaceId).fetchSmartSuggestions(...args);
export const fetchCategories = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchCategories']>) => createWorkspaceApi(workspaceId).fetchCategories(...args);
export const createCategory = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['createCategory']>) => createWorkspaceApi(workspaceId).createCategory(...args);
export const updateCategoryDefinition = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['updateCategoryDefinition']>) => createWorkspaceApi(workspaceId).updateCategoryDefinition(...args);
export const deleteCategory = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteCategory']>) => createWorkspaceApi(workspaceId).deleteCategory(...args);
export const fetchGitSyncStatus = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchGitSyncStatus']>) => createWorkspaceApi(workspaceId).fetchGitSyncStatus(...args);
export const configureGitSync = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['configureGitSync']>) => createWorkspaceApi(workspaceId).configureGitSync(...args);
export const testGitSync = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['testGitSync']>) => createWorkspaceApi(workspaceId).testGitSync(...args);
export const gitSyncPush = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['gitSyncPush']>) => createWorkspaceApi(workspaceId).gitSyncPush(...args);
export const gitSyncPull = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['gitSyncPull']>) => createWorkspaceApi(workspaceId).gitSyncPull(...args);
export const deleteGitSync = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['deleteGitSync']>) => createWorkspaceApi(workspaceId).deleteGitSync(...args);
export const fetchCompanyProfile = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchCompanyProfile']>) => createWorkspaceApi(workspaceId).fetchCompanyProfile(...args);
export const saveCompanyProfile = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['saveCompanyProfile']>) => createWorkspaceApi(workspaceId).saveCompanyProfile(...args);
export const downloadInvoicePdf = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['downloadInvoicePdf']>) => createWorkspaceApi(workspaceId).downloadInvoicePdf(...args);
export const applySmartCategories = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['applySmartCategories']>) => createWorkspaceApi(workspaceId).applySmartCategories(...args);
export const fetchVatSummary = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchVatSummary']>) => createWorkspaceApi(workspaceId).fetchVatSummary(...args);
export const fetchPnl = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchPnl']>) => createWorkspaceApi(workspaceId).fetchPnl(...args);
export const fetchGitLog = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchGitLog']>) => createWorkspaceApi(workspaceId).fetchGitLog(...args);
export const fetchGitDiff = (...args: Parameters<ReturnType<typeof createWorkspaceApi>['fetchGitDiff']>) => createWorkspaceApi(workspaceId).fetchGitDiff(...args);
