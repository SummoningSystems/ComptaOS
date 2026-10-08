import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { cancelInventoryEntry, createInventoryEntry, inventoryAccountingLines, listInventoryEntries, updateInventoryEntry, validateInventoryEntry } from "../services/annualInventoryService.js";

const period = { id: "fy_2026", startDate: "2025-10-01", endDate: "2026-09-30" };
const input = { date: "2026-09-30", kind: "corporate_tax" as const, label: "Impôt sur les sociétés à payer", reference: "IS-2026", lines: [
  { id: "1", accountNumber: "695000", accountLabel: "Impôts sur les bénéfices", debit: 1200, credit: 0 },
  { id: "2", accountNumber: "444000", accountLabel: "État - impôts sur les bénéfices", debit: 0, credit: 1200 },
] };

describe("journal d’inventaire annuel", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-inventory-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("refuse une date hors exercice et une écriture déséquilibrée", () => {
    expect(() => createInventoryEntry(period, { ...input, date: "2026-10-01" })).toThrow("comprise");
    expect(() => createInventoryEntry(period, { ...input, lines: [{ ...input.lines[0], debit: 1000 }, input.lines[1]] })).toThrow("déséquilibrée");
  });

  it("verrouille une écriture validée et l’intègre au journal OD", () => {
    const entry = createInventoryEntry(period, input);
    validateInventoryEntry(period.id, entry.id);
    expect(() => updateInventoryEntry(period, entry.id, { ...input, label: "modifiée" })).toThrow("brouillon");
    const lines = inventoryAccountingLines(period.id);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ journalCode: "OD", entryDate: "2026-09-30", accountNumber: "695000", debit: 1200 });
  });

  it("annule sans effacer en créant une contrepassation traçable", () => {
    const entry = createInventoryEntry(period, input); validateInventoryEntry(period.id, entry.id);
    const result = cancelInventoryEntry(period.id, entry.id, "Montant corrigé par une nouvelle écriture");
    expect(result.original.status).toBe("cancelled"); expect(result.reversal.reversalOf).toBe(entry.id);
    expect(inventoryAccountingLines(period.id).reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    expect(listInventoryEntries(period.id)).toHaveLength(2);
  });
});
