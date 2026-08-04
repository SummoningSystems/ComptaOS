import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import yaml from "yaml";
import { Transaction } from "../types/index.js";
import { getWorkspaceRoot, resolveSafe } from "./fileSystem.js";
import { atomicWriteFile } from "./atomicFile.js";

const TXN_DIR = "transactions";

/** Retourne le chemin absolu du dossier transactions. */
function txnDir(): string {
  return path.join(getWorkspaceRoot(), TXN_DIR);
}

// ── Cache mémoire ─────────────────────────────────────────────────────────────
let _cache: Transaction[] | null = null;
let _watcher: fsSync.FSWatcher | null = null;

export interface TransactionLoadIssue {
  file: string;
  message: string;
}

let _loadIssues: TransactionLoadIssue[] = [];

export function getTransactionLoadIssues(): TransactionLoadIssue[] {
  return _loadIssues.map((issue) => ({ ...issue }));
}

function invalidateCache() { _cache = null; }

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isTransaction(value: unknown): value is Transaction {
  if (!value || typeof value !== "object") return false;
  const txn = value as Partial<Transaction>;
  return (
    typeof txn.id === "string" && txn.id.length > 0 &&
    typeof txn.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(txn.date) &&
    typeof txn.label === "string" &&
    typeof txn.amount_ttc === "number" && Number.isFinite(txn.amount_ttc) &&
    typeof txn.amount_ht === "number" && Number.isFinite(txn.amount_ht) &&
    typeof txn.vat === "number" && Number.isFinite(txn.vat) &&
    typeof txn.currency === "string" &&
    typeof txn.category === "string" &&
    typeof txn.account === "string" &&
    (txn.status === "validated" || txn.status === "pending" || txn.status === "rejected")
  );
}

// Taux TVA légaux français
const STANDARD_VAT_RATES = [0, 2.1, 5.5, 10, 20];

export function validateVatSplits(amountTtc: number, splits: Transaction["vat_splits"]): string | null {
  if (splits === undefined || splits.length === 0) return null;
  if (splits.length < 2) return "Une ventilation TVA doit contenir au moins deux lignes";

  const sign = Math.sign(amountTtc);
  for (const split of splits) {
    if (!Number.isFinite(split.rate) || split.rate < 0 || split.rate > 100) {
      return "Chaque taux de TVA doit être compris entre 0 et 100";
    }
    if (!Number.isFinite(split.amount_ttc)) {
      return "Chaque montant TTC de ventilation doit être un nombre valide";
    }
    if (split.amount_ttc !== 0 && Math.sign(split.amount_ttc) !== sign) {
      return "Les montants ventilés doivent avoir le même sens que la transaction";
    }
  }

  const splitTotal = round2(splits.reduce((sum, split) => sum + split.amount_ttc, 0));
  if (Math.abs(splitTotal - round2(amountTtc)) >= 0.01) {
    return "Le total TTC de la ventilation doit correspondre au montant de la transaction";
  }
  return null;
}

/** Snap un taux calculé vers le taux légal le plus proche si écart < 0.5 pt */
function snapVatRate(rate: number): number {
  for (const std of STANDARD_VAT_RATES) {
    if (Math.abs(rate - std) <= 0.5) return std;
  }
  return rate;
}

function deriveVatRate(txn: Transaction): number {
  if (typeof txn.vat_rate === "number" && Number.isFinite(txn.vat_rate)) {
    return Math.max(0, txn.vat_rate);
  }

  const ttcAbs = Math.abs(txn.amount_ttc ?? 0);
  const vatAbs = Math.abs(txn.vat ?? 0);
  const htAbs = Math.max(0, ttcAbs - vatAbs);
  if (htAbs <= 0) return 0;

  return snapVatRate(round2((vatAbs / htAbs) * 100));
}

