import fs from "fs/promises";
import path from "path";
import { atomicWriteFile } from "./atomicFile.js";
import { getWorkspaceRoot } from "./fileSystem.js";
import type { ReceiptProposal } from "./ocrService.js";

export interface PendingReceipt {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  createdAt: string;
  ocr: { status: "success" | "unavailable" | "error"; proposal?: ReceiptProposal; message?: string };
}

function inboxPath(): string { return path.join(getWorkspaceRoot(), "receipt-inbox.json"); }
let mutationQueue: Promise<void> = Promise.resolve();

async function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function loadPendingReceipts(): Promise<PendingReceipt[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(inboxPath(), "utf-8"));
    return Array.isArray(parsed) ? parsed as PendingReceipt[] : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

async function savePendingReceipts(receipts: PendingReceipt[]): Promise<void> {
  await atomicWriteFile(inboxPath(), JSON.stringify(receipts, null, 2));
}

export async function addPendingReceipt(receipt: PendingReceipt): Promise<void> {
  await mutate(async () => {
    const receipts = await loadPendingReceipts();
    await savePendingReceipts([receipt, ...receipts.filter((item) => item.id !== receipt.id)]);
  });
}

export async function updatePendingReceipt(receipt: PendingReceipt): Promise<void> {
  await mutate(async () => {
    const receipts = await loadPendingReceipts();
    await savePendingReceipts(receipts.map((item) => item.id === receipt.id ? receipt : item));
  });
}

export async function removePendingReceipt(id: string): Promise<PendingReceipt | undefined> {
  return mutate(async () => {
    const receipts = await loadPendingReceipts();
    const receipt = receipts.find((item) => item.id === id);
    if (receipt) await savePendingReceipts(receipts.filter((item) => item.id !== id));
    return receipt;
  });
}
