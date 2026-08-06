import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingReceiptsPanel, suggestReceiptMatches } from "../components/Transactions/PendingReceiptsPanel";

vi.mock("../api/client", () => ({
  attachmentUrl: (filename: string) => `/api/attachments/file/${filename}`,
  analyzePendingReceipt: vi.fn(),
  fetchPendingReceipts: vi.fn().mockResolvedValue([{
    id: "receipt_phone",
    filename: "receipt_phone.jpg",
    originalName: "photo-mobile.jpg",
    mimetype: "image/jpeg",
    createdAt: "2026-08-05T12:26:14.945Z",
    ocr: { status: "error", message: "OCR temporairement indisponible" },
  }]),
  linkPendingReceipt: vi.fn(),
  deletePendingReceipt: vi.fn(),
  uploadPendingReceipt: vi.fn(),
}));

describe("justificatifs en attente sur ordinateur", () => {
  it("affiche la photo mobile et permet de choisir une transaction", async () => {
    render(<PendingReceiptsPanel transactions={[{ id: "meal", date: "2026-08-05", label: "Restaurant", amount_ht: -20, vat: 0, amount_ttc: -20, currency: "EUR", category: "restaurant", account: "main", status: "pending" }]} onLinked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Justificatifs en attente")).toBeVisible());
    expect(screen.getByAltText("Aperçu de photo-mobile.jpg")).toHaveAttribute("src", "/api/attachments/file/receipt_phone.jpg");
    expect(screen.getByRole("option", { name: "2026-08-05 · Restaurant · 20.00 €" })).toBeVisible();
  });

  it("propose un rapprochement unique à partir du montant, de la date et du fournisseur", () => {
    const receipt = { id: "receipt_yankee", filename: "ticket.jpg", originalName: "ticket.jpg", mimetype: "image/jpeg", createdAt: "2026-08-05T12:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Yankee Grill", date: "2026-08-03", amountHt: 23.68, amountTtc: 26.8, category: "restaurant" as const, vatSplits: [{ rate: 10, amountTtc: 17.8 }, { rate: 20, amountTtc: 9 }], confidence: "high" as const } } };
    const transactions = [
      { id: "right", date: "2026-08-03", label: "YANKEE LAND", amount_ht: -26.8, vat: 0, amount_ttc: -26.8, currency: "EUR", category: "restaurant" as const, account: "main", status: "pending" as const },
      { id: "wrong", date: "2026-07-01", label: "Autre", amount_ht: -26.8, vat: 0, amount_ttc: -26.8, currency: "EUR", category: "misc" as const, account: "main", status: "pending" as const },
    ];
    expect(suggestReceiptMatches([receipt], transactions).receipt_yankee).toMatchObject({ transactionId: "right", confidence: "high" });
  });

  it("propose au moins une transaction lorsque le montant est identique malgré une ambiguïté", () => {
    const receipt = { id: "ambiguous", filename: "ticket.jpg", originalName: "ticket.jpg", mimetype: "image/jpeg", createdAt: "2026-08-05T12:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Inconnu", amountHt: 10, amountTtc: 12, category: "misc" as const, vatSplits: [], confidence: "low" as const } } };
    const makeTransaction = (id: string) => ({ id, date: "2026-08-03", label: id, amount_ht: -12, vat: 0, amount_ttc: -12, currency: "EUR", category: "misc" as const, account: "main", status: "pending" as const });
    expect(suggestReceiptMatches([receipt], [makeTransaction("one"), makeTransaction("two")]).ambiguous).toMatchObject({ transactionId: "one", confidence: "low" });
  });
});
