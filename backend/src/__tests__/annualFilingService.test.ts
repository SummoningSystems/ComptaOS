import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
const platform = vi.hoisted(() => ({ relations: [{ id: "owner", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 100, shareCount: 90 }] }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
vi.mock("../services/companiesService.js", () => ({ getActiveCompanyId: () => "company" }));
vi.mock("../services/settingsService.js", () => ({ loadCompanyProfile: () => ({ name: "Summoning Systems", legalForm: "SAS", siren: "123456789", siret: "12345678900012", address: "9 rue Test", postalCode: "31500", city: "Toulouse", capital: "900" }) }));
vi.mock("../services/platformService.js", () => ({ getPlatformState: () => ({ entities: [{ id: "entity", workspaceId: "company", name: "Summoning Systems" }], people: [{ id: "person", name: "Benoît Jurado" }], relations: platform.relations, households: [], accounts: [], grants: [] }) }));
import { buildAnnualFilingPackage, saveAnnualFilingConfig } from "../services/annualFilingService.js";

const period = { id: "fy", startDate: "2025-10-01", endDate: "2026-09-30" };
const line = (accountNumber: string, debit: number, credit: number) => ({ journalCode: "OD", journalLabel: "Inventaire", entryNumber: "1", entryDate: period.endDate, accountNumber, accountLabel: accountNumber, pieceRef: "INV", pieceDate: period.endDate, label: "Test", debit, credit, transactionId: accountNumber });

describe("dossier final 2065 et 2033-C à G", () => {
  beforeEach(async () => { platform.relations = [{ id: "owner", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 100, shareCount: 90 }]; workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-filing-")); await fs.mkdir(path.join(workspace.root, "settings"), { recursive: true }); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("reconstitue les immobilisations et ne devient prêt qu’après les confirmations", () => {
    saveAnnualFilingConfig(period.id, { activity: "Développement de logiciels", signatoryName: "Benoît Jurado", signatoryRole: "Président", signatoryCity: "Toulouse", declarationDate: "2026-10-09", averageEmployees: 0, accountingSoftware: "ComptaOS", ownerDetails: { owner: { address: "1 rue Test 31500 Toulouse", birthDate: "1990-01-01", birthPlace: "Toulouse", legalForm: "", siren: "" } }, subsidiaryDetails: {}, review: { fixedAssets: true, provisionsAndLosses: true, valueAdded: true, capitalAndOwners: true, subsidiaries: true, corporateTaxReturn: true } });
    const pack = buildAnnualFilingPackage({
      period,
      openingBalance: [{ id: "1", accountNumber: "218300", accountLabel: "Matériel", debit: 883, credit: 0 }, { id: "2", accountNumber: "281830", accountLabel: "Amortissements", debit: 0, credit: 194 }],
      balances: [{ accountNumber: "218300", accountLabel: "Matériel", debit: 883, credit: 0, balance: 883 }, { accountNumber: "281830", accountLabel: "Amortissements", debit: 0, credit: 488.33, balance: -488.33 }],
      lines: [line("681120", 294.33, 0), line("281830", 0, 294.33), line("706000", 0, 24895.11), line("60", 1000, 0)],
      statements: { balanceSheet: { totalAssets: 1000, totalLiabilities: 1000, difference: 0 }, fiscalTable: { fields: [{ code: "360", label: "Déficits imputés", value: 0 }] } },
      tax: { turnover: 24895.11, taxableBase: 14431.21, reducedBase: 14431.21, normalBase: 0, grossTax: 2164.68, taxCredits: 0, netTax: 2164.68, prepayments: 0, balance: 2164.68 },
    });
    expect(pack.form2033C.fixedAssets).toContainEqual(expect.objectContaining({ code: "tangible", openingGross: 883, openingDepreciation: 194, depreciationCharge: 294.33, closingDepreciation: 488.33, closingNet: 394.67 }));
    expect(pack.form2033F).toMatchObject({ capital: 900, ownershipTotal: 100, totalShares: 90, owners: [{ name: "Benoît Jurado", ownershipPercent: 100, shareCount: 90 }] });
    expect(pack.ready).toBe(true);
  });

  it("bloque le 2033-F quand les titres et les pourcentages se contredisent", () => {
    platform.relations = [{ id: "owner", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 34, shareCount: 90 }];
    const pack = buildAnnualFilingPackage({
      period,
      openingBalance: [], balances: [], lines: [],
      statements: { balanceSheet: { totalAssets: 0, totalLiabilities: 0, difference: 0 }, fiscalTable: { fields: [] } },
      tax: { turnover: 0, taxableBase: 0, reducedBase: 0, normalBase: 0, grossTax: 0, taxCredits: 0, netTax: 0, prepayments: 0, balance: 0 },
    });
    expect(pack.missing).toContain("Cohérence entre le nombre de titres et les pourcentages de détention (2033-F)");
    expect(pack.ready).toBe(false);
  });

  it("accepte 99,99 % quand trois tiers égaux sont arrondis à 33,33 %", () => {
    platform.relations = [
      { id: "owner-1", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 33.33, shareCount: 3000 },
      { id: "owner-2", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 33.33, shareCount: 3000 },
      { id: "owner-3", fromId: "person", toId: "entity", type: "shareholder", ownershipPercent: 33.33, shareCount: 3000 },
    ];
    const pack = buildAnnualFilingPackage({
      period,
      openingBalance: [], balances: [], lines: [],
      statements: { balanceSheet: { totalAssets: 0, totalLiabilities: 0, difference: 0 }, fiscalTable: { fields: [] } },
      tax: { turnover: 0, taxableBase: 0, reducedBase: 0, normalBase: 0, grossTax: 0, taxCredits: 0, netTax: 0, prepayments: 0, balance: 0 },
    });
    expect(pack.form2033F).toMatchObject({ ownershipTotal: 99.99, totalShares: 9000 });
    expect(pack.missing).not.toContain("Répartition du capital à 100 % (actuellement 99.99 %)");
    expect(pack.missing).not.toContain("Cohérence entre le nombre de titres et les pourcentages de détention (2033-F)");
  });
});
