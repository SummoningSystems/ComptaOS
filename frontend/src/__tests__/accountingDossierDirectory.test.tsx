import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountingDossierDirectory } from "../components/Platform/StructureView";
import type { AccountingDossier } from "../types";

const dossiers: AccountingDossier[] = [
  { scopeId: "person_laura", name: "Laura Thomas", scopeKind: "person", mode: "personal", created: false, features: [] },
  { scopeId: "entity_company", name: "Mon entreprise", scopeKind: "entity", mode: "full", workspaceId: "default", created: true, features: [] },
];

describe("AccountingDossierDirectory", () => {
  it("rend les actions comptables sans devoir sélectionner un nœud du graphe", () => {
    const onOpen = vi.fn();
    const onConnectBank = vi.fn();
    const onShowDetails = vi.fn();
    render(<AccountingDossierDirectory dossiers={dossiers} onOpen={onOpen} onConnectBank={onConnectBank} onShowDetails={onShowDetails} />);

    expect(screen.getByText("Dossiers comptables")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Créer la comptabilité" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ouvrir la comptabilité" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Voir la fiche et les liens" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Connecter une banque" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Créer la comptabilité" }));
    expect(onOpen).toHaveBeenCalledWith(dossiers[0]);
  });
});