function normalizeTransaction(txn: Transaction): Transaction {
  // Si des splits sont définis, on en déduit HT/TVA/taux effectif
  if (txn.vat_splits && txn.vat_splits.length > 0) {
    const totalHt = round2(
      txn.vat_splits.reduce((s, sp) => s + round2(sp.amount_ttc / (1 + sp.rate / 100)), 0)
    );
    const totalVat = round2((txn.amount_ttc ?? 0) - totalHt);
    const effectiveRate = Math.abs(totalHt) > 0
      ? snapVatRate(round2((Math.abs(totalVat) / Math.abs(totalHt)) * 100))
      : 0;
    return { ...txn, vat_rate: effectiveRate, amount_ht: totalHt, vat: totalVat };
  }

  const rate = deriveVatRate(txn);
  const factor = 1 + rate / 100;

  const amount_ht = factor > 0 ? round2((txn.amount_ttc ?? 0) / factor) : round2(txn.amount_ttc ?? 0);
  const vat = round2((txn.amount_ttc ?? 0) - amount_ht);

  return {
    ...txn,
    vat_rate: rate,
    amount_ht,
    vat,
  };
}

/**
 * À appeler lors d'un changement d'entreprise active pour forcer le rechargement
 * depuis le bon dossier et réinitialiser le watcher sur le bon répertoire.
 */
export function invalidateTransactionCache(): void {
  _cache = null;
  if (_watcher) {
    _watcher.close();
    _watcher = null;
  }
}

function ensureWatcher() {
  if (_watcher) return;
  const dir = txnDir();
  try {
    fsSync.mkdirSync(dir, { recursive: true });
    _watcher = fsSync.watch(dir, { persistent: false }, () => invalidateCache());
    _watcher.on("error", () => { _watcher = null; });
  } catch { /* ignore si le dossier n'existe pas encore */ }
}

/** Charge toutes les transactions depuis les fichiers YAML du dossier transactions/. */
export async function loadAllTransactions(): Promise<Transaction[]> {
  ensureWatcher();
  if (_cache) return _cache;

  const dir = txnDir();
  await fs.mkdir(dir, { recursive: true });

  const files = await fs.readdir(dir);
  const transactions: Transaction[] = [];
  const issues: TransactionLoadIssue[] = [];

  for (const file of files) {
    if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
    try {
      const content = await fs.readFile(path.join(dir, file), "utf-8");
      const parsed: unknown = yaml.parse(content);
      if (!isTransaction(parsed)) {
        throw new Error("structure de transaction invalide");
      }
      transactions.push(normalizeTransaction(parsed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ file, message });
      console.warn(`[transactions] fichier ignoré ${file}: ${message}`);
    }
  }

  _loadIssues = issues;
  _cache = transactions.sort((a, b) => b.date.localeCompare(a.date));
  return _cache;
}

/** Sauvegarde une transaction dans un fichier YAML. */
export async function saveTransaction(txn: Transaction): Promise<void> {
  const dir = txnDir();
  await fs.mkdir(dir, { recursive: true });
  const normalized = normalizeTransaction(txn);
  const filePath = path.join(dir, `${normalized.id}.yaml`);
  await atomicWriteFile(filePath, yaml.stringify(normalized));
  invalidateCache();
}

/** Sauvegarde un lot de transactions. */
export async function saveTransactions(txns: Transaction[]): Promise<void> {
  await Promise.all(txns.map(saveTransaction));
  // invalidateCache() déjà appelé dans saveTransaction
}

/** Met à jour une transaction existante. */
export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<Transaction> {
  const dir = txnDir();
  const filePath = path.join(dir, `${id}.yaml`);
  const content = await fs.readFile(filePath, "utf-8");
  const txn = yaml.parse(content) as Transaction;
  const updated = normalizeTransaction({ ...txn, ...patch });
  await atomicWriteFile(filePath, yaml.stringify(updated));
  invalidateCache();
  return updated;
}

/** Supprime une transaction. */
export async function deleteTransaction(id: string): Promise<void> {
  const filePath = resolveSafe(`${TXN_DIR}/${id}.yaml`);
  await fs.unlink(filePath);
  invalidateCache();
}
