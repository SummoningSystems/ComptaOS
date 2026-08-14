export type Category = string;

export interface CategoryDefinition {
  id: Category;
  label: string;
  account: { number: string; label: string };
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
  forecast: { month: string; balance: number; projected?: boolean }[];
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

export type TabType = "editor" | "dashboard" | "import" | "transactions" | "ocr" | "reports" | "recurring" | "invoices" | "quotes" | "settings" | "tiers" | "vat" | "budgets" | "spreadsheets" | "history" | "journal" | "alerts" | "closing" | "templates" | "reconcile" | "treasury" | "export" | "profitloss" | "plugins" | "pricing" | "banking" | "users";

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
  active: boolean;
  decision?: "keep" | "reduce" | "cancel" | "planned";
  simulatedAmount?: number;
  notes?: string;
}

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
