import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));

vi.mock("../services/companiesService.js", () => ({
  getActiveCompanyPath: () => workspace.root,
}));

import { loadOutgoingInvoices, saveOutgoingInvoices } from "../services/invoiceService.js";
import { loadQuotes, saveQuotes } from "../services/quoteService.js";
import { loadManualRecurring, saveManualRecurring } from "../services/manualRecurringService.js";
import {
  loadBudgets,
  loadCategoryRules,
  loadCompanyProfile,
  loadTreasuryAlert,
  learnMerchantRule,
  loadMerchantRules,
  saveBudgets,
  saveCategoryRules,
  saveCompanyProfile,
  saveTreasuryAlert,
} from "../services/settingsService.js";

describe("critical JSON persistence", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-critical-"));
  });

  afterEach(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  it("écrit et relit les documents métier sans résidu temporaire", async () => {
    saveOutgoingInvoices([{
      id: "inv_1",
      number: "F-2026-001",
      client: "Client test",
      date: "2026-07-26",
      dueDate: "2026-08-26",
      description: "Prestation",
      amount_ht: 100,
      vat_rate: 20,
      amount_ttc: 120,
      status: "draft",
    }]);
    saveQuotes([{
      id: "quote_1",
      number: "D-2026-001",
      client: "Client test",
      date: "2026-07-26",
      validUntil: "2026-08-26",
      description: "Proposition",
      amount_ht: 100,
      vat_rate: 20,
      amount_ttc: 120,
      status: "draft",
    }]);
    saveManualRecurring([{
      id: "rec_1",
      label: "Hébergement",
      category: "hosting",
      amount: 20,
      frequency: "mensuel",
      nextPayment: "2026-08-01",
      active: true,
    }]);
    saveCategoryRules([{ id: "rule_1", pattern: "hébergement", category: "hosting" }]);
    saveTreasuryAlert({ threshold: 2000, enabled: true });
    saveBudgets([{ category: "software", monthlyLimit: 500 }]);
    saveCompanyProfile({ name: "Entreprise test", onboardingDone: true });
    learnMerchantRule("CB OPENAI 12345", { category: "software", vatRate: 20 });
    learnMerchantRule("PAIEMENT OPENAI 67890", { category: "subscription" });

    expect(loadOutgoingInvoices()[0].id).toBe("inv_1");
    expect(loadQuotes()[0].id).toBe("quote_1");
    expect(loadManualRecurring()[0].id).toBe("rec_1");
    expect(loadCategoryRules()[0].id).toBe("rule_1");
    expect(loadTreasuryAlert()).toEqual({ threshold: 2000, enabled: true });
    expect(loadBudgets()[0]).toEqual({ category: "software", monthlyLimit: 500 });
    expect(loadCompanyProfile()).toMatchObject({ name: "Entreprise test", onboardingDone: true });
    expect(loadMerchantRules()).toHaveLength(1);
    expect(loadMerchantRules()[0]).toMatchObject({ pattern: "openai", category: "subscription", vatRate: 20 });

    const files = await fs.readdir(path.join(workspace.root, "settings"));
    expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
  });
});
