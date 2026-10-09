import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { generateAnnualFilingPdf, type AnnualFilingPdfInput } from "../services/annualFilingPdfService.js";

describe("liasse fiscale PDF officielle", () => {
  it("assemble la 2065, les 2033-A à G et pagine trois associés", async () => {
    const owners = ["Benoit Jurado", "Augustin Ambhiel", "Paul Derain"].map((name) => ({ kind: "person" as const, name, ownershipPercent: 33.33, shareCount: 3000, address: "1 rue Test 31000 Toulouse", birthDate: "1990-01-01", birthPlace: "Toulouse", legalForm: "", siren: "" }));
    const input: AnnualFilingPdfInput = {
      period: { startDate: "2025-10-01", endDate: "2026-09-30" },
      package: {
        identity: { name: "Summoning Systems", address: "9 rue Test 31000 Toulouse", siret: "93915460500017", siren: "939154605", email: "contact@example.test", activity: "Programmation informatique" },
        form2065: { taxableAt15: 14431.21, taxableAt25: 0, deficit: 0, accountingSoftware: "ComptaOS", signatory: { name: "Benoit Jurado", role: "Président", city: "Toulouse", date: "2026-10-09" } },
        form2033C: { fixedAssets: [{ code: "tangible", openingGross: 883, increases: 0, decreases: 0, closingGross: 883, openingDepreciation: 194, depreciationCharge: 294.33, depreciationDecrease: 0, closingDepreciation: 488.33 }], capitalGains: { saleProceeds: 0, netBookValueDisposed: 0, netGain: 0 } },
        form2033D: { provisions: [], lossCarryforwards: 0, vatCollected: 3439.02, vatDeductible: 1116.18 },
        form2033E: { turnover: 24895.11, production: 24895.11, externalConsumption: 10169.31, valueAdded: 14725.8, taxes: .26, averageEmployees: 0 },
        form2033F: { owners, totalShares: 9000 }, form2033G: { subsidiaries: [] },
      },
      statements: { balanceSheet: { assets: [], liabilities: [], fixedAssetsTotal: 394.67, currentAssetsTotal: 24000, totalAssets: 24394.67, equityTotal: 20000, debtsTotal: 4394.67, totalLiabilities: 24394.67 }, profitAndLoss: { fields: [] }, fiscalTable: { fields: [{ code: "370", value: 14431.21 }] } },
    };
    const bytes = await generateAnnualFilingPdf(input); const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(10);
    expect(bytes.byteLength).toBeGreaterThan(400_000);
    expect(pdf.getTitle()).toContain("Summoning Systems");
  });
});
