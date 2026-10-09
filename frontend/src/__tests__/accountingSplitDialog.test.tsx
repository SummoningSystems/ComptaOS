import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountingSplitDialog } from "../components/Transactions/TransactionsView";
import type { CategoryDefinition, Transaction } from "../types";

const transaction: Transaction = {
  id: "vat-payment", date: "2026-08-26", label: "ACOTVA/072026",
  amount_ht: -630, vat: 0, vat_rate: 0, amount_ttc: -630,
  currency: "EUR", category: "vat_advance_payment", account: "512100", status: "validated",
};

const categories: CategoryDefinition[] = [
  { id: "vat_advance_payment", label: "Acompte de TVA versé", account: { number: "445810", label: "Acomptes de TVA" }, kind: "expense", accountingNature: "balance_sheet", builtin: true, active: true },
  { id: "tax_penalty", label: "Pénalité fiscale non déductible", account: { number: "671200", label: "Pénalités fiscales" }, kind: "expense", builtin: true, active: true },
];

describe("AccountingSplitDialog", () => {
  it("enregistre 609 euros de TVA et 21 euros de pénalité pour un paiement de 630 euros", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AccountingSplitDialog txn={transaction} categories={categories} onSave={save} onClose={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Montant ligne 1"), { target: { value: "609" } });
    fireEvent.change(screen.getByLabelText("Montant ligne 2"), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la ventilation" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("vat-payment", [
      { category: "vat_advance_payment", amount: -609 },
      { category: "tax_penalty", amount: -21 },
    ]));
  });
});
