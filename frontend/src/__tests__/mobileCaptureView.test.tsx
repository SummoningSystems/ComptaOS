import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileCaptureView } from "../components/Mobile/MobileCaptureView";

vi.mock("../api/client", () => ({
  fetchTransactions: vi.fn().mockResolvedValue([{ id: "meal", date: "2026-08-04", label: "Bistro", amount_ht: -30, vat: 0, amount_ttc: -30, currency: "EUR", category: "restaurant", account: "main", status: "pending" }]),
  fetchPendingReceipts: vi.fn().mockResolvedValue([]),
  updateTransaction: vi.fn(), uploadAttachment: vi.fn(), uploadPendingReceipt: vi.fn(), linkPendingReceipt: vi.fn(), deletePendingReceipt: vi.fn(),
}));

describe("parcours mobile des justificatifs", () => {
  it("permet la photo directe ou sa conservation avant synchronisation", async () => {
    const { container } = render(<MobileCaptureView onOpenDesktop={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Bistro")).toBeVisible());
    expect(screen.getByRole("button", { name: "📷 Photographier pour la transaction choisie" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "📥 Photographier maintenant, associer plus tard" })).toBeEnabled();
    expect(screen.getByLabelText("Prendre une photo du justificatif")).toHaveAttribute("capture", "environment");
    expect(screen.getByLabelText("Photographier pour associer plus tard")).toHaveAttribute("capture", "environment");
    expect(container.firstElementChild).toHaveClass("overflow-y-auto", "touch-pan-y", "h-[100dvh]");
  });
});
