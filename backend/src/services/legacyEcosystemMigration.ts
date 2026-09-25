import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Ecosystem, Entity, Feed, Movement, Relation, Treatment } from "../types/ecosystem.js";
import type { Transaction } from "../types/index.js";
import { getConnections, getConfig, type BankAccount, type BankConnection } from "./bankingService.js";
import { loadCompanies, resolveCompanyPath, type Company } from "./companiesService.js";
import { ecosystemRoot, loadEcosystem, mutateEcosystem, requireAdmin } from "./ecosystemService.js";
import { atomicWriteFile } from "./atomicFile.js";
import { actorContext, workspaceContext } from "./workspaceContext.js";
import { loadAllTransactions } from "./transactionService.js";
import { fail } from "./householdService.js";

type LegacyAccount = BankAccount & { connectionId?: number; connectorName?: string };
type LegacySnapshot = { company: Company; transactions: Transaction[]; connections: BankConnection[] };

export interface LegacyMigrationPreview {
  available: boolean;
  candidates: Array<{ id: string; name: string; transactions: number; activeTransactions: number; rejectedTransactions: number; attachments: number; bankAccounts: number }>;
  totals: { transactions: number; activeTransactions: number; rejectedTransactions: number; attachments: number; bankAccounts: number };
  bankProfileReusable: boolean;
  notes: string[];
}

