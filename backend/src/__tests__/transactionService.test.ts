import fs from "fs/promises";
import os from "os";
import path from "path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Transaction } from "../types/index.js";

const workspace = vi.hoisted(() => ({ root: "" }));

vi.mock("../services/fileSystem.js", () => ({
  getWorkspaceRoot: () => workspace.root,
  resolveSafe: (relativePath: string) => path.join(workspace.root, relativePath),
}));

import {
  getTransactionLoadIssues,
  invalidateTransactionCache,
  loadAllTransactions,
  saveTransaction,
  updateTransaction,
  validateVatSplits,
} from "../services/transactionService.js";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn_test",
    date: "2026-07-26",
    label: "Achat logiciel",
    amount_ht: -100,
    vat: -20,
    vat_rate: 20,
    amount_ttc: -120,
    currency: "EUR",
    category: "software",
    account: "512000",
    status: "pending",
    ...overrides,
  };
}

describe("transactionService persistence", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-transactions-"));
    invalidateTransactionCache();
  });

  afterEach(async () => {
    invalidateTransactionCache();
    await fs.rm(workspace.root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("sauvegarde une transaction complète sans laisser de fichier temporaire", async () => {
    await saveTransaction(transaction());

    const directory = path.join(workspace.root, "transactions");
    expect(await fs.readdir(directory)).toEqual(["txn_test.yaml"]);
    const stored = yaml.parse(await fs.readFile(path.join(directory, "txn_test.yaml"), "utf-8"));
    expect(stored).toMatchObject({ id: "txn_test", amount_ht: -100, vat: -20, amount_ttc: -120 });
  });

  it("met à jour une transaction avec un remplacement complet", async () => {
    await saveTransaction(transaction());

    const updated = await updateTransaction("txn_test", { label: "Licence annuelle", status: "validated" });

    expect(updated).toMatchObject({ label: "Licence annuelle", status: "validated" });
    invalidateTransactionCache();
    await expect(loadAllTransactions()).resolves.toMatchObject([
      { id: "txn_test", label: "Licence annuelle", status: "validated" },
    ]);
  });

  it("calcule la TVA d'un repas ventile entre 10 % et 20 %", async () => {
    await saveTransaction(transaction({ amount_ttc: -30, amount_ht: -30, vat: 0, vat_rate: 0 }));

    const updated = await updateTransaction("txn_test", {
      vat_splits: [
        { rate: 10, amount_ttc: -20 },
        { rate: 20, amount_ttc: -10 },
      ],
    });

    expect(updated.vat_splits).toEqual([
      { rate: 10, amount_ttc: -20 },
      { rate: 20, amount_ttc: -10 },
    ]);
    expect(updated.amount_ht).toBe(-26.51);
    expect(updated.vat).toBe(-3.49);
  });

  it("refuse une ventilation dont le total ne correspond pas a la transaction", () => {
    expect(validateVatSplits(-30, [
      { rate: 10, amount_ttc: -10 },
      { rate: 20, amount_ttc: -10 },
    ])).toContain("total TTC");
  });

  it("signale un fichier YAML invalide tout en chargeant les transactions valides", async () => {
    await saveTransaction(transaction());
    const directory = path.join(workspace.root, "transactions");
    await fs.writeFile(path.join(directory, "broken.yaml"), "id: [yaml invalide", "utf-8");
    invalidateTransactionCache();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const loaded = await loadAllTransactions();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("txn_test");
    expect(getTransactionLoadIssues()).toEqual([
      expect.objectContaining({ file: "broken.yaml" }),
    ]);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("broken.yaml"));
  });

  it("rejette une structure YAML incomplète comme donnée corrompue", async () => {
    const directory = path.join(workspace.root, "transactions");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "partial.yaml"), "id: txn_partial\nlabel: Sans date\n", "utf-8");
    invalidateTransactionCache();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadAllTransactions()).resolves.toEqual([]);
    expect(getTransactionLoadIssues()[0]).toMatchObject({
      file: "partial.yaml",
      message: "structure de transaction invalide",
    });
  });
});
