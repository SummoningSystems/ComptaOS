import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({
  getCompaniesRoot: () => workspace.root,
  getActiveCompanyPath: () => workspace.root,
  loadCompanies: () => workspace.companies,
  resolveCompanyPath: (company: { path: string }) => path.resolve(workspace.root, company.path),
}));

import { createPerson, createRelation, getPlatformState } from "../services/platformService.js";
import { getPersonalFinance, savePersonalBudgets, setPersonalTransactionCategories, setPersonalTransactionCategory } from "../services/personalFinanceService.js";
import { invalidateTransactionCache } from "../services/transactionService.js";

describe("personal finance", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-personal-"));
    workspace.companies = [{ id: "default", name: "Entreprise", path: ".", createdAt: "2026-01-01T00:00:00.000Z" }];
    await fs.mkdir(path.join(workspace.root, "banking"), { recursive: true });
    await fs.mkdir(path.join(workspace.root, "transactions"), { recursive: true });
    await fs.writeFile(path.join(workspace.root, "banking", "connections.json"), JSON.stringify([{ connectorName: "Banque", accounts: [{ id: 7, name: "Courant", balance: 1200 }, { id: 8, name: "Épargne", balance: 1800 }] }]), "utf-8");
    const transactions = [
      { id: "meal", date: "2026-10-02", label: "Restaurant", amount_ht: -50, vat: 0, amount_ttc: -50, currency: "EUR", category: "restaurant", account: "7", status: "validated" },
      { id: "income", date: "2026-10-03", label: "Revenu", amount_ht: 1000, vat: 0, amount_ttc: 1000, currency: "EUR", category: "misc", account: "7", status: "validated" },
      { id: "transfer-out", date: "2026-10-04", label: "Virement vers épargne", amount_ht: -100, vat: 0, amount_ttc: -100, currency: "EUR", category: "misc", account: "7", status: "validated" },
      { id: "transfer-in", date: "2026-10-04", label: "Virement reçu", amount_ht: 100, vat: 0, amount_ttc: 100, currency: "EUR", category: "misc", account: "8", status: "validated" },
      { id: "november", date: "2026-11-04", label: "Cinéma", amount_ht: -20, vat: 0, amount_ttc: -20, currency: "EUR", category: "misc", account: "7", status: "validated" },
    ];
    await Promise.all(transactions.map((transaction) => fs.writeFile(path.join(workspace.root, "transactions", `${transaction.id}.yaml`), yaml.stringify(transaction), "utf-8")));
  });

  afterEach(async () => { invalidateTransactionCache(); await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("agrège seulement les comptes reliés et neutralise les virements internes", async () => {
    const initial = getPlatformState();
    const withPerson = createPerson({ name: "Alice", expectedRevision: initial.revision });
    let revision = withPerson.revision;
    for (const account of withPerson.accounts) {
      const result = createRelation({ fromId: withPerson.people[0].id, toId: account.id, type: "holder", expectedRevision: revision });
      revision = result.state.revision;
    }
    const personId = withPerson.people[0].id;
    const snapshot = await getPersonalFinance(personId, "2026-10", { id: "local", role: "local" });
    expect(snapshot.accounts).toHaveLength(2);
    expect(snapshot.summary).toMatchObject({ balance: 3000, income: 1000, expenses: 50, net: 950, internalTransfers: 1 });
    expect(snapshot.transactions.filter((transaction) => transaction.internalTransfer)).toHaveLength(2);

    setPersonalTransactionCategory(personId, "default:meal", "groceries");
    expect(savePersonalBudgets(personId, [{ category: "groceries", monthlyLimit: 300 }])).toEqual([{ category: "groceries", monthlyLimit: 300 }]);
    const updated = await getPersonalFinance(personId, "2026-10", { id: "local", role: "local" });
    expect(updated.transactions.find((transaction) => transaction.id === "meal")?.personalCategory).toBe("groceries");
    expect(updated.budgets).toEqual([{ category: "groceries", monthlyLimit: 300 }]);
  });

  it("charge tout l'historique et classe plusieurs mouvements en une écriture", async () => {
    const initial = getPlatformState();
    const withPerson = createPerson({ name: "Alice", expectedRevision: initial.revision });
    const account = withPerson.accounts[0];
    createRelation({ fromId: withPerson.people[0].id, toId: account.id, type: "holder", expectedRevision: withPerson.revision });
    const personId = withPerson.people[0].id;

    const snapshot = await getPersonalFinance(personId, undefined, { id: "local", role: "local" });
    expect(snapshot.month).toBe("all");
    expect(snapshot.transactions.map((transaction) => transaction.id)).toContain("november");
    expect(setPersonalTransactionCategories(personId, ["default:meal", "default:november"], "leisure")).toBe(2);
    const updated = await getPersonalFinance(personId, undefined, { id: "local", role: "local" });
    expect(updated.transactions.filter((transaction) => ["meal", "november"].includes(transaction.id)).every((transaction) => transaction.personalCategory === "leisure")).toBe(true);
  });
});
