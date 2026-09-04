import { describe, expect, it } from "vitest";
import type { Transaction } from "../types";
import { matchesTransactionSearch } from "../utils/transactionSearch";

const transaction = { id: "t1", date: "2026-09-04", label: "Marie Blachère", amount_ttc: -44.4, amount_ht: -40.36, vat: -4.04, currency: "EUR", category: "restaurant", account: "main", status: "validated", invoiceRef: "FAC-42" } as Transaction;

describe("matchesTransactionSearch", () => {
  it("recherche les montants avec virgule ou point", () => {
    expect(matchesTransactionSearch(transaction, "44,40")).toBe(true);
    expect(matchesTransactionSearch(transaction, "44.4")).toBe(true);
    expect(matchesTransactionSearch(transaction, "-44.40")).toBe(true);
  });
  it("respecte le signe lorsqu'il est saisi", () => {
    expect(matchesTransactionSearch(transaction, "+44.40")).toBe(false);
  });
  it("conserve la recherche textuelle et par référence", () => {
    expect(matchesTransactionSearch(transaction, "blachere")).toBe(true);
    expect(matchesTransactionSearch(transaction, "FAC-42")).toBe(true);
  });
});
