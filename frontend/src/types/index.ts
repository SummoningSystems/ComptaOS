export type Category = string;

export interface CategoryDefinition {
  id: Category;
  label: string;
  account: { number: string; label: string };
  kind: "expense" | "revenue" | "both";
  builtin: boolean;
  active: boolean;
}

export interface VatSplit {
  rate: number;       // taux en % : 0, 2.1, 5.5, 10, 20
  amount_ttc: number; // montant TTC signé
}

export interface Transaction {
  revision?: number;
  documentIds?: string[];
  transferId?: string;
  sourceAllocation?: {ecosystemId:string;movementId:string;allocationId:string};
  settlement?: {accountNumber:string;label:string;journalCode:string;journalLabel:string;payerId?:string;transferAccount?:{number:string;label:string}};
  id: string;
  date: string;
  label: string;
  amount_ht: number;
  vat: number;
  vat_rate?: number;
  vat_splits?: VatSplit[];
  amount_ttc: number;
  currency: string;
  category: Category;
  account: string;
  status: "validated" | "pending" | "rejected";
  attachment?: string;
  attachments?: string[];
  attachment_details?: Array<{
    filename: string; originalName?: string; amount_ht?: number; vat?: number;
    amount_ttc?: number; invoiceRef?: string; vat_splits?: VatSplit[];
  }>;
  notes?: string;
  tags?: string[];
  justified?: boolean;
  comment?: string;
  paymentType?: string;
  cardHolder?: string;
  invoiceRef?: string;
  reconciled?: boolean;
  accountingTreatment?: "revenue" | "expense_refund" | "supplier_advance_refund";
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  extension?: string;
}

export interface DashboardData {
  monthly_revenue: { month: string; amount: number }[];
  monthly_expenses: { month: string; amount: number }[];
  vat_estimate: number;
  vat_collected?: number;
  vat_deductible?: number;
  vat_payments?: number;
  vat_reserve?: number;
  spendable_cash?: number;
  vat_regime?: CompanyProfile["vatRegime"];
  next_vat_due?: { period: string; label: string; estimated_amount: number; provisional: boolean };
  treasury: number;
  cash_unknown?: boolean;
  transaction_flow: number;
  bank_balance?: number;
  bank_balance_updated_at?: string;
  balance_difference?: number;
  bank_accounts: { id: string; name: string; currency: string; balance: number; updated_at?: string }[];
  accounting_result: number;
  accounting_revenue: number;
  accounting_expenses: number;
  available_years: string[];
  top_categories: { category: string; amount: number }[];
  // ── Nouveaux KPIs ──────────────────────────────────────────
  net_result: number;
  is_estimate: number;
  runway_months: number;
  misc_count: number;
  unjustified_count: number;
  current_year: string;
  monthly_balance: { month: string; amount: number }[];
  forecast: { month: string; balance: number; zeroRevenueBalance: number; expenses: number; revenue: number; projected?: boolean; items: { id: string; label: string; amount: number }[] }[];
  accounts: string[];
}

export interface CsvMappingConfig {
  date: string;
  label: string;
  amount: string;
  debit?: string;
  credit?: string;
  /** Colonne utilisée comme note (ex: Tiers / contrepartie) */
  notes?: string;
  /** Colonne État — les lignes valant "Transaction rejetée" sont ignorées */
  status_col?: string;
  /** Colonne catégorie Penylane → mapped vers nos catégories */
  category_col?: string;
}

export interface Invoice {
  id: string;
  supplier: string;
  date: string;
  vat_rate: number;
  amount_ht: number;
  amount_ttc: number;
  category: Category;
  file?: string;
  transaction_id?: string;
}

export type TabType = "ecosystem" | "editor" | "dashboard" | "import" | "transactions" | "ocr" | "reports" | "recurring" | "invoices" | "quotes" | "settings" | "tiers" | "vat" | "budgets" | "spreadsheets" | "history" | "journal" | "alerts" | "closing" | "annual-closing" | "templates" | "reconcile" | "treasury" | "export" | "profitloss" | "plugins" | "pricing" | "banking" | "users" | "hr";

