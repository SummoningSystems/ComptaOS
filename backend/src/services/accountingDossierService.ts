import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync } from "./atomicFile.js";
import { ensureScopedWorkspace, getCompaniesRoot } from "./companiesService.js";
import { actorHasGlobalAccess, getScopeAccess, getVisiblePlatformState } from "./platformService.js";
import type { RequestActor } from "./requestActor.js";

export type AccountingDossierMode = "personal" | "household" | "full";
export interface AccountingDossier {
  scopeId: string;
  name: string;
  scopeKind: "person" | "household" | "entity";
  mode: AccountingDossierMode;
  workspaceId?: string;
  legalType?: "company" | "sci" | "holding";
  created: boolean;
  createdAt?: string;
  features: string[];
}
interface StoredDossier { scopeId: string; mode: "personal" | "household"; workspaceId?: string; createdAt: string }
interface DossierStore { schemaVersion: 1; dossiers: StoredDossier[] }

const file = () => join(getCompaniesRoot(), "_accounting_dossiers.json");
function readStore(): DossierStore {
  if (!existsSync(file())) return { schemaVersion: 1, dossiers: [] };
  try { const parsed = JSON.parse(readFileSync(file(), "utf-8")) as Partial<DossierStore>; return { schemaVersion: 1, dossiers: parsed.dossiers ?? [] }; }
  catch { return { schemaVersion: 1, dossiers: [] }; }
}
const features = (mode: AccountingDossierMode) => mode === "full"
  ? ["Transactions", "Justificatifs", "Journal", "TVA", "Rapprochement", "Clôture", "Bilan", "FEC"]
  : mode === "household" ? ["Transactions communes", "Budgets", "Membres", "Comptes partagés", "Consolidation"]
    : ["Transactions personnelles", "Catégories", "Budgets", "Comptes", "Synthèse mensuelle"];

export function getAccountingDossiers(actor: RequestActor): AccountingDossier[] {
  const state = getVisiblePlatformState(actor); const stored = new Map(readStore().dossiers.map((item) => [item.scopeId, item]));
  return [
    ...state.people.map((scope) => ({ scopeId: scope.id, name: scope.name, scopeKind: "person" as const, mode: "personal" as const, workspaceId: stored.get(scope.id)?.workspaceId, created: stored.has(scope.id), createdAt: stored.get(scope.id)?.createdAt, features: features("personal") })),
    ...state.households.map((scope) => ({ scopeId: scope.id, name: scope.name, scopeKind: "household" as const, mode: "household" as const, workspaceId: stored.get(scope.id)?.workspaceId, created: stored.has(scope.id), createdAt: stored.get(scope.id)?.createdAt, features: features("household") })),
    ...state.entities.map((scope) => ({ scopeId: scope.id, name: scope.name, scopeKind: "entity" as const, mode: "full" as const, workspaceId: scope.workspaceId, legalType: scope.legalType, created: true, createdAt: scope.createdAt, features: features("full") })),
  ];
}

export function ensureAccountingDossier(scopeId: string, actor: RequestActor): AccountingDossier {
  const dossier = getAccountingDossiers(actor).find((item) => item.scopeId === scopeId);
  if (!dossier) throw Object.assign(new Error("Périmètre comptable inaccessible."), { code: "NOT_FOUND" });
  if (!actorHasGlobalAccess(actor) && !["owner", "manager"].includes(getScopeAccess(actor, scopeId) ?? "")) throw Object.assign(new Error("Droits de gestion requis sur ce périmètre."), { code: "FORBIDDEN" });
  if (dossier.mode === "full") return dossier;
  const store = readStore(); const stored = store.dossiers.find((item) => item.scopeId === scopeId); const createdAt = stored?.createdAt ?? new Date().toISOString();
  const workspace = ensureScopedWorkspace(scopeId, dossier.name, dossier.mode);
  if (stored) stored.workspaceId = workspace.id; else store.dossiers.push({ scopeId, mode: dossier.mode, workspaceId: workspace.id, createdAt });
  atomicWriteFileSync(file(), JSON.stringify(store, null, 2));
  return { ...dossier, workspaceId: workspace.id, created: true, createdAt };
}
