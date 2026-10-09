export type Category = string;

export interface CategoryDefinition {
  id: Category;
  label: string;
  account: { number: string; label: string };
  kind: "expense" | "revenue" | "both";
  accountingNature?: "profit_loss" | "balance_sheet";
  builtin: boolean;
  active: boolean;
}

export interface VatSplit {
  rate: number;       // taux en % : 0, 2.1, 5.5, 10, 20
  amount_ttc: number; // montant TTC signé
}

export interface Transaction {
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

export type TabType = "editor" | "dashboard" | "structure" | "allocation" | "portfolio" | "personal" | "household" | "import" | "transactions" | "ocr" | "reports" | "recurring" | "invoices" | "quotes" | "settings" | "tiers" | "vat" | "budgets" | "spreadsheets" | "history" | "journal" | "alerts" | "closing" | "annual-closing" | "templates" | "reconcile" | "treasury" | "export" | "profitloss" | "plugins" | "pricing" | "banking" | "users" | "hr";

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
  kind?: "business" | "personal" | "household" | "ecosystem";
  scopeId?: string;
  legalType?: "company" | "sci" | "holding" | "association" | "sole_proprietorship" | "other";
  name: string;
  path: string;
  createdAt: string;
}

export type PlatformRelationType = "family" | "spouse" | "parent" | "child" | "member" | "accountant" | "advisor" | "owner" | "director" | "employee" | "beneficiary" | "shareholder" | "subsidiary" | "management" | "holder" | "uses" | "other";
export interface PlatformPerson { id: string; kind: "person"; name: string; profile: "individual" | "professional"; notes?: string; createdAt: string }
export interface PlatformHousehold { id: string; kind: "household"; name: string; notes?: string; createdAt: string }
export type PlatformLegalType = "company" | "sci" | "holding" | "association" | "sole_proprietorship" | "other";
export type PlatformTaxRegime = "is" | "ir" | "micro" | "non_profit" | "other";
export interface PlatformFiscalPeriod { id: string; startDate: string; endDate: string; label?: string }
export interface PlatformEntity { id: string; kind: "entity"; name: string; workspaceId: string; legalType?: PlatformLegalType; capitalAmount?: number; taxRegime?: PlatformTaxRegime; vatRegime?: "monthly_ca3" | "quarterly_ca3" | "simplified_ca12" | "franchise"; startDate?: string; endDate?: string; fiscalYearStart?: string; fiscalYearEnd?: string; fiscalPeriods?: PlatformFiscalPeriod[]; createdAt: string }
export interface PlatformAccount { id: string; kind: "account"; name: string; currency: string; maskedIdentifier?: string; provider?: string; sourceWorkspaceId: string; sourceAccountId: string; balance?: number; technical?: boolean; createdAt: string }
export interface PlatformRelation { id: string; fromId: string; toId: string; type: PlatformRelationType; label?: string; ownershipPercent?: number; shareCount?: number; ultimateBeneficiaryId?: string; effectiveFrom?: string; effectiveTo?: string; financialLinkType?: "none" | "shareholder_current_account" | "intercompany_loan"; financialAmount?: number; interestRate?: number; source: "manual" | "workspace"; createdAt: string }
export type PlatformAccessRole = "owner" | "manager" | "viewer";
export interface PlatformAccessGrant { id: string; userId: string; scopeId: string; role: PlatformAccessRole; createdAt: string; createdBy: string }
export interface PlatformState { schemaVersion: 1; revision: number; people: PlatformPerson[]; households: PlatformHousehold[]; entities: PlatformEntity[]; accounts: PlatformAccount[]; relations: PlatformRelation[]; grants: PlatformAccessGrant[]; accessInitializedAt?: string; updatedAt: string }
export interface StructureIssue { id: string; scopeId: string; severity: "warning" | "blocking"; code: string; message: string }
export type PlatformLayout = Record<string, { x: number; y: number }>;
export interface AccountingDossier { scopeId: string; name: string; scopeKind: "person" | "household" | "entity"; mode: "personal" | "household" | "full"; workspaceId?: string; legalType?: PlatformLegalType; created: boolean; createdAt?: string; features: string[] }

export type AccountUsage = "personal" | "business" | "shared" | "mixed";
export interface FinanceAllocation { scopeId: string; amount: number }
export interface FinanceScope { id: string; name: string; kind: "person" | "household" | "entity" }
export interface AllocatedTransaction extends Transaction { key: string; platformAccountId: string; accountName: string; sourceWorkspaceId: string; allocations: FinanceAllocation[]; allocationSource: "manual" | "rule" | "account" | "relation" | "unassigned" }
export interface FinanceAllocationSnapshot { month: string; scopes: FinanceScope[]; accounts: Array<PlatformAccount & { usage: AccountUsage; defaultScopeId?: string }>; transactions: AllocatedTransaction[]; rules: Array<{ id: string; pattern: string; scopeId: string }>; unassignedCount: number }