export interface AnnualThirdParty { id: string; kind: "supplier" | "client"; name: string; accountNumber: string; notes?: string }
export interface AnnualThirdPartyDocument { id: string; kind: "purchase" | "sale"; thirdPartyId: string; date: string; invoiceRef: string; label: string; amountHt: number; amountVat: number; amountTtc: number; operatingAccount: string; vatAccount: string; thirdPartyAccount: string; paymentTransactionIds: string[]; advanceTransactionIds: string[]; advanceAccount: string; attachment?: string; status: "draft" | "validated" }
export interface AnnualSettlement { date: string; invoiceRef: string; amountHt: number; amountVat: number; amountTtc: number; supplierAccount: string; expenseAccount: string; vatAccount: string; attachment?: string; status: "draft" | "validated" }
export interface AnnualSchedule { id: string; supplier: string; label: string; reference: string; startDate: string; endDate: string; advanceAccount: string; transactionIds: string[]; attachment?: string; createdAt: string; settlement?: AnnualSettlement }
export interface AnnualAdjustment { id: string; year: string; date: string; type: "opening" | "accrual" | "prepaid" | "invoice_not_received" | "invoice_to_issue" | "provision" | "inventory" | "tax" | "other"; label: string; debitAccount: string; debitLabel: string; creditAccount: string; creditLabel: string; amount: number; justification?: string; attachment?: string; status: "draft" | "validated" }
export interface AnnualAsset { id: string; label: string; acquisitionDate: string; cost: number; residualValue: number; durationYears: number; assetAccount: string; depreciationAccount: string; expenseAccount: string; attachment?: string; disposedDate?: string }
export interface AnnualFiscalAdjustment { id: string; year: string; kind: "reinstatement" | "deduction"; label: string; amount: number; notes?: string }
export type AnnualCheckId = "documents" | "bank" | "third_parties" | "inventory" | "assets" | "vat" | "payroll" | "tax" | "review";

export interface Quote {
  id: string;
  number: string;
  client: string;
  date: string;
  validUntil: string;
  description: string;
  amount_ht: number;
  vat_rate: number;
  amount_ttc: number;
  status: "draft" | "sent" | "accepted" | "refused" | "converted";
  notes?: string;
  invoiceId?: string; // si converti en facture
}

export interface CategoryRule {
  id: string;
  pattern: string;
  category: Category;
}

export interface OutgoingInvoice {
  id: string;
  number: string;
  client: string;
  date: string;
  dueDate: string;
  description: string;
  amount_ht: number;
  vat_rate: number;
  amount_ttc: number;
  status: "draft" | "sent" | "paid" | "overdue";
  paidDate?: string;
  notes?: string;
}

export interface TreasuryAlert {
  threshold: number;
  enabled: boolean;
}

export interface CompanyProfile {
  name: string;
  legalForm?: string;
  siren?: string;
  vatNumber?: string;
  capital?: string;
  rcs?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  phone?: string;
  website?: string;
  iban?: string;
  bankName?: string;
  vatRegime?: "monthly_ca3" | "quarterly_ca3" | "simplified_ca12" | "franchise";
  vatReferenceYear?: number;
  vatReferenceAmount?: number;
  vatOpeningBalance?: number;
  onboardingDone?: boolean;
}

export type AiProvider = "anthropic" | "openai" | "github-models" | "ollama";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  mistralApiKey?: string;
}

export interface AiConfigStatus {
  configured: boolean;
  provider?: AiProvider;
  model?: string;
  baseUrl?: string | null;
  apiKeyPreview?: string;
}

export interface Company {
  id: string;
  kind?: "business" | "household" | "ecosystem";
  memberIds?: string[];
  name: string;
  path: string;
  createdAt: string;
}

export interface CategoryBudget {
  category: string;
  monthlyLimit: number;
}

export interface ManualRecurring {
  id: string;
  label: string;
  category: Category;
  amount: number;
  frequency: "mensuel" | "trimestriel" | "annuel";
  nextPayment: string;
  endPayment?: string;
  active: boolean;
  decision?: "keep" | "reduce" | "cancel" | "planned";
  simulatedAmount?: number;
  notes?: string;
}

export type HrContractType = "cdi" | "cdd" | "apprenticeship" | "professionalization" | "internship";
export interface HrEmployee {
  id: string;
  firstName: string;
  lastName: string;
  contractType: HrContractType;
  jobTitle?: string;
  startDate: string;
  endDate?: string;
  trialEndDate?: string;
  medicalVisitDate?: string;
  grossMonthly: number;
  netMonthly: number;
  employerCostMonthly: number;
  includeInForecast: boolean;
  active: boolean;
  notes?: string;
}
export type HrVariableType = "bonus" | "absence" | "leave" | "overtime" | "benefit" | "expense" | "advance" | "other";
export interface HrVariable { id: string; employeeId: string; month: string; type: HrVariableType; label: string; amount: number; quantity?: number; notes?: string; }
export type HrDocumentType = "contract" | "amendment" | "identity" | "medical" | "expense" | "payslip" | "other";
export interface HrDocument { id: string; employeeId: string; type: HrDocumentType; month?: string; originalName: string; storedName: string; uploadedAt: string; transactionId?: string; }
export interface HrDeadline { id: string; employeeId?: string; label: string; date: string; completed: boolean; kind: "contract" | "trial" | "medical" | "document" | "payroll" | "custom"; }
export interface HrPayrollMonth { month: string; status: "draft" | "ready" | "sent"; updatedAt: string; }
export interface HrStore { employees: HrEmployee[]; variables: HrVariable[]; documents: HrDocument[]; deadlines: HrDeadline[]; payrollMonths: HrPayrollMonth[]; }

export interface Tab {
  id: string;
  title: string;
  type: TabType;
  path?: string; // pour les fichiers
  dirty?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
