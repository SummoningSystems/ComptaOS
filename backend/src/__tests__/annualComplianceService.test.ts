import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/fileSystem.js", () => ({ getWorkspaceRoot: () => workspace.root }));
import { attachTransmissionReceipt, buildEfiGuide, buildTdfcPreparation, createAnnualArchive, createTaxTransmission, generateApprovalMinutes, getGovernanceConfig, listTaxTransmissions, saveGovernanceConfig, updateTaxTransmission } from "../services/annualComplianceService.js";

const source: any = {
  period: { id: "fy_2026", startDate: "2025-10-01", endDate: "2026-09-30", label: "Exercice 2026" },
  filingPackage: {
    identity: { name: "Summoning Systems", legalForm: "SAS", siren: "939154605", siret: "93915460500017", address: "30 boulevard de Sébastopol 75004 Paris", capital: "900" },
    form2065: { taxableAt15: 14431.21, taxableAt25: 0, grossTax: 2164.68, netTax: 2164.68, prepayments: 0, balance: 2164.68, signatory: { city: "Toulouse", name: "Benoit Jurado", role: "Président" } },
    form2033C: { fixedAssets: [{ code: "tangible", label: "Immobilisations corporelles", openingGross: 883, increases: 0, decreases: 0, closingGross: 883, openingDepreciation: 194, depreciationCharge: 294.33, depreciationDecrease: 0, closingDepreciation: 488.33 }], capitalGains: { saleProceeds: 0 } },
    form2033D: { provisions: [], lossCarryforwards: 0, vatCollected: 3439.02, vatDeductible: 1116.18 }, form2033E: { turnover: 24895.11, production: 24895.11, externalConsumption: 10169.31, valueAdded: 14725.8, taxes: 1963.09, averageEmployees: 0 },
    form2033F: { owners: [{ name: "Benoit Jurado", ownershipPercent: 33.34, shareCount: 3000 }] }, form2033G: { subsidiaries: [] },
  },
  simplifiedStatements: { balanceSheet: { assets: [{ code: "028/030", label: "Immobilisations corporelles — net", value: 394.67, sourceAccounts: ["218300", "281830"] }], liabilities: [{ code: "120", label: "Capital", value: 900, sourceAccounts: ["101000"] }, { code: "172", label: "Dettes fiscales et sociales", value: 3439.02, sourceAccounts: ["445710"] }] }, profitAndLoss: { fields: [{ code: "218", label: "Production vendue — services", value: 24895.11, sourceAccounts: ["706000"] }, { code: "310", label: "Bénéfice comptable", value: 12266.53, sourceAccounts: [] }] }, fiscalTable: { fields: [{ code: "352", label: "Résultat fiscal", value: 14431.21 }], reintegrations: [{ kind: "fines_penalties", amount: 30 }], deductions: [], lossCarryforwards: [] } },
  taxCalculation: {}, fiscalSummary: { accountingResult: 12266.53 }, accountingSummary: { balances: [{ accountNumber: "218300", balance: 883 }, { accountNumber: "281830", balance: -488.33 }, { accountNumber: "445710", balance: -3439.02 }] },
};

