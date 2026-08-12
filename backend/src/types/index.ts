export interface VatSplit {
  rate: number;       // taux en % : 0, 2.1, 5.5, 10, 20
  amount_ttc: number; // montant TTC (signe = signe de la transaction)
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

export type Category =
  | "hosting"
  | "software"
  | "salary"
  | "travel"
  | "restaurant"
  | "food"
  | "taxes"
  | "equipment"
  | "subscription"
  | "rent"
  | "legal"
  | "insurance"
  | "misc";

export interface WorkspaceSettings {
  name: string;
  currency: string;
  vat_default_rate: number;
  fiscal_year_start: string;
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
  /** Somme des mouvements non rejetes; ce n'est pas un solde bancaire. */
  transaction_flow: number;
  /** Somme des derniers soldes remontes par les connexions bancaires. */
  bank_balance?: number;
  bank_balance_updated_at?: string;
  balance_difference?: number;
  bank_accounts: {
    id: string;
    name: string;
    currency: string;
    balance: number;
    updated_at?: string;
  }[];
  top_categories: { category: string; amount: number }[];
  // ── Nouveaux KPIs ──────────────────────────────────────────
  net_result: number;        // CA - charges (cumul)
  is_estimate: number;       // IS 25% si bénéfice
  runway_months: number;     // trésorerie / dépenses moy. 3 derniers mois
  misc_count: number;        // transactions non catégorisées
  unjustified_count: number; // transactions sans justificatif
  current_year: string;
  monthly_balance: { month: string; amount: number }[];
  forecast: { month: string; balance: number; projected?: boolean }[];
  accounts: string[];
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
  invoiceId?: string;
}

export interface TreasuryAlert {
  threshold: number;
  enabled: boolean;
}

export interface CsvMappingConfig {
  date: string;
  label: string;
  amount?: string;
  debit?: string;
  credit?: string;
  /** Colonne utilisée comme note (ex: Tiers / contrepartie) */
  notes?: string;
  /** Colonne État — les lignes valant "Transaction rejetée" sont ignorées */
  status_col?: string;
  /** Colonne catégorie Penylane → mapped vers nos catégories */
  category_col?: string;
  /** Colonne compte bancaire (ex: "Compte Bancaire") */
  account_col?: string;
  /** Colonne tiers / contrepartie utilisée pour invoiceRef */
  tiers_col?: string;
}
