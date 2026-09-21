export interface Person { id: string; name: string }
export interface FinanceContext { id: string; name: string; kind: "shared" | "personal" | "activity"; personId?: string }
export interface HouseholdAccount { id: string; name: string; ownerIds: string[]; defaultContextId: string; currency: "EUR"; purpose: "personal" | "professional" | "bills" | "daily"; archived?: boolean; opening?: { date: string; cents: number } }
export interface Allocation { contextId: string; category: string; cents: number }
export interface HouseholdTransaction { id: string; accountId: string; date: string; label: string; cents: number; currency: "EUR"; allocations: Allocation[]; reviewed: boolean; nature: "income" | "expense" | "refund"; notes: string; revision: number; updatedAt: string; updatedBy: string; deleted?: boolean; attachments: { id: string; name: string; mime: string }[]; source?: { format: string; batchId: string; row: number; externalId?: string; label: string; date: string; cents: number } }
export interface Transfer { id: string; fromId: string; toId?: string }
export interface HouseholdBudget { id: string; contextId: string; category: string; cents: number }
export interface HouseholdRecurring { id: string; label: string; accountId: string; cents: number; allocations: Allocation[]; frequency: "monthly" | "quarterly" | "yearly"; nextDate: string; active: boolean }
export interface Change { at: string; actor: string; action: string; recordId?: string; before?: unknown; after?: unknown }
export interface ImportBatch { id: string; accountId: string; imported: number; skipped: number; at: string }
export interface HouseholdState { schemaVersion: 1; revision: number; people: Person[]; contexts: FinanceContext[]; accounts: HouseholdAccount[]; transactions: HouseholdTransaction[]; transfers: Transfer[]; budgets: HouseholdBudget[]; recurring: HouseholdRecurring[]; imports: ImportBatch[]; history: Change[] }
export interface ImportRow { index: number; date: string; label: string; cents: number; externalId?: string; duplicate: "definite" | "possible" | null }
export interface HouseholdImport { format: "csv" | "ofx" | "qif"; content: string; accountId: string; mapping?: { date: string; label: string; amount?: string; debit?: string; credit?: string; externalId?: string }; selectedRows?: number[] }
export interface HouseholdSummary { income: number; expenses: number; net: number; reviewCount: number; categories: { category: string; cents: number }[]; balances: { accountId: string; movement: number; balance: number | null }[]; contributions: { personId: string; paid: number; returned: number; net: number }[] }
