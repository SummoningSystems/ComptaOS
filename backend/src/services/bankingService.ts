/**
 * Service d'Open Banking via Powens (ex Budget Insight)
 * Doc : https://docs.powens.com
 *
 * Flux :
 *  1. POST /auth/init → userToken permanent (une seule fois, stocké dans config)
 *  2. GET  /auth/token/code → code temporaire
 *  3. Ouvrir webview.powens.com/connect?domain=...&client_id=...&code=...&redirect_uri=...
 *  4. Powens redirige vers redirectUri?connection_id={id} après auth bancaire
 *  5. POST /api/banking/refresh → refreshConnections() → liste des connexions + comptes
 *  6. GET  /users/me/accounts/{id}/transactions → import transactions
 */

import fs from "fs/promises";
import path from "path";
import { getWorkspaceRoot } from "./fileSystem.js";
import { getCompaniesRoot } from "./companiesService.js";
import { atomicWriteFile } from "./atomicFile.js";

const POWENS_BASE = (domain: string) => `https://${domain}.biapi.pro/2.0`;

// ── Types Powens ──────────────────────────────────────────────────────────────

interface PowensConnection {
  id: number;
  state: string | null;
  last_update: string;
  connector_id: number;
  connector?: {
    id: number;
    name: string;
    logo_url?: string;
    logo?: string;
  };
}

interface PowensAccount {
  id: number;
  name: string;
  number?: string;
  iban?: string;
  type: string;
  balance: number;
  id_connection: number;
  currency?: { id: string };
  deleted?: string | null;
  disabled?: boolean;
}

interface PowensTransaction {
  id: number;
  wording: string;
  date: string;
  rdate?: string;
  value: number;
  type: string;
  account_id: number;
  original_wording?: string;
}

// ── Types publics ─────────────────────────────────────────────────────────────

export interface BankingConfig {
  domain: string;
  clientId: string;
  clientSecret: string;
  userToken?: string;
}

export interface BankConnection {
  connectionId: number;
  connectorName: string;
  connectorLogo?: string;
  accounts: BankAccount[];
  createdAt: string;
  status: string;
}

export interface BankAccount {
  id: number;
  iban?: string;
  name?: string;
  currency?: string;
  balance?: number;
  lastSyncAt?: string;
  importedCount?: number;
}

function isBankingConfig(value: unknown): value is BankingConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Partial<BankingConfig>;
  return (
    typeof config.domain === "string" && /^[a-z0-9-]+$/i.test(config.domain) &&
    typeof config.clientId === "string" && config.clientId.length > 0 &&
    typeof config.clientSecret === "string" && config.clientSecret.length > 0 &&
    (config.userToken === undefined || (typeof config.userToken === "string" && config.userToken.length > 0))
  );
}

function isBankConnections(value: unknown): value is BankConnection[] {
  return Array.isArray(value) && value.every((connection) => (
    !!connection && typeof connection === "object" &&
    typeof connection.connectionId === "number" && Number.isFinite(connection.connectionId) &&
    typeof connection.connectorName === "string" &&
    typeof connection.createdAt === "string" &&
    typeof connection.status === "string" &&
    Array.isArray(connection.accounts) && connection.accounts.every((account: unknown) => (
      !!account && typeof account === "object" &&
      typeof (account as BankAccount).id === "number" && Number.isFinite((account as BankAccount).id)
    ))
  ));
}

// ── Stockage local ────────────────────────────────────────────────────────────

function bankingDir(): string {
  return path.join(getWorkspaceRoot(), "banking");
}

function configFile(): string {
  return path.join(getCompaniesRoot(), ".banking_config.json");
}

function connectionsFile(): string {
  return path.join(bankingDir(), "connections.json");
}

