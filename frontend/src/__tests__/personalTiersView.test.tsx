import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PersonalTiersView } from "../components/Personal/PersonalTiersView";
import type { PersonalFinanceSnapshot, PersonalTransaction } from "../types";

function transaction(overrides: Partial<PersonalTransaction>): PersonalTransaction {
  return {
    id: "transaction",
    key: "default:transaction",
    date: "2026-10-02",
    label: "Netflix",
    amount_ht: -14.99,
    vat: 0,
    amount_ttc: -14.99,
    currency: "EUR",
    category: "misc",
    account: "7",
    status: "validated",
    sourceWorkspaceId: "default",
    sourceAccountId: "7",
    accountName: "Compte courant",
    personalCategory: "subscriptions",
    internalTransfer: false,
    ...overrides,
  };
}

const snapshot: PersonalFinanceSnapshot = {
  person: { id: "person_1", name: "Alice" },
  month: "all",
  accounts: [{ id: "account_1", kind: "account", name: "Compte courant", currency: "EUR", sourceWorkspaceId: "default", sourceAccountId: "7", createdAt: "2026-01-01" }],
  transactions: [
    transaction({ id: "t1", key: "default:t1", label: "Netflix", amount_ht: -14.99, amount_ttc: -14.99 }),
    transaction({ id: "t2", key: "default:t2", label: "  NETFLIX  ", date: "2026-09-02", amount_ht: -10, amount_ttc: -10 }),
    transaction({ id: "t3", key: "default:t3", label: "Employeur", amount_ht: 2000, amount_ttc: 2000, personalCategory: "salary_income" }),
    transaction({ id: "t4", key: "default:t4", label: "Virement épargne", amount_ht: -300, amount_ttc: -300, personalCategory: "savings", internalTransfer: true }),
  ],
  budgets: [],
  categories: [{ id: "subscriptions", label: "Abonnements", kind: "expense" }, { id: "salary_income", label: "Salaires", kind: "income" }, { id: "savings", label: "Épargne", kind: "expense" }],
  summary: { balance: 0, income: 2000, expenses: 24.99, net: 1975.01, internalTransfers: 1 },
};

describe("PersonalTiersView", () => {
  it("regroupe les tiers sur tout l’historique et neutralise les virements internes", () => {
    render(<PersonalTiersView snapshot={snapshot} />);

    expect(screen.getByText("1", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getAllByText(/24,99/)).toHaveLength(2);
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.queryByText("Virement épargne")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Netflix"));
    expect(screen.getAllByText(/NETFLIX/i)).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("Type de mouvements des tiers"), { target: { value: "income" } });
    expect(screen.getByText("Employeur")).toBeInTheDocument();
    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
  });
});
