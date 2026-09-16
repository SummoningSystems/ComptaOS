import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transactions: [] as Array<Record<string, unknown>>,
  writes: [] as Array<{ path: string; content: string }>,
}));

vi.mock("../services/transactionService.js", () => ({
  loadAllTransactions: async () => state.transactions,
}));

vi.mock("../services/fileSystem.js", () => ({
  writeFile: async (path: string, content: string) => {
    state.writes.push({ path, content });
  },
}));

import { generateReport } from "../services/reportService.js";

describe("report service", () => {
  beforeEach(() => {
    state.writes = [];
    state.transactions = [
      {
        id: "bank_powens_1", date: "2026-03-27", label: "ENGIE", amount_ht: -83.33,
        vat: -16.67, amount_ttc: -100, currency: "EUR", category: "utilities",
        account: "1", status: "validated",
      },
      {
        id: "bank_powens_duplicate", date: "2026-03-27", label: "ENGIE", amount_ht: -83.33,
        vat: -16.67, amount_ttc: -100, currency: "EUR", category: "misc",
        account: "1", status: "rejected",
      },
    ];
  });

  it("exclut les doublons rejetés du rapport mensuel", async () => {
    const report = await generateReport({ type: "monthly", period: "2026-03" });

    expect(report.content).toContain("100.00");
    expect(report.content).not.toContain("200.00");
    expect(report.content.match(/\| 2026-03-27 \| ENGIE \|/g)).toHaveLength(1);
    expect(state.writes).toEqual([{ path: "reports/mensuel_2026-03.md", content: report.content }]);
  });
});
