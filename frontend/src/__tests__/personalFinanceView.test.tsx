import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersonalFinanceView } from "../components/Personal/PersonalFinanceView";

const api = vi.hoisted(() => ({ fetch: vi.fn(), category: vi.fn(), budgets: vi.fn() }));
vi.mock("../api/client", () => ({
  fetchPersonalFinance: api.fetch,
  savePersonalCategory: api.category,
  savePersonalFinanceBudgets: api.budgets,
}));

describe("PersonalFinanceView", () => {
  beforeEach(() => {
    api.fetch.mockResolvedValue({ person: { id: "person_1", name: "Alice" }, month: "2026-10", accounts: [{ id: "account_1", kind: "account", name: "Compte courant", currency: "EUR", balance: 1200, sourceWorkspaceId: "default", sourceAccountId: "7", createdAt: "2026-01-01" }], transactions: [{ id: "t1", key: "default:t1", date: "2026-10-02", label: "Courses", amount_ht: -40, vat: 0, amount_ttc: -40, currency: "EUR", category: "misc", account: "7", status: "validated", sourceWorkspaceId: "default", sourceAccountId: "7", accountName: "Compte courant", personalCategory: "groceries", internalTransfer: false }], budgets: [{ category: "groceries", monthlyLimit: 300 }], categories: [{ id: "personal_income", label: "Revenus professionnels", kind: "income" }, { id: "groceries", label: "Courses alimentaires", kind: "expense" }, { id: "personal_misc", label: "Divers personnel", kind: "both" }], summary: { balance: 1200, income: 0, expenses: 40, net: -40, internalTransfers: 0 } });
    api.category.mockResolvedValue(undefined); api.budgets.mockResolvedValue([{ category: "groceries", monthlyLimit: 300 }]);
  });

  it("affiche le tableau de bord et les mouvements personnels", async () => {
    render(<PersonalFinanceView personId="person_1" />);
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getAllByText(/1.*200,00/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Mouvements (1)" }));
    expect(screen.getByText("Courses")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Courses alimentaires"), { target: { value: "personal_misc" } });
    await waitFor(() => expect(api.category).toHaveBeenCalledWith("person_1", "default:t1", "personal_misc"));
  });
});