export async function getConfig(): Promise<BankingConfig | null> {
  // Priorité 1 : variables d'environnement (mode hébergé)
  const envDomain = process.env.POWENS_DOMAIN?.trim();
  const envClientId = process.env.POWENS_CLIENT_ID?.trim();
  const envClientSecret = process.env.POWENS_CLIENT_SECRET?.trim();
  const envUserToken = process.env.POWENS_USER_TOKEN?.trim();
  if (envDomain && envClientId && envClientSecret) {
    const config = { domain: envDomain, clientId: envClientId, clientSecret: envClientSecret, userToken: envUserToken };
    validateBankingConfig(config);
    return config;
  }
  // Priorité 2 : fichier local (mode auto-hébergé)
  try {
    const raw = await fs.readFile(configFile(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isBankingConfig(parsed)) throw new Error("structure invalide");
    await fs.chmod(configFile(), 0o600).catch(() => undefined);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Configuration bancaire locale invalide (${reason}).`);
  }
}

export function validateBankingConfig(config: BankingConfig): void {
  if (!isBankingConfig(config)) {
    throw new Error("Configuration bancaire invalide.");
  }
}

export function validateBankConnections(connections: BankConnection[]): void {
  if (!isBankConnections(connections)) {
    throw new Error("Connexions bancaires invalides.");
  }
}

export async function getConnections(): Promise<BankConnection[]> {
  try {
    const raw = await fs.readFile(connectionsFile(), "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isBankConnections(parsed)) throw new Error("structure invalide");
    await fs.chmod(connectionsFile(), 0o600).catch(() => undefined);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Connexions bancaires locales invalides (${reason}).`);
  }
}

export async function saveConnections(connections: BankConnection[]): Promise<void> {
  validateBankConnections(connections);
  await atomicWriteFile(connectionsFile(), JSON.stringify(connections, null, 2));
}

export function isConfiguredViaEnv(): boolean {
  return !!(
    process.env.POWENS_DOMAIN?.trim() &&
    process.env.POWENS_CLIENT_ID?.trim() &&
    process.env.POWENS_CLIENT_SECRET?.trim()
  );
}

export async function saveConfig(config: BankingConfig): Promise<void> {
  validateBankingConfig(config);
  await atomicWriteFile(configFile(), JSON.stringify(config, null, 2));
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function powensFetch<T>(
  domain: string,
  endpoint: string,
  token: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(`${POWENS_BASE(domain)}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Powens ${res.status}: requête refusée`);
  }
  return res.json() as Promise<T>;
}

// ── Gestion du userToken ──────────────────────────────────────────────────────

