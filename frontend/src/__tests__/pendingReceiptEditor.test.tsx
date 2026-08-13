import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PendingReceiptEditor } from "../components/Transactions/PendingReceiptEditor";

describe("validation humaine d'un justificatif OCR", () => {
  it("conserve le brut et enregistre une ventilation corrigée", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PendingReceiptEditor receipt={{ id: "r1", filename: "r1.jpg", originalName: "ticket.jpg", mimetype: "image/jpeg", createdAt: "2026-08-13T10:00:00Z", ocr: { status: "success", rawText: "TOTAL 31.50", proposal: { supplier: "Restaurant", amountHt: 28.34, amountTtc: 31.5, category: "restaurant", confidence: "low", vatSplits: [{ rate: 10, amountTtc: 27.58 }, { rate: 20, amountTtc: 3.92 }] } } }} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Afficher le texte OCR brut")); expect(screen.getByText("TOTAL 31.50")).toBeVisible();
    fireEvent.click(screen.getByText("Enregistrer la vérification"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ supplier: "Restaurant", amountTtc: 31.5, amountVat: 3.16, confidence: "high" })));
  });
});
