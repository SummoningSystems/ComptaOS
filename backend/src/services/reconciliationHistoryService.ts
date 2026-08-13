import fs from "fs/promises";
import path from "path";
import { atomicWriteFile } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import { nanoid } from "../utils/id.js";

export interface ReconciliationHistoryEntry {
  id: string;
  createdAt: string;
  mode: "single" | "many-receipts" | "split-payment";
  receiptIds: string[];
  transactionIds: string[];
  score?: number;
  reasons: string[];
  appliedProposal: boolean;
}

const historyPath = () => path.join(getWorkspaceRoot(), "settings", "reconciliation-history.json");
let queue: Promise<void> = Promise.resolve();

export async function loadReconciliationHistory(): Promise<ReconciliationHistoryEntry[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(historyPath(), "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function recordReconciliation(entry: Omit<ReconciliationHistoryEntry, "id" | "createdAt">): Promise<ReconciliationHistoryEntry> {
  const complete = { ...entry, id: `reconciliation_${nanoid()}`, createdAt: new Date().toISOString() };
  const operation = queue.then(async () => {
    const current = await loadReconciliationHistory();
    await fs.mkdir(path.dirname(historyPath()), { recursive: true });
    await atomicWriteFile(historyPath(), JSON.stringify([complete, ...current].slice(0, 500), null, 2));
  });
  queue = operation.then(() => undefined, () => undefined);
  await operation;
  return complete;
}
