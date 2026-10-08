import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "", companies: [] as Array<{ id: string; name: string; path: string; kind?: "business" | "personal"; scopeId?: string; createdAt: string }> }));
vi.mock("../services/companiesService.js", () => ({ getCompaniesRoot: () => workspace.root, getActiveCompanyPath: () => workspace.root, loadCompanies: () => workspace.companies, resolveCompanyPath: (company: { path: string }) => path.resolve(workspace.root, company.path) }));

import { createHousehold, createPerson, createRelation, getPlatformState } from "../services/platformService.js";
import { advancePortfolioTransfer, correctPortfolioTransfer, createPortfolioCommitment, createPortfolioTransfer, getPortfolioSnapshot, savePortfolioAssumptions, suggestedPortfolioScopes } from "../services/portfolioService.js";
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

  it("ne traverse pas un foyer pour inclure les entreprises privées des autres membres", () => {
    let state = getPlatformState();
    state = createPerson({ name: "Benoit", expectedRevision: state.revision });
    state = createPerson({ name: "Laura", expectedRevision: state.revision });
    state = createPerson({ name: "Paul", expectedRevision: state.revision });
    state = createHousehold({ name: "Foyer", expectedRevision: state.revision });
    const [benoit, laura, paul] = state.people;
    const household = state.households[0];
    state = createRelation({ fromId: benoit.id, toId: household.id, type: "member", expectedRevision: state.revision }).state;
    state = createRelation({ fromId: laura.id, toId: household.id, type: "member", expectedRevision: state.revision }).state;
    state = createRelation({ fromId: benoit.id, toId: "entity_default", type: "owner", ownershipPercent: 67, expectedRevision: state.revision }).state;
    state = createRelation({ fromId: paul.id, toId: "entity_default", type: "owner", ownershipPercent: 33, expectedRevision: state.revision }).state;

    expect(suggestedPortfolioScopes(state, laura.id)).toEqual([laura.id, household.id]);
    expect(suggestedPortfolioScopes(state, benoit.id)).toEqual(expect.arrayContaining([benoit.id, household.id, "entity_default"]));
    expect(suggestedPortfolioScopes(state, household.id)).toEqual(expect.arrayContaining([household.id, benoit.id, laura.id]));
    expect(suggestedPortfolioScopes(state, household.id)).not.toContain("entity_default");
  });

  it("gère un transfert partiel intermois avec frais et propose les écritures", async () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id; const actor = { id: "local", role: "local" as const };
    const base = { amount_ht: 0, vat: 0, currency: "EUR", category: "misc", status: "validated" } as const;
    await fs.writeFile(path.join(workspace.root, "transactions", "out.yaml"), yaml.stringify({ ...base, id: "out", date: "2026-09-30", label: "Prêt filiale", amount_ttc: -102, account: "pro" }));
    await fs.writeFile(path.join(workspace.root, "transactions", "in.yaml"), yaml.stringify({ ...base, id: "in", date: "2026-10-01", label: "Prêt reçu", amount_ttc: 100, account: "perso" })); invalidateTransactionCache();
    await saveTransactionAllocations(actor, "2026-10", "default:in", [{ scopeId: personId, amount: 100 }]);
    const transfer = await createPortfolioTransfer(actor, { kind: "confirmed", treatment: "intercompany_loan", sourceScopeId: "entity_default", destinationScopeId: personId, amount: 100, fee: 2, date: "2026-10-01", label: "Prêt", sourceTransactionKey: "default:out", destinationTransactionKey: "default:in" });
    expect(transfer.accountingLines.map((line) => line.accountCode)).toEqual(["267000", "512000", "512000", "168000", "627000"]);
    expect(transfer.accountingLines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
  });

  it("couvre les circuits personne, foyer, SCI, holding, filiale et compte courant", async () => {
    workspace.companies.push(
      { id: "sci", name: "SCI familiale", path: "companies/sci", kind: "business", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "holding", name: "Holding", path: "companies/holding", kind: "business", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "subsidiary", name: "Filiale", path: "companies/subsidiary", kind: "business", createdAt: "2026-01-01T00:00:00.000Z" },
    );
    let state = getPlatformState();
    state = createPerson({ name: "Alice", expectedRevision: state.revision });
    state = createHousehold({ name: "Foyer Alice", expectedRevision: state.revision });
    const actor = { id: "local", role: "local" as const };
    const person = state.people[0].id; const household = state.households[0].id;
    const cases = [
      { sourceScopeId: person, destinationScopeId: "entity_default", treatment: "capital_contribution" as const, label: "Personne vers entreprise" },
      { sourceScopeId: household, destinationScopeId: "entity_sci", treatment: "shareholder_current_account" as const, label: "Foyer vers SCI" },
      { sourceScopeId: "entity_holding", destinationScopeId: "entity_subsidiary", treatment: "intercompany_loan" as const, label: "Holding vers filiale" },
      { sourceScopeId: person, destinationScopeId: "entity_default", treatment: "shareholder_current_account" as const, label: "Compte courant associé" },
    ];
    for (const [index, item] of cases.entries()) {
      const transfer = await createPortfolioTransfer(actor, { kind: "planned", amount: 100 + index, fee: 0, date: "2026-10-15", frequency: "once", ...item });
      expect(transfer.workflowStatus).toBe("proposed");
      expect(transfer.accountingLines.reduce((sum, line) => sum + line.debit - line.credit, 0)).toBe(0);
    }
    const snapshot = await getPortfolioSnapshot(actor, person, 3, [person, household, "entity_default", "entity_sci", "entity_holding", "entity_subsidiary"], "2026-10");
    expect(snapshot.transfers.map((transfer) => transfer.label)).toEqual(cases.map((item) => item.label));
  });

  it("intègre les engagements et les hypothèses dans trois scénarios", async () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id; const actor = { id: "local", role: "local" as const };
    createPortfolioCommitment(actor, { scopeId: personId, kind: "investment", label: "Machine", amount: 500, dueDate: "2026-10-15", frequency: "once" });
    savePortfolioAssumptions(actor, { prudent: { revenueMultiplier: 0, expenseMultiplier: 1.2, safetyBuffer: 100 }, probable: { revenueMultiplier: 1, expenseMultiplier: 1, safetyBuffer: 0 }, optimistic: { revenueMultiplier: 1.2, expenseMultiplier: .9, safetyBuffer: 0 } });
    const snapshot = await getPortfolioSnapshot(actor, personId, 3, [personId], "2026-10");
    expect(snapshot.forecasts.prudent[0].expenses).toBe(600); expect(snapshot.timeline.some((item) => item.label === "Machine")).toBe(true); expect(snapshot.assumptions.prudent.safetyBuffer).toBe(100);
  });

  it("contrôle, valide, comptabilise puis contre-passe une correction", async () => {
    const initial = getPlatformState(); const state = createPerson({ name: "Alice", expectedRevision: initial.revision }); const personId = state.people[0].id; const actor = { id: "local", role: "local" as const };
    workspace.companies.push({ id: "alice", name: "Alice", path: "companies/alice", kind: "personal", scopeId: personId, createdAt: "2026-10-02T00:00:00.000Z" });
    const base = { date: "2026-10-02", amount_ht: 0, vat: 0, currency: "EUR", category: "misc", status: "validated" } as const;
    await fs.writeFile(path.join(workspace.root, "transactions", "workflow-out.yaml"), yaml.stringify({ ...base, id: "workflow-out", label: "Avance vers Alice", amount_ttc: -300, account: "pro" }));
    await fs.writeFile(path.join(workspace.root, "transactions", "workflow-in.yaml"), yaml.stringify({ ...base, id: "workflow-in", label: "Avance reçue", amount_ttc: 300, account: "perso" })); invalidateTransactionCache();
    await saveTransactionAllocations(actor, "2026-10", "default:workflow-out", [{ scopeId: "entity_default", amount: -300 }]);
    await saveTransactionAllocations(actor, "2026-10", "default:workflow-in", [{ scopeId: personId, amount: 300 }]);
    const created = await createPortfolioTransfer(actor, { kind: "confirmed", treatment: "shareholder_current_account", sourceScopeId: "entity_default", destinationScopeId: personId, amount: 300, date: "2026-10-02", label: "Avance associée", sourceTransactionKey: "default:workflow-out", destinationTransactionKey: "default:workflow-in" });
    expect((await advancePortfolioTransfer(actor, created.id, "review")).workflowStatus).toBe("reviewed");
    expect((await advancePortfolioTransfer(actor, created.id, "validate")).workflowStatus).toBe("validated");
    expect((await advancePortfolioTransfer(actor, created.id, "post")).workflowStatus).toBe("posted");
    const postedSource = JSON.parse(await fs.readFile(path.join(workspace.root, "settings", "portfolio_journal.json"), "utf-8")) as Array<{ transferId: string; reversal?: boolean; reversedAt?: string }>;
    const postedDestination = JSON.parse(await fs.readFile(path.join(workspace.root, "companies", "alice", "settings", "portfolio_journal.json"), "utf-8")) as typeof postedSource;
    expect([...postedSource, ...postedDestination].filter((line) => line.transferId === created.id)).toHaveLength(4);
    const corrected = await correctPortfolioTransfer(actor, created.id, { amount: 280, note: "Montant bancaire corrigé" });
    expect(corrected.workflowStatus).toBe("proposed");
    const sourceJournal = JSON.parse(await fs.readFile(path.join(workspace.root, "settings", "portfolio_journal.json"), "utf-8")) as Array<{ transferId: string; reversal?: boolean; reversedAt?: string }>;
    const destinationJournal = JSON.parse(await fs.readFile(path.join(workspace.root, "companies", "alice", "settings", "portfolio_journal.json"), "utf-8")) as typeof sourceJournal;
    const journal = [...sourceJournal, ...destinationJournal];
    expect(journal.filter((line) => line.transferId === created.id && line.reversal)).toHaveLength(4);
    expect(journal.filter((line) => line.transferId === created.id && line.reversedAt)).toHaveLength(4);
  });
});
