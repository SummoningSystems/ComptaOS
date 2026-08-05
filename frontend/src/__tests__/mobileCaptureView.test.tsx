import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileCaptureView } from "../components/Mobile/MobileCaptureView";

vi.mock("../api/client", () => ({
  fetchTransactions: vi.fn().mockResolvedValue([
    { id: "meal", date: "2026-08-04", label: "Bistro", amount_ht: -30, vat: 0, amount_ttc: -30, currency: "EUR", category: "restaurant", account: "main", status: "pending" },
  ]),
  updateTransaction: vi.fn(),
  uploadAttachment: vi.fn(),
}));

describe("parcours mobile des justificatifs", () => {
  it("propose une dépense et ouvre directement l'appareil photo arrière", async () => {
    render(<MobileCaptureView onOpenDesktop={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Bistro")).toBeVisible());
    expect(screen.getByRole("button", { name: "📷 Prendre la photo" })).toBeEnabled();
    const input = screen.getByLabelText("Prendre une photo du justificatif");
    expect(input).toHaveAttribute("accept", "image/*");
    expect(input).toHaveAttribute("capture", "environment");
  });
});
