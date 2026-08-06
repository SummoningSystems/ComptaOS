import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { addPendingReceipt, loadPendingReceipts, removePendingReceipt, updatePendingReceipt } from "../services/receiptInboxService.js";

describe("boîte d'attente des justificatifs", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-receipts-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("conserve le résultat OCR jusqu'au rattachement", async () => {
    await addPendingReceipt({ id: "receipt_1", filename: "receipt_1.jpg", originalName: "note.jpg", mimetype: "image/jpeg", createdAt: "2026-08-05T10:00:00.000Z", ocr: { status: "success", proposal: { supplier: "Bistro", amountHt: 10, amountTtc: 12, category: "restaurant", vatSplits: [{ rate: 20, amountTtc: 12 }], confidence: "high" } } });
    expect(await loadPendingReceipts()).toHaveLength(1);
    const updated = (await loadPendingReceipts())[0]; updated.ocr = { status: "error", message: "retry" }; await updatePendingReceipt(updated);
    expect((await loadPendingReceipts())[0].ocr.status).toBe("error");
    expect((await removePendingReceipt("receipt_1"))?.ocr.message).toBe("retry");
    expect(await loadPendingReceipts()).toEqual([]);
    expect(JSON.parse(await fs.readFile(path.join(workspace.root, "receipt-inbox.json"), "utf-8"))).toEqual([]);
  });
});
