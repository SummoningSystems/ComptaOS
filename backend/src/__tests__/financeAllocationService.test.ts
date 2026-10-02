import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({ getCompaniesRoot: () => workspace.root, getActiveCompanyPath: () => workspace.root, loadCompanies: () => workspace.companies, resolveCompanyPath: (company: { path: string }) => path.resolve(workspace.root, company.path) }));

import { getFinanceAllocationSnapshot, saveAccountAssignment, saveTransactionAllocations } from "../services/financeAllocationService.js";
import { createHousehold, createPerson, createRelation, getPlatformState } from "../services/platformService.js";
import { getHouseholdFinance } from "../services/householdFinanceService.js";
import { invalidateTransactionCache } from "../services/transactionService.js";

describe("financial allocation and household consolidation", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-allocation-"));
    workspace.companies = [{ id: "default", name: "Entreprise", path: ".", createdAt: "2026-01-01T00:00:00.000Z" }];
    await fs.mkdir(path.join(workspace.root, "banking"), { recursive: true });
    await fs.mkdir(path.join(workspace.root, "transactions"), { recursive: true });
    await fs.writeFile(path.join(workspace.root, "banking", "connections.json"), JSON.stringify([{ connectorName: "Banque", accounts: [{ id: 7, name: "Compte mixte", balance: 500 }] }]));
    for (const transaction of [{ id: "shop", date: "2026-10-02", label: "Magasin", amount_ht: -120, vat: 0, amount_ttc: -120, currency: "EUR", category: "misc", account: "7", status: "validated" }, { id: "income", date: "2026-10-03", label: "Salaire", amount_ht: 1000, vat: 0, amount_ttc: 1000, currency: "EUR", category: "misc", account: "7", status: "validated" }]) await fs.writeFile(path.join(workspace.root, "transactions", `${transaction.id}.yaml`), yaml.stringify(transaction));
  });
  afterEach(async () => { invalidateTransactionCache(); await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("force l'arbitrage d'un compte mixte puis consolide le foyer sans dupliquer le flux", async () => {
    const initial = getPlatformState();
    const person = createPerson({ name: "Alice", expectedRevision: initial.revision });
    const household = createHousehold({ name: "Foyer Alice", expectedRevision: person.revision });
    createRelation({ fromId: person.people[0].id, toId: household.households[0].id, type: "member", expectedRevision: household.revision });
    const actor = { id: "local", role: "local" };
    saveAccountAssignment(initial.accounts[0].id, { usage: "mixed" }, actor);
    const before = await getFinanceAllocationSnapshot(actor, "2026-10");
    expect(before.unassignedCount).toBe(2);
    await saveTransactionAllocations(actor, "2026-10", "default:shop", [{ scopeId: person.people[0].id, amount: -80 }, { scopeId: household.households[0].id, amount: -40 }]);
    await saveTransactionAllocations(actor, "2026-10", "default:income", [{ scopeId: person.people[0].id, amount: 1000 }]);
    const consolidated = await getHouseholdFinance(household.households[0].id, "2026-10", actor);
    expect(consolidated.transactions).toHaveLength(2);
    expect(consolidated.summary).toMatchObject({ income: 1000, expenses: 120, net: 880 });
  });
});
