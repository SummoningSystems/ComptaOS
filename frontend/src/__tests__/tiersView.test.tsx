import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fetchTransactions } from "../api/client";
import { TiersView } from "../components/Tiers/TiersView";
import type { Transaction } from "../types";

vi.mock("../api/client", () => ({ fetchTransactions: vi.fn() }));
vi.mock("../hooks/useCategoryCatalog", () => ({ useCategoryCatalog: () => ({ categories: [] }) }));

function payment(id: string, label: string, amount: number, notes = `Importé via PSD2 (Powens) — ${label}`): Transaction {
  return {
    id, label, notes, date: "2026-10-29", amount_ht: amount, amount_ttc: amount,
    vat: 0, currency: "EUR", category: "service_revenue", account: "main", status: "validated",
  };
}

describe("TiersView", () => {
  it("regroupe les virements KAIZEN et conserve le détail de chaque facture", async () => {
    const labels = [
      "KAIZEN SOLUTIONS - F-2026-07-4 - SOCIETE EXEMPLE - abc123",
      "KAIZEN SOLUTIONS - F-2026-07-3 - SOCIETE EXEMPLE - def456",
      "kaizen  solutions – F-2026-09-5 – SOCIETE EXEMPLE – fed789",
    ];
    vi.mocked(fetchTransactions).mockResolvedValue([
      payment("a", labels[0], 9600),
      payment("b", labels[1], 7440),
      payment("c", labels[2], 4800),
      payment("d", "KAIZEN CONSEIL - F-2026-10-1", 300),
      payment("e", "ARTOU - F2025 011", 4200, "KOROKORO"),
      payment("f", "ARTOU - F 2025 012", 1060.80, " Korokoro "),
    ]);

    render(<TiersView />);

    const kaizen = await screen.findByRole("button", { name: "KAIZEN SOLUTIONS" });
    const row = within(kaizen.closest("tr")!);
    expect(row.getByText("3")).toBeInTheDocument();
    expect(row.getAllByText("+21840.00 €")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "KAIZEN CONSEIL" })).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "KOROKORO" }).closest("tr")!).getByText("2")).toBeInTheDocument();

    fireEvent.click(kaizen);
    for (const label of labels) expect(screen.getByText(label, { normalizer: (text) => text })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "F-2026-09-5" } });
    expect(kaizen).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "KAIZEN CONSEIL" })).not.toBeInTheDocument();
  });

  it("utilise le libellé complet lorsque le virement ne contient pas de référence identifiable", async () => {
    vi.mocked(fetchTransactions).mockResolvedValue([
      payment("a", "STUDIO 24 - Lyon", 100),
      payment("b", "STUDIO 24 - Paris", 200, ""),
    ]);

    render(<TiersView />);

    expect(await screen.findByRole("button", { name: "STUDIO 24 - Lyon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "STUDIO 24 - Paris" })).toBeInTheDocument();
  });
});