describe("conformité de clôture annuelle", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-annual-compliance-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("produit une grille EFI et un paquet TDFC préparatoire explicitement non transmissible", () => {
    const fields = buildEfiGuide(source); const payload = buildTdfcPreparation(source);
    expect(fields).toContainEqual(expect.objectContaining({ form: "2065", code: "BENEFICE-15", value: 14431.21, formattedValue: "14 431", copyValue: "14431" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2572-SD", code: "IS-NET", value: 2164.68, copyValue: "2165" }));
    expect(fields).not.toContainEqual(expect.objectContaining({ form: "2065", code: "IS-NET" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "028", value: 883, copyValue: "883", column: "Brut", portalFieldId: "A304330_0" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "030", value: 488.33, copyValue: "488", column: "Amortissements / provisions", portalFieldId: "A304345_0" }));
    expect(fields).not.toContainEqual(expect.objectContaining({ form: "2033-A", code: "028/030" }));
    const clientSource = { ...source, simplifiedStatements: { ...source.simplifiedStatements, balanceSheet: { ...source.simplifiedStatements.balanceSheet, assets: [{ code: "068/070", label: "Clients et comptes rattachés", value: 4800, sourceAccounts: ["411000"] }] } }, accountingSummary: { balances: [{ accountNumber: "411000", balance: 4800 }] } };
    expect(buildEfiGuide(clientSource)).toContainEqual(expect.objectContaining({ code: "068", label: "Créances (2) clients et comptes rattachés — brut", portalFieldId: "A304336_0", copyValue: "4800" }));
    const receivableSource = { ...clientSource, simplifiedStatements: { ...clientSource.simplifiedStatements, balanceSheet: { ...clientSource.simplifiedStatements.balanceSheet, assets: [{ code: "072/074", label: "Autres créances", value: 1116.18, sourceAccounts: ["445660"] }] } }, accountingSummary: { balances: [{ accountNumber: "445660", balance: 1116.18 }] } };
    expect(buildEfiGuide(receivableSource)).toContainEqual(expect.objectContaining({ code: "072", label: "Créances autres (3) — brut", portalFieldId: "A304337_0", copyValue: "1116" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "120", portalFieldId: "A304391_0" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "DONT-TVA", portalFieldId: "A913095_0", copyValue: "3439" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "172", portalFieldId: "A913096_0", copyValue: "3439" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "RENVOI-5-ACQ", portalFieldId: "A304429_0", value: 0 }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-A", code: "RENVOI-1", portalFieldId: "A304425_0", manualReview: true }));
    expect((payload.forms as any)["2033-A"]).toContainEqual(expect.objectContaining({ code: "028", portalFieldId: "A304330_0", column: "Brut", value: 883 }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-B", code: "218", portalFieldId: "A304451_0", copyValue: "24895" }));
    expect(fields).not.toContainEqual(expect.objectContaining({ form: "2033-B", code: "310" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-B", code: "IMPOTS-NON-DEDUCTIBLES", portalFieldId: "A304480_0", value: 30 }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-C", code: "OTHER_TANGIBLE-1", portalFieldId: "A304531_0", value: 883 }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-C", code: "OTHER_TANGIBLE-AMORT-2", portalFieldId: "A304587_0", value: 294.33, copyValue: "294" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-D", code: "TVA-COLLECTEE", portalFieldId: "A907430_0", copyValue: "3439" }));
    expect(fields).toContainEqual(expect.objectContaining({ form: "2033-E", code: "EFFECTIF", portalFieldId: "A907434_0", copyValue: "0" }));
    const exemptSource = { ...source, filingPackage: { ...source.filingPackage, form2033E: { ...source.filingPackage.form2033E, exempt: true } } };
    const exemptFields = buildEfiGuide(exemptSource);
    expect(exemptFields).toContainEqual(expect.objectContaining({ form: "2033-E", code: "NEANT", portalFieldId: "A305681_0", copyValue: "Oui" }));
    expect(exemptFields).not.toContainEqual(expect.objectContaining({ form: "2033-E", code: "CA-CVAE" }));
    expect(payload).toMatchObject({ format: "COMPTAOS-TDFC-PREPARATION", schemaVersion: "2026.1", officialInterchange: false, transmittableDirectly: false, requiresPartnerEdi: true });
    expect(payload.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("trace les états de transmission, l'accusé et une correction", () => {
    const draft = createTaxTransmission(source.period.id, "edi", "hash-1");
    updateTaxTransmission(source.period.id, draft.id, "validate", "hash-1");
    updateTaxTransmission(source.period.id, draft.id, "mark_sent", "hash-1");
    attachTransmissionReceipt(source.period.id, draft.id, { fileName: "compte-rendu.pdf", contentBase64: Buffer.from("accuse").toString("base64"), outcome: "rejected", note: "Erreur de contrôle" });
    const correction = createTaxTransmission(source.period.id, "edi", "hash-2", draft.id);
    expect(listTaxTransmissions(source.period.id)).toEqual(expect.arrayContaining([expect.objectContaining({ id: draft.id, status: "rejected", receipt: expect.objectContaining({ outcome: "rejected" }) }), expect.objectContaining({ id: correction.id, revision: 2, correctionOf: draft.id })]));
  });

  it("contrôle l'affectation du résultat et génère un projet de PV", async () => {
    const proposed = getGovernanceConfig(source.period.id, source);
    expect(() => saveGovernanceConfig(source.period.id, { ...proposed, meetingDate: "2027-02-01", meetingPlace: "Toulouse", chairName: "Benoit Jurado", retainedEarnings: 1, approvalVoteResult: "Adoptée", allocationVoteResult: "Adoptée", powersVoteResult: "Adoptée" }, source.fiscalSummary.accountingResult)).toThrow("doit correspondre");
    const saved = saveGovernanceConfig(source.period.id, { ...proposed, meetingDate: "2027-02-01", meetingPlace: "Toulouse", chairName: "Benoit Jurado", retainedEarnings: source.fiscalSummary.accountingResult - proposed.legalReserve, approvalVoteResult: "Adoptée à l’unanimité", allocationVoteResult: "Adoptée à l’unanimité", powersVoteResult: "Adoptée à l’unanimité" }, source.fiscalSummary.accountingResult);
    const pdf = await generateApprovalMinutes(source, saved);
    expect(Buffer.from(pdf).subarray(0, 4).toString()).toBe("%PDF");
  });

  it("crée une archive ZIP horodatée avec les exports comptables", async () => {
    const archive = await createAnnualArchive({ source, transactions: [], filingPdf: Buffer.from("%PDF-test"), tdfc: buildTdfcPreparation(source), preview: { year: "fy_2026", eligibleCount: 0, excludedCount: 0, lines: [], balances: [], anomalies: [], totalDebit: 0, totalCredit: 0, balanced: true } });
    const bytes = await fs.readFile(path.join(workspace.root, archive.relativePath));
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(archive.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
