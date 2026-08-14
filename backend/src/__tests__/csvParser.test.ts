import { describe, it, expect } from "vitest";
import { parseCsv } from "../services/csvParser.js";

const MAP_DEBIT_CREDIT = { date: "Date", label: "Label", debit: "Debit", credit: "Credit" };

function tabCsv(headers: string[], rows: string[][]): string {
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n");
}

describe("parseFrenchAmount", () => {
  it("parse un débit entier", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "Test", "100", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.amount_ttc).toBeCloseTo(-100);
  });

  it("parse un montant décimal avec point", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "Test", "4200.00", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.amount_ttc).toBeCloseTo(-4200.0);
  });

  it("crédit positif", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "Virement", "", "500.00"]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.amount_ttc).toBeCloseTo(500.0);
  });

  it("retourne 0 si les deux champs vides", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "Test", "", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.amount_ttc).toBe(0);
  });
});

describe("normalizeDate", () => {
  it("convertit DD/MM/YYYY en YYYY-MM-DD", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["15/06/2024", "Test", "10", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.date).toBe("2024-06-15");
  });

  it("accepte le format ISO", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-15", "Test", "10", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.date).toBe("2024-01-15");
  });
});

describe("mapPenylaneCategory (via colonne 'Types de dépenses / revenus')", () => {
  function parseWithCategory(penylane: string): string {
    const csv = tabCsv(
      ["Date", "Label", "Debit", "Credit", "Types de dépenses / revenus"],
      [["2024-01-01", "Test", "10", "", penylane]]
    );
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    return tx.category;
  }

  it("Logiciel → software", () => expect(parseWithCategory("Logiciel")).toBe("software"));
  it("Hébergement → hosting", () => expect(parseWithCategory("Hébergement")).toBe("hosting"));
  it("Loyer → rent", () => expect(parseWithCategory("Loyer")).toBe("rent"));
  it("Déplacement → travel", () => expect(parseWithCategory("Déplacement")).toBe("travel"));
  it("Alimentaire → food", () => expect(parseWithCategory("Alimentaire")).toBe("food"));
  it("Restaurant → restaurant", () => expect(parseWithCategory("Restaurant")).toBe("restaurant"));
  it("Salaire → salary", () => expect(parseWithCategory("Salaire")).toBe("salary"));
  it("Sous-traitance → subcontracting", () => expect(parseWithCategory("Sous-traitance")).toBe("subcontracting"));
  it("Honoraires → professional_fees", () => expect(parseWithCategory("Honoraires consultant")).toBe("professional_fees"));
  it("Prestataire → external_services", () => expect(parseWithCategory("Prestataire extérieur")).toBe("external_services"));
  it("Impôt → taxes", () => expect(parseWithCategory("Impôt")).toBe("taxes"));
  it("Assurance → insurance", () => expect(parseWithCategory("Assurance")).toBe("insurance"));
  it("Inconnu → misc", () => expect(parseWithCategory("Autre chose")).toBe("misc"));
});

describe("detectCategoryFromLabel (priorité sur Penylane)", () => {
  function parseWithLabel(label: string): string {
    const csv = tabCsv(
      ["Date", "Label", "Debit", "Credit", "Types de dépenses / revenus"],
      [["2024-01-01", label, "10", "", "Divers"]]
    );
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    return tx.category;
  }

  it("GITHUB PAY → software", () => expect(parseWithLabel("GITHUB PAY")).toBe("software"));
  it("VALVE STEAM → software", () => expect(parseWithLabel("VALVE STEAM")).toBe("software"));
  it("HISCOX ASSURANCE → insurance", () => expect(parseWithLabel("HISCOX ASSURANCE")).toBe("insurance"));
  it("AMAZON MARKETPLACE → equipment", () => expect(parseWithLabel("AMAZON MARKETPLACE")).toBe("equipment"));
  it("SNCF VOYAGE → travel", () => expect(parseWithLabel("SNCF VOYAGE")).toBe("travel"));
  it("FREE PRO INTERNET → hosting", () => expect(parseWithLabel("FREE PRO INTERNET")).toBe("hosting"));
  it("IMPOTS TRESOR → taxes", () => expect(parseWithLabel("IMPOTS TRESOR")).toBe("taxes"));
});

describe("applyCategoryRules", () => {
  it("règle utilisateur écrase la détection automatique", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "AMAZON MARKETPLACE", "10", ""]]);
    const rules = [{ id: "rule_amazon_food", pattern: "amazon", category: "food" as const, priority: 1 }];
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT, rules);
    expect(tx.category).toBe("food");
  });

  it("sans règle Amazon → equipment", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "AMAZON MARKETPLACE", "10", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.category).toBe("equipment");
  });
});

describe("lecture colonnes Compte Bancaire et Tiers", () => {
  it("lit le compte depuis 'Compte Bancaire'", () => {
    const csv = tabCsv(
      ["Date", "Label", "Debit", "Credit", "Compte Bancaire"],
      [["2024-01-01", "Test", "10", "", "LCL Pro"]]
    );
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.account).toBe("LCL Pro");
  });

  it("utilise 'main' si la colonne est absente", () => {
    const csv = tabCsv(["Date", "Label", "Debit", "Credit"], [["2024-01-01", "Test", "10", ""]]);
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.account).toBe("main");
  });

  it("place le tiers dans notes", () => {
    const csv = tabCsv(
      ["Date", "Label", "Debit", "Credit", "Tiers"],
      [["2024-01-01", "Facture Acme", "100", "", "Acme Corp"]]
    );
    const [tx] = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(tx.notes).toBe("Acme Corp");
  });
});

describe("filtrage lignes invalides", () => {
  it("ignore les lignes sans date ou sans label", () => {
    const csv = tabCsv(
      ["Date", "Label", "Debit", "Credit"],
      [
        ["", "Test sans date", "10", ""],
        ["2024-01-01", "", "10", ""],
        ["2024-01-01", "Valide", "50", ""],
      ]
    );
    const txns = parseCsv(csv, MAP_DEBIT_CREDIT);
    expect(txns).toHaveLength(1);
    expect(txns[0].label).toBe("Valide");
  });
});
