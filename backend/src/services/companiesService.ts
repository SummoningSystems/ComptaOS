import { readFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import { atomicWriteFileSync } from "./atomicFile.js";

const ROOT = resolve(process.env.WORKSPACE_PATH ?? join(process.cwd(), "..", "workspace"));
const COMPANIES_FILE = join(ROOT, "_companies.json");
const ACTIVE_FILE = join(ROOT, "_active.json");

export interface Company {
  id: string;
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
    return JSON.parse(readFileSync(COMPANIES_FILE, "utf-8")) as Company[];
  } catch {
    return [];
  }
}

function saveCompanies(companies: Company[]): void {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  atomicWriteFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2));
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

/**
 * Retourne le chemin absolu vers le dossier de données de l'entreprise active.
 * Si aucune entreprise n'est configurée, initialise l'entreprise par défaut.
 */
export function getActiveCompanyPath(): string {
  if (_activeCompanyPath) return _activeCompanyPath;

  ensureDefaultCompany();

  const companies = loadCompanies();
  if (companies.length === 0) {
    _activeCompanyPath = ROOT;
    return ROOT;
  }

  const activeId = getActiveCompanyId();
  const company = (activeId ? companies.find((c) => c.id === activeId) : null) ?? companies[0];

  _activeCompanyPath = resolve(ROOT, company.path);
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
export function createCompany(name: string): Company {
  ensureDefaultCompany();

  const id = `co_${Date.now().toString(36)}`;
  const companyRelPath = `companies/${id}`;
  const absPath = join(ROOT, companyRelPath);

  mkdirSync(join(absPath, "transactions"), { recursive: true });
  mkdirSync(join(absPath, "settings"), { recursive: true });
  mkdirSync(join(absPath, "attachments"), { recursive: true });

  const company: Company = {
    id,
    name,
    path: companyRelPath,
    createdAt: new Date().toISOString(),
  };

  const companies = loadCompanies();
  companies.push(company);
  saveCompanies(companies);

  return company;
}
