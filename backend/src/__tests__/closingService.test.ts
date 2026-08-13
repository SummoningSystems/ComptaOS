import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { activeClosing, assertMonthOpen, closeMonth, closingFingerprint, loadClosings, reopenMonth } from "../services/closingService.js";

const transaction = (id = "txn_1"): Transaction => ({ id, date: "2026-08-12", label: "Test", amount_ht: -10, vat: -2, amount_ttc: -12, currency: "EUR", category: "software", account: "512", status: "validated", reconciled: true, justified: true });

describe("clôture mensuelle persistante", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-closing-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("enregistre une empreinte stable et bloque le mois", async () => {
    const transactions = [transaction()]; const record = await closeMonth("2026-08", transactions, "test");
    expect(record.fingerprint).toBe(closingFingerprint(transactions, "2026-08"));
    expect(await activeClosing("2026-08")).toMatchObject({ status: "closed", closedBy: "test" });
    await expect(assertMonthOpen("2026-08-20")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("exige un motif puis conserve la réouverture dans l'historique", async () => {
    await closeMonth("2026-08", [transaction()]);
    await expect(reopenMonth("2026-08", " ")).rejects.toThrow("motif");
    await reopenMonth("2026-08", "Facture reçue tardivement", "test");
    await expect(assertMonthOpen("2026-08-20")).resolves.toBeUndefined();
    expect(await loadClosings()).toEqual([expect.objectContaining({ status: "reopened", reopenReason: "Facture reçue tardivement" })]);
  });
});
