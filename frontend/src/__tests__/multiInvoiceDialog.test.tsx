import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MultiInvoiceDialog } from "../components/Transactions/MultiInvoiceDialog";
import type { Transaction } from "../types";

const api = vi.hoisted(() => ({
  uploadPendingReceipt: vi.fn(),
  analyzePendingReceipt: vi.fn(),
  linkPendingReceiptGroup: vi.fn(),
  updatePendingReceiptOcr: vi.fn(),
  deletePendingReceipt: vi.fn(),
}));

vi.mock("../api/client", () => ({
  ...api,
  attachmentUrl: (filename: string) => `/api/attachments/${filename}`,
}));

const transaction: Transaction = { id: "amazon", date: "2026-03-02", label: "AMAZON PAYMENTS", amount_ht: -130.41, vat: 0, amount_ttc: -130.41, currency: "EUR", category: "equipment", account: "main", status: "pending" };

function receipt(id: string, amountTtc: number) {
  return { id, filename: `${id}.pdf`, originalName: `${id}.pdf`, mimetype: "application/pdf", createdAt: "2026-03-02T00:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Amazon", amountHt: amountTtc / 1.2, amountVat: amountTtc - amountTtc / 1.2, amountTtc, category: "equipment", confidence: "high" as const, vatSplits: [{ rate: 20, amountTtc }] } } };
}

describe("mode multi-factures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consolide deux factures uniquement lorsque leur somme correspond au débit", async () => {
    const first = receipt("facture-1", 80);
    const second = receipt("facture-2", 50.41);
    api.uploadPendingReceipt.mockResolvedValueOnce({ receipt: first }).mockResolvedValueOnce({ receipt: second });
    api.analyzePendingReceipt.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    api.linkPendingReceiptGroup.mockResolvedValue({ transaction: { ...transaction, attachments: [first.filename, second.filename] }, transactions: [], appliedProposal: true });
    const onComplete = vi.fn();
    render(<MultiInvoiceDialog transaction={transaction} onComplete={onComplete} onClose={vi.fn()} />);

    const input = screen.getByLabelText("Fichiers multi-factures");
    fireEvent.change(input, { target: { files: [new File(["a"], "a.pdf", { type: "application/pdf" }), new File(["b"], "b.pdf", { type: "application/pdf" })] } });

    await waitFor(() => expect(screen.getByText("130.41 €", { selector: "strong" })).toBeVisible());
    const apply = screen.getByRole("button", { name: "Associer et consolider les factures" });
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    await waitFor(() => expect(api.linkPendingReceiptGroup).toHaveBeenCalledWith(["facture-1", "facture-2"], "amazon", expect.any(Object)));
    expect(onComplete).toHaveBeenCalled();
  });
});
