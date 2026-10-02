import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve, sep } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { workspaceContext } from "./workspaceContext.js";

const ROOT = resolve(process.env.WORKSPACE_PATH ?? join(process.cwd(), "..", "workspace"));
const COMPANIES_FILE = join(ROOT, "_companies.json");
const ACTIVE_FILE = join(ROOT, "_active.json");

export interface Company {
  id: string;
  /** Compatibilité avec les registres créés par l'ancienne branche expérimentale. */
  kind?: "business" | "household" | "ecosystem";
  legalType?: "company" | "sci" | "holding";
  ecosystemId?: string;
  memberIds?: string[];
  name: string;
  /** Chemin relatif depuis ROOT vers le dossier de l'entreprise (ex: "." ou "companies/co_abc123") */
  path: string;
  createdAt: string;
}

/** Cache en mémoire pour éviter une lecture disque à chaque requête */
let _activeCompanyPath: string | null = null;

export function getCompaniesRoot(): string {
  return ROOT;
}

export function loadCompanies(): Company[] {
  if (!existsSync(COMPANIES_FILE)) return [];
  try {
    const entries = JSON.parse(readFileSync(COMPANIES_FILE, "utf-8")) as Company[];
    return Array.isArray(entries)
      ? entries.filter((entry) => entry?.kind !== "ecosystem" && entry?.kind !== "household")
      : [];
  } catch {
    return [];
  }
}

function saveCompanies(companies: Company[]): void {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  let metadataEntries: Company[] = [];
  if (existsSync(COMPANIES_FILE)) {
    try {
      const entries = JSON.parse(readFileSync(COMPANIES_FILE, "utf-8")) as Company[];
      metadataEntries = Array.isArray(entries)
        ? entries.filter((entry) => entry?.kind === "ecosystem" || entry?.kind === "household")
        : [];
    } catch { /* le prochain enregistrement répare le registre */ }
  }
  atomicWriteFileSync(COMPANIES_FILE, JSON.stringify([...companies, ...metadataEntries], null, 2));
}

export function getActiveCompanyId(): string | null {
  if (!existsSync(ACTIVE_FILE)) return null;
  try {
    return (JSON.parse(readFileSync(ACTIVE_FILE, "utf-8")) as { companyId: string }).companyId ?? null;
  } catch {
    return null;
  }
}

export function setActiveCompanyId(companyId: string): void {
  atomicWriteFileSync(ACTIVE_FILE, JSON.stringify({ companyId }, null, 2));
  _activeCompanyPath = null; // invalider le cache
}

export function invalidateActiveCompanyCache(): void {
  _activeCompanyPath = null;
}

export function resolveCompanyPath(company: Company): string {
  const candidate = resolve(ROOT, company.path);
  const prefix = ROOT.endsWith(sep) ? ROOT : `${ROOT}${sep}`;
  if (candidate !== ROOT && !candidate.startsWith(prefix)) throw new Error("Chemin d'entreprise hors du workspace.");
  return candidate;
}

/**
 * Retourne le chemin absolu vers le dossier de données de l'entreprise active.
 * Si aucune entreprise n'est configurée, initialise l'entreprise par défaut.
 */
export function getActiveCompanyPath(): string {
  const scoped = workspaceContext.getStore();
  if (scoped) return scoped.root;
  if (_activeCompanyPath) return _activeCompanyPath;

  ensureDefaultCompany();

  const companies = loadCompanies();
  if (companies.length === 0) {
    _activeCompanyPath = ROOT;
    return ROOT;
  }

  const activeId = getActiveCompanyId();
  const company = (activeId ? companies.find((c) => c.id === activeId) : null) ?? companies[0];

  _activeCompanyPath = resolveCompanyPath(company);
  return _activeCompanyPath;
}

/**
 * Si aucune entreprise n'existe, crée l'entreprise par défaut pointant vers
 * le dossier workspace existant — migration sans déplacement de données.
 */
export function ensureDefaultCompany(): void {
  if (existsSync(COMPANIES_FILE)) return;

  const defaultCompany: Company = {
    id: "default",
    name: "Mon entreprise",
    path: ".", // données existantes à la racine du workspace
    createdAt: new Date().toISOString(),
  };

  saveCompanies([defaultCompany]);
  setActiveCompanyId("default");
}

/** Crée une nouvelle entreprise avec son arborescence de dossiers. */
export function createCompany(name: string, legalType: Company["legalType"] = "company"): Company {
  ensureDefaultCompany();

  const id = `co_${Date.now().toString(36)}`;
  const companyRelPath = `companies/${id}`;
  const absPath = join(ROOT, companyRelPath);

  mkdirSync(join(absPath, "transactions"), { recursive: true });
  mkdirSync(join(absPath, "settings"), { recursive: true });
  mkdirSync(join(absPath, "attachments"), { recursive: true });

  const company: Company = {
    id,
    kind: "business",
    legalType,
    name,
    path: companyRelPath,
    createdAt: new Date().toISOString(),
  };

  const companies = loadCompanies();
  companies.push(company);
  saveCompanies(companies);

  return company;
}
