import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReceiptOcrDialog } from "../components/Transactions/ReceiptOcrDialog";
import type { Transaction } from "../types";

const transaction: Transaction = { id: "meal", date: "2026-08-04", label: "Restaurant", amount_ht: -30, vat: 0, amount_ttc: -30, currency: "EUR", category: "misc", account: "main", status: "pending", attachment: "meal.jpg" };

describe("vérification OCR d'un justificatif", () => {
  it("permet de corriger puis d'appliquer une ventilation multi-TVA", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<ReceiptOcrDialog transaction={transaction} proposal={{ supplier: "Bistro", date: "2026-08-04", invoiceRef: "42", amountHt: 26.51, amountTtc: 30, category: "restaurant", confidence: "high", vatSplits: [{ rate: 10, amountTtc: 20 }, { rate: 20, amountTtc: 10 }] }} onApply={onApply} onClose={vi.fn()} />);
    expect(screen.getByText("Total conforme à la banque")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Montant TTC OCR 2"), { target: { value: "9" } });
    expect(screen.getByRole("button", { name: "Appliquer la TVA proposée" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Montant TTC OCR 2"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Appliquer la TVA proposée" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ category: "restaurant", invoiceRef: "42", vatSplits: [{ rate: 10, amountTtc: 20 }, { rate: 20, amountTtc: 10 }] }));
  });
  it("laisse toujours la possibilité de fermer et saisir manuellement", () => {
    const onClose = vi.fn(); render(<ReceiptOcrDialog transaction={transaction} proposal={{ supplier: "", amountHt: 0, amountTtc: 0, category: "misc", confidence: "low", vatSplits: [] }} onApply={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Fermer et saisir manuellement" })); expect(onClose).toHaveBeenCalled();
  });
});
