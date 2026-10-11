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
    form2033C: { fixedAssets: [{ label: "Immobilisations corporelles", closingGross: 883, closingDepreciation: 488.33 }] },
    form2033D: { lossCarryforwards: 0 }, form2033E: { production: 24895.11, valueAdded: 14725.8 },
    form2033F: { owners: [{ name: "Benoit Jurado", ownershipPercent: 33.34, shareCount: 3000 }] }, form2033G: { subsidiaries: [] },
  },
  simplifiedStatements: { balanceSheet: { assets: [{ code: "014", label: "Immobilisations", value: 1094.67, sourceAccounts: ["218300"] }], liabilities: [{ code: "142", label: "Capital", value: 900, sourceAccounts: ["101000"] }] }, profitAndLoss: { fields: [{ code: "310", label: "Production vendue", value: 24895.11, sourceAccounts: ["706000"] }] }, fiscalTable: { fields: [{ code: "352", label: "Réintégrations", value: 30 }] } },
  taxCalculation: {}, fiscalSummary: { accountingResult: 12266.53 }, accountingSummary: { balances: [] },
};

describe("conformité de clôture annuelle", () => {
  beforeEach(async () => { workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-annual-compliance-")); });
  afterEach(async () => { await fs.rm(workspace.root, { recursive: true, force: true }); });

  it("produit une grille EFI et un paquet TDFC préparatoire explicitement non transmissible", () => {
    const fields = buildEfiGuide(source); const payload = buildTdfcPreparation(source);
    expect(fields).toContainEqual(expect.objectContaining({ form: "2065", code: "BENEFICE-15", value: 14431.21 }));
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
