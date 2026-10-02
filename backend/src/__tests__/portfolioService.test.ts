import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; kind?: "business" | "personal"; scopeId?: string; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({ getCompaniesRoot: () => workspace.root, getActiveCompanyPath: () => workspace.root, loadCompanies: () => workspace.companies, resolveCompanyPath: (company: { path: string }) => path.resolve(workspace.root, company.path) }));

import { createPerson, getPlatformState } from "../services/platformService.js";
import { createPortfolioTransfer, getPortfolioSnapshot } from "../services/portfolioService.js";
import { loadFinanceTransactions, saveTransactionAllocations } from "../services/financeAllocationService.js";
import { invalidateTransactionCache } from "../services/transactionService.js";

describe("portfolio transfers and consolidated forecast", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-portfolio-"));
    workspace.companies = [{ id: "default", name: "Entreprise", path: ".", kind: "business", createdAt: "2026-01-01T00:00:00.000Z" }];
    await fs.mkdir(path.join(workspace.root, "banking"), { recursive: true }); await fs.mkdir(path.join(workspace.root, "transactions"), { recursive: true });
    await fs.writeFile(path.join(workspace.root, "banking", "connections.json"), JSON.stringify([{ connectorName: "Banque", accounts: [{ id: "pro", name: "Compte pro", balance: 1000 }, { id: "perso", name: "Compte perso", balance: 400 }] }]));
  });
  afterEach(async () => { invalidateTransactionCache(); await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("relie deux mouvements opposés et neutralise un transfert interne", async () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id;
    const base = { date: "2026-10-02", amount_ht: 0, vat: 0, currency: "EUR", category: "misc", status: "validated" } as const;
    await fs.writeFile(path.join(workspace.root, "transactions", "out.yaml"), yaml.stringify({ ...base, id: "out", label: "Virement vers Alice", amount_ttc: -100, account: "pro" }));
    await fs.writeFile(path.join(workspace.root, "transactions", "in.yaml"), yaml.stringify({ ...base, id: "in", label: "Virement reçu", amount_ttc: 100, account: "perso" })); invalidateTransactionCache();
    const actor = { id: "local", role: "local" as const }; const synced = getPlatformState();
    expect(synced.accounts.map((account) => account.sourceAccountId)).toEqual(expect.arrayContaining(["pro", "perso"]));
    await saveTransactionAllocations(actor, "2026-10", "default:in", [{ scopeId: personId, amount: 100 }]);
    const loaded = await loadFinanceTransactions(actor, "2026-10");
    expect(loaded.transactions.map((transaction) => [transaction.key, transaction.amount_ttc])).toEqual(expect.arrayContaining([["default:out", -100], ["default:in", 100]]));
    const transfer = await createPortfolioTransfer(actor, { kind: "confirmed", sourceScopeId: "entity_default", destinationScopeId: personId, amount: 100, date: "2026-10-02", label: "Apport personnel", sourceTransactionKey: "default:out", destinationTransactionKey: "default:in" });
    const snapshot = await getPortfolioSnapshot(actor, personId, 6, [personId, "entity_default"], "2026-10");
    expect(transfer.kind).toBe("confirmed"); expect(snapshot.transfers).toHaveLength(1); expect(snapshot.transferCandidates).toHaveLength(2);
  });

  it("annule un transfert prévu dans le groupe mais le conserve à la frontière", async () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id; const actor = { id: "local", role: "local" as const };
    await createPortfolioTransfer(actor, { kind: "planned", sourceScopeId: personId, destinationScopeId: "entity_default", amount: 250, date: "2026-10-15", label: "Apport", frequency: "once" });
    const group = await getPortfolioSnapshot(actor, personId, 3, [personId, "entity_default"], "2026-10"); const personOnly = await getPortfolioSnapshot(actor, personId, 3, [personId], "2026-10");
    expect(group.forecast[0]).toMatchObject({ transfersIn: 0, transfersOut: 0 }); expect(personOnly.forecast[0].transfersOut).toBe(250);
  });
});
