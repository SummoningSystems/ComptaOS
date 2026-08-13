import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { filterTransactions, PendingReceiptsPanel, suggestReceiptGroups, suggestReceiptMatches, suggestSplitPaymentMatches } from "../components/Transactions/PendingReceiptsPanel";

vi.mock("../api/client", () => ({
  attachmentUrl: (filename: string) => `/api/attachments/file/${filename}`,
  analyzePendingReceipt: vi.fn(),
  fetchPendingReceipts: vi.fn().mockResolvedValue([{
    id: "receipt_phone",
    filename: "receipt_phone.jpg",
    originalName: "photo-mobile.jpg",
    mimetype: "image/jpeg",
    createdAt: "2026-08-05T12:26:14.945Z",
    ocr: { status: "success", proposal: { supplier: "Fournisseur Test", invoiceRef: "FAC-42", amountHt: 16.54, amountVat: 3.31, amountTtc: 19.85, category: "misc", confidence: "high", vatSplits: [{ rate: 20, amountHt: 16.54, amountVat: 3.31, amountTtc: 19.85 }] } },
  }]),
  fetchPendingReceiptBatchOcr: vi.fn().mockResolvedValue({ running: false, done: 0, total: 0, succeeded: 0, failed: 0, currentName: "" }),
  startPendingReceiptBatchOcr: vi.fn(),
  linkPendingReceipt: vi.fn(),
  linkPendingReceiptGroup: vi.fn(),
  linkPendingReceiptToMany: vi.fn(),
  deletePendingReceipt: vi.fn(),
  uploadPendingReceipt: vi.fn(),
  rotatePendingReceipt: vi.fn(),
  transformPendingReceipt: vi.fn(),
  updatePendingReceiptOcr: vi.fn(),
}));

describe("justificatifs en attente sur ordinateur", () => {
  it("affiche la photo mobile et permet de choisir une transaction", async () => {
    render(<PendingReceiptsPanel transactions={[{ id: "meal", date: "2026-08-05", label: "Restaurant", amount_ht: -20, vat: 0, amount_ttc: -20, currency: "EUR", category: "restaurant", account: "main", status: "pending" }]} onLinked={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("Justificatifs en attente")).toBeVisible());
    expect(screen.getByAltText("Aperçu de photo-mobile.jpg")).toHaveAttribute("src", expect.stringContaining("/api/attachments/file/receipt_phone.jpg?v="));
    expect(screen.getByRole("button", { name: "Tourner photo-mobile.jpg à gauche" })).toBeVisible();
    expect(screen.getByText("Vérifier / corriger")).toBeVisible();
    fireEvent.focus(screen.getByLabelText("Rechercher une transaction pour photo-mobile.jpg"));
    expect(screen.getByRole("button", { name: "2026-08-05 · Restaurant · 20.00 €" })).toBeVisible();
    expect(screen.getByText("Aucune transaction du même montant.")).toBeVisible();
    expect(screen.getByText("Référence : FAC-42")).toBeVisible();
    expect(screen.getByText("TVA 20 % : HT 16.54 € · TVA 3.31 € · TTC 19.85 €")).toBeVisible();
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

  it("propose une facture sur le montant restant d'un paiement groupé", () => {
    const receipt = { id: "amazon_2", filename: "amazon-2.pdf", originalName: "amazon-2.pdf", mimetype: "application/pdf", createdAt: "2026-08-05T12:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Amazon", amountHt: 25, amountTtc: 30, category: "equipment" as const, vatSplits: [{ rate: 20, amountTtc: 30 }], confidence: "high" as const } } };
    const payment = { id: "payment", date: "2026-08-05", label: "AMAZON", amount_ht: -75, vat: 0, amount_ttc: -90, currency: "EUR", category: "equipment" as const, account: "main", status: "pending" as const, attachment: "amazon-1.pdf", attachments: ["amazon-1.pdf"], attachment_details: [{ filename: "amazon-1.pdf", amount_ttc: 60 }] };
    expect(suggestReceiptMatches([receipt], [payment]).amazon_2).toMatchObject({ transactionId: "payment" });
  });

  it("propose deux factures dont la somme correspond à une transaction", () => {
    const receipt = (id: string, amountTtc: number) => ({ id, filename: `${id}.pdf`, originalName: `${id}.pdf`, mimetype: "application/pdf", createdAt: "2026-08-05T12:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Amazon", date: "2026-08-04", amountHt: amountTtc, amountTtc, category: "equipment" as const, vatSplits: [], confidence: "high" as const } } });
    const payment = { id: "payment", date: "2026-08-05", label: "AMAZON", amount_ht: -90, vat: 0, amount_ttc: -90, currency: "EUR", category: "equipment" as const, account: "main", status: "pending" as const };
    expect(suggestReceiptGroups([receipt("first", 60), receipt("second", 30)], [payment])[0]).toMatchObject({ receiptIds: ["first", "second"], transactionId: "payment", total: 90 });
  });

  it("propose une facture réglée par deux transactions", () => {
    const receipt = { id: "invoice", filename: "invoice.pdf", originalName: "invoice.pdf", mimetype: "application/pdf", createdAt: "2026-08-05T12:00:00Z", ocr: { status: "success" as const, proposal: { supplier: "Unity", date: "2026-08-04", amountHt: 75, amountTtc: 90, category: "software" as const, vatSplits: [{ rate: 20, amountTtc: 90 }], confidence: "high" as const } } };
    const payment = (id: string, amount: number) => ({ id, date: "2026-08-05", label: "UNITY", amount_ht: -amount, vat: 0, amount_ttc: -amount, currency: "EUR", category: "software" as const, account: "main", status: "pending" as const });
    expect(suggestSplitPaymentMatches([receipt], [payment("first", 60), payment("second", 30)]).invoice).toMatchObject({ transactionIds: ["first", "second"], total: 90 });
  });

  it("recherche une transaction par libellé, montant ou date", () => {
    const transactions = [
      { id: "ikea", date: "2026-03-07", label: "IKEA", amount_ht: -36.99, vat: 0, amount_ttc: -36.99, currency: "EUR", category: "equipment" as const, account: "main", status: "pending" as const },
      { id: "bread", date: "2026-08-05", label: "MARIE BLACHERE", amount_ht: -5.15, vat: 0, amount_ttc: -5.15, currency: "EUR", category: "food" as const, account: "main", status: "pending" as const },
    ];
    expect(filterTransactions(transactions, "ikea").map((item) => item.id)).toEqual(["ikea"]);
    expect(filterTransactions(transactions, "36,99").map((item) => item.id)).toEqual(["ikea"]);
    expect(filterTransactions(transactions, "2026-08-05").map((item) => item.id)).toEqual(["bread"]);
  });

  it("conserve dans la recherche une transaction qui possède déjà une facture", () => {
    const transaction = { id: "amazon", date: "2026-08-05", label: "AMAZON", amount_ht: -50, vat: 0, amount_ttc: -50, currency: "EUR", category: "equipment" as const, account: "main", status: "pending" as const, attachment: "facture-1.pdf", attachments: ["facture-1.pdf"] };
    expect(filterTransactions([transaction], "amazon")).toEqual([transaction]);
  });
});
