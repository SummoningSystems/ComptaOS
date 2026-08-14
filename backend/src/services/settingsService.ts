import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { Category } from "../types/index.js";
import { getActiveCompanyPath } from "./companiesService.js";
import { atomicWriteFileSync } from "./atomicFile.js";
import { BUILTIN_CATEGORIES, loadCategoryCatalog } from "./categoryCatalogService.js";

function getSettingsDir(): string {
  return join(getActiveCompanyPath(), "settings");
}

function ensureDir() {
  const d = getSettingsDir();
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

// ── Category rules ────────────────────────────────────────────────────────────

export interface CategoryRule {
  id: string;
  pattern: string; // sous-chaîne, case-insensitive
  category: Category;
}

export function loadCategoryRules(): CategoryRule[] {
  const file = join(getSettingsDir(), "category_rules.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as CategoryRule[];
  } catch {
    return [];
  }
}

export function saveCategoryRules(rules: CategoryRule[]): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "category_rules.json"), JSON.stringify(rules, null, 2));
}

export function applyCategoryRules(label: string, rules: CategoryRule[]): Category | null {
  const lower = label.toLowerCase();
  for (const rule of rules) {
    if (lower.includes(rule.pattern.toLowerCase())) return rule.category as Category;
  }
  return null;
}

// ── Treasury alert ────────────────────────────────────────────────────────────

export interface TreasuryAlert {
  threshold: number;
  enabled: boolean;
}

export function loadTreasuryAlert(): TreasuryAlert {
  const file = join(getSettingsDir(), "treasury_alert.json");
  if (!existsSync(file)) return { threshold: 5000, enabled: false };
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as TreasuryAlert;
  } catch {
    return { threshold: 5000, enabled: false };
  }
}

export function saveTreasuryAlert(alert: TreasuryAlert): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "treasury_alert.json"), JSON.stringify(alert, null, 2));
}

// ── AI config ──────────────────────────────────────────────────

export type AiProvider = "anthropic" | "openai" | "github-models" | "ollama";

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  mistralApiKey?: string; // clé dédiée pour l'OCR via Mistral
}

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-4o-mini",
  "github-models": "gpt-4o-mini",
  ollama: "llama3.2",
};

export function loadAiConfig(): AiConfig | null {
  const file = join(getSettingsDir(), "ai_config.json");
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf-8")) as AiConfig;
    } catch {
      // fall through
    }
  }
  // Fallback: variables d'environnement (compatibilité descendante)
  if (process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: DEFAULT_MODELS.anthropic };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: "openai", apiKey: process.env.OPENAI_API_KEY, model: DEFAULT_MODELS.openai };
  }
  if (process.env.GITHUB_TOKEN) {
    return { provider: "github-models", apiKey: process.env.GITHUB_TOKEN, model: DEFAULT_MODELS["github-models"] };
  }
  return null;
}

export function saveAiConfig(config: AiConfig): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "ai_config.json"), JSON.stringify(config, null, 2));
}

export { DEFAULT_MODELS };

// ── Budgets par catégorie ─────────────────────────────────────────────────────

export interface CategoryBudget {
  category: string;
  monthlyLimit: number; // euros TTC par mois
}

export function loadBudgets(): CategoryBudget[] {
  const file = join(getSettingsDir(), "budgets.json");
  if (!existsSync(file)) return [];
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as CategoryBudget[];
  } catch {
    return [];
  }
}

export function saveBudgets(budgets: CategoryBudget[]): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "budgets.json"), JSON.stringify(budgets, null, 2));
}

// ── Profil entreprise ─────────────────────────────────────────────────────────

export interface CompanyProfile {
  name: string;
  legalForm?: string;       // SAS, SARL, Auto-entrepreneur…
  siren?: string;
  vatNumber?: string;       // numéro TVA intracommunautaire
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

export function loadCompanyProfile(): CompanyProfile {
  const file = join(getSettingsDir(), "company_profile.json");
  if (!existsSync(file)) return { name: "" };
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as CompanyProfile;
  } catch {
    return { name: "" };
  }
}

export function saveCompanyProfile(profile: CompanyProfile): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "company_profile.json"), JSON.stringify(profile, null, 2));
}

export interface MerchantRule {
  id: string;
  pattern: string;
  category?: Category;
  vatRate?: number;
  learnedAt: string;
  sourceLabel: string;
}

export function merchantPattern(label: string): string {
  return label.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/\b(cb|card|payment|paiement|facture|mandat|sepa)\b/g, " ").replace(/\d+/g, " ").replace(/[^a-z\s]/g, " ").split(/\s+/).filter((word) => word.length >= 3).slice(0, 3).join(" ");
}

export function loadMerchantRules(): MerchantRule[] {
  const file = join(getSettingsDir(), "merchant_rules.json");
  if (!existsSync(file)) return [];
  try { const value = JSON.parse(readFileSync(file, "utf-8")); return Array.isArray(value) ? value as MerchantRule[] : []; } catch { return []; }
}