const stableId = (prefix: string, value: string) => `${prefix}-${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
const actor = () => actorContext.getStore() ?? { id: "local", role: "owner" };
const attachmentCount = (transactions: Transaction[]) => new Set(transactions.flatMap(t => [t.attachment, ...(t.attachments ?? []), ...(t.attachment_details ?? []).map(a => a.filename)].filter((v): v is string => Boolean(v)))).size;

function eligibleCompanies(ecosystemId: string): Company[] {
  return loadCompanies().filter(company => company.id !== ecosystemId && company.kind !== "ecosystem" && company.kind !== "household" && !company.ecosystemId);
}

async function snapshot(company: Company): Promise<LegacySnapshot> {
  const context = { id: company.id, root: resolveCompanyPath(company), kind: "business" as const, actor: actor().id, role: actor().role };
  return workspaceContext.run(context, async () => ({
    company,
    transactions: await loadAllTransactions(),
    connections: await getConnections().catch(() => []),
  }));
}

async function snapshots(ecosystemId: string): Promise<LegacySnapshot[]> {
  const result: LegacySnapshot[] = [];
  for (const company of eligibleCompanies(ecosystemId)) result.push(await snapshot(company));
  return result;
}

export async function previewLegacyMigration(ecosystemId: string): Promise<LegacyMigrationPreview> {
  requireAdmin();
  await loadEcosystem(ecosystemId);
  const sources = await snapshots(ecosystemId);
  const config = await getConfig().catch(() => null);
  const candidates = sources.map(({ company, transactions, connections }) => ({
    id: company.id,
    name: company.name,
    transactions: transactions.length,
    activeTransactions: transactions.filter(t => t.status !== "rejected").length,
    rejectedTransactions: transactions.filter(t => t.status === "rejected").length,
    attachments: attachmentCount(transactions),
    bankAccounts: connections.flatMap(c => c.accounts).length,
  }));
  const total = (key: keyof Omit<LegacyMigrationPreview["candidates"][number], "id" | "name">) => candidates.reduce((sum, item) => sum + item[key], 0);
  return {
    available: candidates.length > 0,
    candidates,
    totals: { transactions: total("transactions"), activeTransactions: total("activeTransactions"), rejectedTransactions: total("rejectedTransactions"), attachments: total("attachments"), bankAccounts: total("bankAccounts") },
    bankProfileReusable: Boolean(config?.userToken),
    notes: [
      "Les dossiers historiques restent à leur emplacement : aucun justificatif n’est recopié.",
      "Les opérations rejetées restent dans la sauvegarde historique et sont exclues des flux actifs.",
      config?.userToken ? "Le profil PSD2 existant pourra être repris." : "Une reconnexion bancaire pourra être nécessaire si aucun jeton Powens réutilisable n’est disponible.",
    ],
  };
}

function legacyAccounts(source: LegacySnapshot): LegacyAccount[] {
  return source.connections.flatMap(connection => connection.accounts.map(account => ({ ...account, connectionId: connection.connectionId, connectorName: connection.connectorName })));
}

function accountEntityId(companyId: string, key: string) { return stableId("legacy-account", companyId + ":" + key); }

function buildSnapshotMigration(state: Ecosystem, sources: LegacySnapshot[]) {
  const entities: Entity[] = [];
  const relations: Relation[] = [];
  const movements: Movement[] = [];
  const treatments: Treatment[] = [];
  const feeds: Feed[] = [];
  const ownerId = stableId("legacy-person", actor().id);
  const ownerName = actor().id === "local" ? "Propriétaire" : "Utilisateur principal";
  if (!state.entities.some(e => e.id === ownerId)) entities.push({ id: ownerId, kind: "person", name: ownerName, revision: 1 });

  for (const source of sources) {
    const companyId = stableId("legacy-company", source.company.id);
    const companyEntity: Entity = { id: companyId, kind: "company", name: source.company.name, companyType: "Entreprise", accountingEnabled: true, vatEnabled: true, workspaceId: source.company.id, revision: 1 };
    entities.push(companyEntity);
    relations.push({ id: stableId("legacy-relation", ownerId + ":activity:" + companyId), from: ownerId, to: companyId, kind: "activity" });

    const known = legacyAccounts(source);
    const transactionKeys = [...new Set(source.transactions.map(t => String(t.account ?? "").trim()).filter(Boolean))];
    const accountKeys = new Set(known.map(a => String(a.id)));
    if (known.length !== 1) transactionKeys.forEach(key => accountKeys.add(key));
    if (!accountKeys.size) accountKeys.add("historical");
    const accountByKey = new Map<string, string>();
    for (const key of accountKeys) {
      const metadata = known.find(a => String(a.id) === key);
      const accountId = accountEntityId(source.company.id, key);
      accountByKey.set(key, accountId);
      const dates = source.transactions.filter(t => !t.account || String(t.account) === key).map(t => t.date).sort();
      entities.push({ id: accountId, kind: "account", name: metadata?.name || (key === "historical" ? `Compte historique · ${source.company.name}` : `Compte ${key} · ${source.company.name}`), usage: "Professionnel", bankIdentifier: metadata?.iban?.replace(/\s/g, "").toUpperCase(), defaultTarget: companyId, treasuryAssignments: [{ companyId, from: dates[0] ?? "1900-01-01" }], revision: 1 });
      relations.push({ id: stableId("legacy-relation", ownerId + ":holder:" + accountId), from: ownerId, to: accountId, kind: "holder" });
      relations.push({ id: stableId("legacy-relation", accountId + ":usage:" + companyId), from: accountId, to: companyId, kind: "usage" });
      if (metadata?.connectionId !== undefined) feeds.push({ id: stableId("legacy-feed", source.company.id + ":" + metadata.id), ownerId: actor().id, connectionId: metadata.connectionId, providerAccountId: metadata.id, accountId, name: metadata.name || metadata.connectorName || `Compte ${metadata.id}`, balance: Number.isFinite(metadata.balance) ? Math.round(metadata.balance! * 100) : undefined, balanceAt: metadata.balanceUpdatedAt, lastSync: metadata.lastSyncAt });
    }
    if (known.length === 1) for (const key of transactionKeys) accountByKey.set(key, accountEntityId(source.company.id, String(known[0].id)));
    const fallbackAccount = accountByKey.size === 1 ? [...accountByKey.values()][0] : accountByKey.get("historical") ?? (() => {
      const id = accountEntityId(source.company.id, "unassigned");
      entities.push({ id, kind: "account", name: `Compte à identifier · ${source.company.name}`, usage: "Professionnel", defaultTarget: companyId, treasuryAssignments: [{ companyId, from: "1900-01-01" }], revision: 1 });
      relations.push({ id: stableId("legacy-relation", ownerId + ":holder:" + id), from: ownerId, to: id, kind: "holder" }, { id: stableId("legacy-relation", id + ":usage:" + companyId), from: id, to: companyId, kind: "usage" });
      return id;
    })();

    for (const transaction of source.transactions) {
      if (transaction.status === "rejected") continue;
      const movementId = stableId("legacy-movement", source.company.id + ":" + transaction.id);
      const allocationId = stableId("legacy-allocation", movementId);
      const cents = Math.round(transaction.amount_ttc * 100);
      const key = String(transaction.account ?? "").trim();
      const accountId = accountByKey.get(key) ?? fallbackAccount;
      const powensId = /^bank_powens_(\d+)$/.exec(transaction.id)?.[1];
      const numericAccountId = Number(key);
      const providerAccountId = Number.isFinite(numericAccountId) ? numericAccountId : known.length === 1 ? known[0].id : Number.NaN;
      const nature = cents >= 0 ? (transaction.accountingTreatment === "expense_refund" || transaction.accountingTreatment === "supplier_advance_refund" ? "refund" : "income") : "expense";
      const sourceInfo = powensId && Number.isFinite(providerAccountId)
        ? { provider: "powens", key: `${actor().id}:${providerAccountId}:${powensId}`, raw: { migratedFrom: transaction.id } }
        : { provider: "legacy", key: `${source.company.id}:${transaction.id}`, raw: { workspaceId: source.company.id, transactionId: transaction.id } };
      movements.push({ id: movementId, accountId, date: transaction.date, label: transaction.label, cents, currency: "EUR", allocations: [{ id: allocationId, target: companyId, category: transaction.category, cents }], revision: 1, reviewed: transaction.status === "validated", nature, notes: transaction.notes ?? "", tags: transaction.tags, source: sourceInfo });
      treatments.push({ companyId, movementId, allocationId, transaction: { ...structuredClone(transaction), revision: transaction.revision ?? 1, sourceAllocation: { ecosystemId: state.id, movementId, allocationId } } });
    }
  }
  return { entities, relations, movements, treatments, feeds };
}

async function adoptBankProfile(ecosystemId: string): Promise<boolean> {
  const config = await getConfig().catch(() => null);
  if (!config?.userToken) return false;
  const root = ecosystemRoot(ecosystemId);
  const file = path.join(root, ".powens_profiles.json");
  const current = JSON.parse(await fs.readFile(file, "utf8").catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "{}";
    throw error;
  })) as Record<string, unknown>;
  current[actor().id] = { token: config.userToken, configKey: createHash("sha256").update(config.domain + config.clientId + config.clientSecret).digest("hex") };
  await atomicWriteFile(file, JSON.stringify(current));
  await fs.chmod(file, 0o600).catch(() => undefined);
  return true;
}

export async function migrateLegacyToEcosystem(ecosystemId: string, revision: number): Promise<{ state: Ecosystem; report: LegacyMigrationPreview & { bankProfileMigrated: boolean } }> {
  requireAdmin();
  const before = await loadEcosystem(ecosystemId);
  if (before.revision !== revision) fail("Cet espace a été modifié. Rechargez avant de lancer la migration.", 409);
  const sources = await snapshots(ecosystemId);
  if (!sources.length) fail("Aucun espace historique non migré n’a été trouvé.", 409);
  const preview = await previewLegacyMigration(ecosystemId);
  const root = ecosystemRoot(ecosystemId);
  await fs.writeFile(path.join(root, "legacy-migration.ecosystem.backup.json"), JSON.stringify(before), { flag: "wx", mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  await fs.writeFile(path.join(root, "legacy-migration.registry.backup.json"), JSON.stringify(loadCompanies()), { flag: "wx", mode: 0o600 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; });
  const built = buildSnapshotMigration(before, sources);
  await mutateEcosystem(ecosystemId, revision, "legacy-workspace-migration", state => {
    state.entities.push(...built.entities.filter(entity => !state.entities.some(existing => existing.id === entity.id)));
    state.relations.push(...built.relations.filter(relation => !state.relations.some(existing => existing.id === relation.id)));
    state.movements.push(...built.movements.filter(movement => !state.movements.some(existing => existing.id === movement.id || existing.source?.provider === movement.source?.provider && existing.source?.key === movement.source?.key)));
    state.treatments.push(...built.treatments.filter(treatment => !state.treatments.some(existing => existing.transaction.id === treatment.transaction.id || existing.movementId === treatment.movementId)));
    state.feeds.push(...built.feeds.filter(feed => !state.feeds.some(existing => existing.ownerId === feed.ownerId && existing.providerAccountId === feed.providerAccountId)));
    return { workspaces: sources.map(source => source.company.id), transactions: built.movements.length, bankAccounts: built.feeds.length };
  });
  const bankProfileMigrated = await adoptBankProfile(ecosystemId);
  const state = await loadEcosystem(ecosystemId);
  return { state, report: { ...preview, bankProfileMigrated } };
}
