import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { cancelFiscalAdjustment, createFiscalAdjustment, getFiscalReview, listFiscalAdjustments, saveFiscalReview, updateFiscalAdjustment, validateFiscalAdjustment } from "../services/annualFiscalService.js";

const input = { type: "reintegration" as const, kind: "corporate_tax" as const, label: "Impôt sur les sociétés", amount: 1200, accountNumber: "695000", reference: "OD-IS" };

describe("corrections du résultat fiscal", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-fiscal-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("refuse les montants non positifs et les comptes invalides", () => {
    expect(() => createFiscalAdjustment("fy", { ...input, amount: 0 })).toThrow("strictement positif");
    expect(() => createFiscalAdjustment("fy", { ...input, accountNumber: "69A" })).toThrow("trois chiffres");
  });

  it("impose la validation des brouillons avant la revue fiscale", () => {
    const item = createFiscalAdjustment("fy", input);
    expect(() => saveFiscalReview("fy", true, "Revue effectuée")).toThrow("brouillon");
    validateFiscalAdjustment("fy", item.id); saveFiscalReview("fy", true, "Revue effectuée");
    expect(getFiscalReview("fy")).toMatchObject({ confirmed: true, note: "Revue effectuée" });
    expect(() => updateFiscalAdjustment("fy", item.id, { ...input, amount: 1300 })).toThrow("brouillon");
  });

  it("conserve une correction annulée avec son motif", () => {
    const item = createFiscalAdjustment("fy", input); validateFiscalAdjustment("fy", item.id);
    cancelFiscalAdjustment("fy", item.id, "Correction remplacée");
    expect(listFiscalAdjustments("fy")[0]).toMatchObject({ status: "cancelled", cancellationReason: "Correction remplacée" });
    expect(getFiscalReview("fy").confirmed).toBe(false);
  });
});