export type PersonalCategory = "personal_income" | "salary_income" | "benefits_income" | "refund_income" | "investment_income" | "housing" | "groceries" | "dining" | "transport" | "health" | "insurance" | "utilities" | "subscriptions" | "leisure" | "shopping" | "education" | "personal_taxes" | "savings" | "family" | "pets" | "personal_misc";
export interface PersonalBudget { category: PersonalCategory; monthlyLimit: number }
export interface PersonalTransaction extends Transaction { key: string; sourceWorkspaceId: string; sourceAccountId: string; accountName: string; personalCategory: PersonalCategory; internalTransfer: boolean; originalAmountTtc?: number }
export interface PersonalFinanceSnapshot {
  person: { id: string; name: string };
  month: string;
  accounts: PlatformAccount[];
  transactions: PersonalTransaction[];
  budgets: PersonalBudget[];
  categories: Array<{ id: PersonalCategory; label: string; kind: "income" | "expense" | "both" }>;
  summary: { balance: number; income: number; expenses: number; net: number; internalTransfers: number };
}

export interface HouseholdTransaction extends AllocatedTransaction { allocatedAmount: number; allocatedScopes: Array<{ scopeId: string; name: string; amount: number }>; internalTransfer: boolean }
export interface HouseholdFinanceSnapshot { household: { id: string; name: string }; month: string; members: Array<{ id: string; name: string; income: number; expenses: number; net: number }>; accounts: PlatformAccount[]; transactions: HouseholdTransaction[]; budgets: PersonalBudget[]; categories: Array<{ id: PersonalCategory; label: string; kind: "income" | "expense" | "both" }>; summary: { balance: number; income: number; expenses: number; net: number; internalTransfers: number } }
export type TransferTreatment = "internal_transfer" | "capital_contribution" | "shareholder_current_account" | "intercompany_loan" | "dividend" | "reimbursement";
export type ForecastScenario = "prudent" | "probable" | "optimistic";
export type CommitmentKind = "supplier_invoice" | "tax" | "loan_payment" | "investment" | "other";
export interface AccountingLine { scopeId: string; accountCode: string; label: string; debit: number; credit: number }
export type TransferWorkflowStatus = "proposed" | "reviewed" | "validated" | "posted" | "cancelled";
export interface TransferWorkflowEvent { at: string; actorId: string; action: "created" | "reviewed" | "validated" | "posted" | "cancelled" | "corrected"; note?: string }
export interface PortfolioTransfer { id: string; kind: "confirmed" | "planned"; sourceScopeId: string; destinationScopeId: string; amount: number; fee?: number; date: string; label: string; treatment: TransferTreatment; sourceTransactionKey?: string; destinationTransactionKey?: string; frequency?: "once" | "monthly"; endDate?: string; accountingLines: AccountingLine[]; workflowStatus: TransferWorkflowStatus; workflowHistory: TransferWorkflowEvent[]; createdAt: string }
export interface PortfolioCommitment { id: string; scopeId: string; kind: CommitmentKind; label: string; amount: number; dueDate: string; frequency: "once" | "monthly" | "quarterly" | "annual"; endDate?: string; createdAt: string }
export interface ScenarioAssumption { revenueMultiplier: number; expenseMultiplier: number; safetyBuffer: number }
export type PortfolioAssumptions = Record<ForecastScenario, ScenarioAssumption>;
export interface ForecastItem { scopeId: string; kind: string; label: string; amount: number; date: string }
export interface ConsolidatedForecastMonth { month: string; openingBalance: number; income: number; expenses: number; transfersIn: number; transfersOut: number; closingBalance: number; items: ForecastItem[] }
export interface PortfolioPosition { scopeId: string; name: string; balance: number; vatReserve: number; commitments90Days: number; available: number }
export interface OwnershipPosition { scopeId: string; name: string; ownershipPercent: number; minorityPercent: number; balance: number; groupShare: number; minorityShare: number }
export interface PortfolioExplanation { id: string; label: string; total: number; lines: Array<{ scopeId?: string; label: string; kind: string; amount: number }> }
export interface PortfolioSnapshot { rootScopeId: string; scopes: FinanceScope[]; suggestedScopeIds: string[]; selectedScopeIds: string[]; balance: number; averageIncome: number; averageExpenses: number; transfers: PortfolioTransfer[]; commitments: PortfolioCommitment[]; assumptions: PortfolioAssumptions; transferCandidates: AllocatedTransaction[]; forecasts: Record<ForecastScenario, ConsolidatedForecastMonth[]>; forecast: ConsolidatedForecastMonth[]; positions: PortfolioPosition[]; timeline: ForecastItem[]; ownership: OwnershipPosition[]; consolidation: { grossBalance: number; groupShareBalance: number; minorityShareBalance: number; eliminatedTransfers: number; eliminatedAmount: number; reciprocalAccounts: Array<{ from: string; to: string; treatment: TransferTreatment; amount: number }> }; explanations: PortfolioExplanation[] }

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
