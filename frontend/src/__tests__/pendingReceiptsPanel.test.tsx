import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingReceiptsPanel } from "../components/Transactions/PendingReceiptsPanel";

vi.mock("../api/client", () => ({
  attachmentUrl: (filename: string) => `/api/attachments/file/${filename}`,
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
}));

describe("justificatifs en attente sur ordinateur", () => {
  it("affiche la photo mobile et permet de choisir une transaction", async () => {
    render(<PendingReceiptsPanel transactions={[{ id: "meal", date: "2026-08-05", label: "Restaurant", amount_ht: -20, vat: 0, amount_ttc: -20, currency: "EUR", category: "restaurant", account: "main", status: "pending" }]} onLinked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Justificatifs en attente")).toBeVisible());
    expect(screen.getByAltText("Aperçu de photo-mobile.jpg")).toHaveAttribute("src", "/api/attachments/file/receipt_phone.jpg");
    expect(screen.getByRole("option", { name: "2026-08-05 · Restaurant · 20.00 €" })).toBeVisible();
  });
});
