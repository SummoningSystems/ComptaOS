import { describe, expect, it } from "vitest";
import { apiErrorMessage, buildApiUrl } from "../api/client";

describe("buildApiUrl", () => {
  it("construit une URL API à la racine", () => {
    expect(buildApiUrl("/", "/transactions")).toBe("/api/transactions");
  });

  it("conserve le sous-chemin de déploiement", () => {
    expect(buildApiUrl("/comptaos/", "/reports/vat-pdf?year=2026")).toBe(
      "/comptaos/api/reports/vat-pdf?year=2026",
    );
  });

  it("normalise les séparateurs", () => {
    expect(buildApiUrl("/comptaos", "//alerts")).toBe("/comptaos/api/alerts");
  });
});

describe("apiErrorMessage", () => {
  it("affiche le message métier d'une réponse API", () => {
    expect(apiErrorMessage({
      response: { data: { message: "L’exercice est verrouillé." } },
      message: "Request failed with status code 409",
    })).toBe("L’exercice est verrouillé.");
  });
});