/** Crée un nouvel utilisateur Powens et retourne son token permanent */
async function initUser(config: BankingConfig): Promise<string> {
  const res = await fetch(`${POWENS_BASE(config.domain)}/auth/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret }),
  });
  if (!res.ok) {
    throw new Error(`Powens auth/init échoué (${res.status})`);
  }
  const data = await res.json() as { auth_token: string };
  return data.auth_token;
}

/** Retourne le userToken existant ou en crée un, et persiste la config si nécessaire */
async function ensureUserToken(config: BankingConfig): Promise<{ token: string; config: BankingConfig }> {
  if (config.userToken) {
    return { token: config.userToken, config };
  }
  const token = await initUser(config);
  const updated = { ...config, userToken: token };
  if (!isConfiguredViaEnv()) {
    await saveConfig(updated);
  }
  return { token, config: updated };
}

/** Génère un code temporaire pour le webview (à usage unique) */
async function getTempCode(domain: string, userToken: string): Promise<string> {
  const data = await powensFetch<{ code: string }>(domain, "/auth/token/code", userToken);
  return data.code;
}

// ── API publique ──────────────────────────────────────────────────────────────

/** Retourne l'URL du webview Powens pour connecter une nouvelle banque */
export async function getConnectWebviewUrl(
  redirectUri: string,
  config: BankingConfig
): Promise<{ url: string }> {
  const { token, config: updated } = await ensureUserToken(config);
  const code = await getTempCode(updated.domain, token);
  const url =
    `https://webview.powens.com/connect` +
    `?domain=${updated.domain}` +
    `&client_id=${updated.clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${code}`;
  return { url };
}

/** Rafraîchit les connexions depuis l'API Powens et met à jour le stockage local */
export async function refreshConnections(config: BankingConfig): Promise<BankConnection[]> {
  const { token } = await ensureUserToken(config);

  const [connData, accData] = await Promise.all([
    powensFetch<{ connections: PowensConnection[] }>(
      config.domain, "/users/me/connections?expand=connector", token
    ),
    powensFetch<{ accounts: PowensAccount[] }>(
      config.domain, "/users/me/accounts", token
    ),
  ]);

  const existing = await getConnections();

  const connections: BankConnection[] = connData.connections.map((conn) => {
    const existingConn = existing.find((c) => c.connectionId === conn.id);
    const accounts: BankAccount[] = accData.accounts
      .filter((a) => a.id_connection === conn.id && !a.deleted && !a.disabled)
      .map((a) => {
        const existingAcc = existingConn?.accounts.find((ea) => ea.id === a.id);
        return {
          id: a.id,
          iban: a.iban,
          name: a.name,
          currency: a.currency?.id ?? "EUR",
          balance: a.balance,
          lastSyncAt: existingAcc?.lastSyncAt,
          importedCount: existingAcc?.importedCount,
        };
      });

    return {
      connectionId: conn.id,
      connectorName: conn.connector?.name ?? `Connexion ${conn.id}`,
      connectorLogo: conn.connector?.logo_url ?? conn.connector?.logo,
      accounts,
      createdAt: existingConn?.createdAt ?? conn.last_update ?? new Date().toISOString(),
      status: conn.state ?? "active",
    };
  });

  await saveConnections(connections);
  return connections;
}

/** Supprime une connexion côté Powens et en local */
export async function deleteConnection(connectionId: number, config: BankingConfig): Promise<void> {
  const { token } = await ensureUserToken(config);
  try {
    await powensFetch(config.domain, `/users/me/connections/${connectionId}`, token, { method: "DELETE" });
  } catch {
    // Ignorer si déjà supprimé côté Powens
  }
  const connections = await getConnections();
  await saveConnections(connections.filter((c) => c.connectionId !== connectionId));
}

/** Synchronise les transactions d'un compte et les importe dans le workspace */
export async function syncAccountTransactions(
  accountId: number,
  config: BankingConfig
): Promise<{ imported: number; skipped: number }> {
  const { default: yaml } = await import("yaml");
  const txnModule = await import("./transactionService.js");
  const { token } = await ensureUserToken(config);

  const data = await powensFetch<{ transactions: PowensTransaction[] }>(
    config.domain,
    `/users/me/accounts/${accountId}/transactions?limit=500`,
    token
  );

  const existing = await txnModule.loadAllTransactions();
  const existingIds = new Set(existing.map((t: { id: string }) => t.id));

  let imported = 0;
  let skipped = 0;

  const txnDir = path.join(getWorkspaceRoot(), "transactions");
  await fs.mkdir(txnDir, { recursive: true });

  for (const raw of data.transactions) {
    const id = `bank_powens_${raw.id}`;
    if (existingIds.has(id)) { skipped++; continue; }

    const amount = raw.value;
    const label = raw.wording || raw.original_wording || "Virement bancaire";

    const transaction = {
      id,
      date: raw.date,
      label,
      amount_ht: amount,
      vat: 0,
      amount_ttc: amount,
      currency: "EUR",
      category: "misc",
      account: String(accountId),
      status: "pending",
      notes: `Importé via PSD2 (Powens) — ${label}`,
      tags: ["bank_import"],
    };

    const filename = `${transaction.date}_${id}.yaml`;
    await atomicWriteFile(path.join(txnDir, filename), yaml.stringify(transaction));
    imported++;
  }

  // Mettre � jour lastSyncAt dans les connexions locales
  const connections = await getConnections();
  for (const conn of connections) {
    const acc = conn.accounts.find((a) => a.id === accountId);
    if (acc) {
      acc.lastSyncAt = new Date().toISOString();
      acc.importedCount = (acc.importedCount ?? 0) + imported;
    }
  }
  await saveConnections(connections);
  txnModule.invalidateTransactionCache();

  return { imported, skipped };
}

