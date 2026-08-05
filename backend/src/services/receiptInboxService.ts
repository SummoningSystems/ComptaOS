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
  const receipts = await loadPendingReceipts();
  await savePendingReceipts([receipt, ...receipts.filter((item) => item.id !== receipt.id)]);
}

export async function removePendingReceipt(id: string): Promise<PendingReceipt | undefined> {
  const receipts = await loadPendingReceipts();
  const receipt = receipts.find((item) => item.id === id);
  if (receipt) await savePendingReceipts(receipts.filter((item) => item.id !== id));
  return receipt;
}
