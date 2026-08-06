import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "../stores/appStore";

describe("gestion des onglets", () => {
  beforeEach(() => useAppStore.setState({ tabs: [{ id: "dashboard", title: "Dashboard", type: "dashboard" }], activeTabId: "dashboard" }));

  it("réutilise un seul onglet pour les sections de navigation", () => {
    useAppStore.getState().openTab({ id: "transactions", title: "Transactions", type: "transactions" });
    useAppStore.getState().openTab({ id: "vat", title: "TVA", type: "vat" });
    expect(useAppStore.getState().tabs).toEqual([{ id: "vat", title: "TVA", type: "vat" }]);
  });

  it("conserve les fichiers ouverts pendant la navigation", () => {
    useAppStore.getState().openTab({ id: "file:note.pdf", title: "note.pdf", type: "editor", path: "attachments/note.pdf" });
    useAppStore.getState().openTab({ id: "transactions", title: "Transactions", type: "transactions" });
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(["transactions", "file:note.pdf"]);
  });

  it("ferme plusieurs onglets en conservant un onglet actif valide", () => {
    useAppStore.getState().openTab({ id: "file:a", title: "a", type: "editor", path: "a" });
    useAppStore.getState().openTab({ id: "file:b", title: "b", type: "editor", path: "b" });
    useAppStore.getState().closeTabs(["file:b", "dashboard"]);
    expect(useAppStore.getState().tabs.map((tab) => tab.id)).toEqual(["file:a"]);
    expect(useAppStore.getState().activeTabId).toBe("file:a");
  });
});