export function learnMerchantRule(label: string, patch: { category?: Category; vatRate?: number }): MerchantRule | null {
  const pattern = merchantPattern(label);
  if (!pattern || (!patch.category && patch.vatRate === undefined)) return null;
  const rules = loadMerchantRules();
  const existing = rules.find((rule) => rule.pattern === pattern);
  const rule: MerchantRule = {
    id: existing?.id ?? `merchant_${Buffer.from(pattern).toString("hex").slice(0, 20)}`,
    pattern,
    category: patch.category ?? existing?.category,
    vatRate: patch.vatRate ?? existing?.vatRate,
    learnedAt: new Date().toISOString(),
    sourceLabel: label,
  };
  ensureDir();
  saveMerchantRules([rule, ...rules.filter((item) => item.pattern !== pattern)]);
  return rule;
}

export function saveMerchantRules(rules: MerchantRule[]): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "merchant_rules.json"), JSON.stringify(rules, null, 2));
}

export interface AccountingAccount {
  number: string;
  label: string;
}

export interface AccountingConfig {
  bank: AccountingAccount;
  revenue: AccountingAccount;
  vatDeductible: AccountingAccount;
  vatCollected: AccountingAccount;
  categories: Record<Category, AccountingAccount>;
}

const LEGACY_CATEGORY_ACCOUNTS: Record<Category, AccountingAccount> = {
  hosting: { number: "626000", label: "Frais postaux et télécommunications" },
  software: { number: "615600", label: "Maintenance et logiciels" },
  salary: { number: "641000", label: "Rémunérations du personnel" },
  subcontracting: { number: "611000", label: "Sous-traitance générale" },
  professional_fees: { number: "622600", label: "Honoraires" },
  external_services: { number: "628000", label: "Autres services extérieurs" },
  travel: { number: "625100", label: "Voyages et déplacements" },
  restaurant: { number: "625700", label: "Réceptions" },
  food: { number: "625700", label: "Réceptions" },
  taxes: { number: "635000", label: "Autres impôts et taxes" },
  equipment: { number: "606300", label: "Petit équipement" },
  subscription: { number: "628100", label: "Cotisations" },
  rent: { number: "613200", label: "Locations immobilières" },
  legal: { number: "622600", label: "Honoraires" },
  insurance: { number: "616000", label: "Primes d'assurances" },
  misc: { number: "658000", label: "Charges diverses de gestion courante" },
};

const DEFAULT_CATEGORY_ACCOUNTS: Record<Category, AccountingAccount> = Object.fromEntries(
  BUILTIN_CATEGORIES.map((category) => [category.id, category.account]),
);

export function defaultAccountingConfig(): AccountingConfig {
  return {
    bank: { number: "512100", label: "Banque" },
    revenue: { number: "706000", label: "Prestations de services" },
    vatDeductible: { number: "445660", label: "TVA déductible sur autres biens et services" },
    vatCollected: { number: "445710", label: "TVA collectée" },
    categories: structuredClone(DEFAULT_CATEGORY_ACCOUNTS),
  };
}

export function loadAccountingConfig(): AccountingConfig {
  const defaults = defaultAccountingConfig();
  const file = join(getSettingsDir(), "accounting_config.json");
  if (!existsSync(file)) return defaults;
  try {
    const saved = JSON.parse(readFileSync(file, "utf-8")) as Partial<AccountingConfig>;
    const mergeAccount = (fallback: AccountingAccount, value: unknown): AccountingAccount => {
      if (!value || typeof value !== "object") return fallback;
      const candidate = value as Partial<AccountingAccount>;
      return { number: typeof candidate.number === "string" ? candidate.number : fallback.number, label: typeof candidate.label === "string" ? candidate.label : fallback.label };
    };
    const categories = { ...defaults.categories };
    for (const definition of loadCategoryCatalog()) categories[definition.id] = mergeAccount(definition.account, saved.categories?.[definition.id]);
    for (const category of Object.keys(saved.categories ?? {})) {
      const savedAccount = saved.categories?.[category];
      if (savedAccount) categories[category] = mergeAccount(categories[category] ?? savedAccount, savedAccount);
    }
    return {
      bank: mergeAccount(defaults.bank, saved.bank),
      revenue: mergeAccount(defaults.revenue, saved.revenue),
      vatDeductible: mergeAccount(defaults.vatDeductible, saved.vatDeductible),
      vatCollected: mergeAccount(defaults.vatCollected, saved.vatCollected),
      categories,
    };
  } catch {
    return defaults;
  }
}

export function saveAccountingConfig(config: AccountingConfig): void {
  ensureDir();
  atomicWriteFileSync(join(getSettingsDir(), "accounting_config.json"), JSON.stringify(config, null, 2));
}
