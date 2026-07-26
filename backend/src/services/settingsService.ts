import { readFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { Category } from "../types/index.js";
import { getActiveCompanyPath } from "./companiesService.js";
import { atomicWriteFileSync } from "./atomicFile.js";

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
