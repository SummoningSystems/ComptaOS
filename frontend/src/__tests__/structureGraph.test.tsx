import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StructureGraph } from "../components/Platform/StructureView";
import type { PlatformAccount, PlatformEntity, PlatformPerson, PlatformState } from "../types";

const person: PlatformPerson = { id: "person_1", kind: "person", name: "Alice", profile: "individual", createdAt: "2026-01-01T00:00:00.000Z" };
const entity: PlatformEntity = { id: "entity_1", kind: "entity", name: "Société Alice", workspaceId: "default", createdAt: "2026-01-01T00:00:00.000Z" };
const account: PlatformAccount = { id: "account_1", kind: "account", name: "Compte professionnel", currency: "EUR", sourceWorkspaceId: "default", sourceAccountId: "1", createdAt: "2026-01-01T00:00:00.000Z" };
const state: PlatformState = {
  schemaVersion: 1,
  revision: 2,
  people: [person],
  entities: [entity],
  accounts: [account],
  grants: [],
  relations: [
    { id: "relation_owner", fromId: person.id, toId: entity.id, type: "owner", source: "manual", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "relation_account", fromId: entity.id, toId: account.id, type: "uses", source: "workspace", createdAt: "2026-01-01T00:00:00.000Z" },
  ],
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("StructureGraph", () => {
  it("rend les liens et permet de sélectionner un élément", () => {
    const onSelect = vi.fn();
    render(<StructureGraph nodes={[person, entity, account]} state={state} selectedId={null} onSelect={onSelect} />);

    expect(screen.getByLabelText("Carte des liens entre les personnes, entreprises et comptes").querySelectorAll("path")).toHaveLength(7);
    expect(screen.getByText("Associé / propriétaire")).toBeInTheDocument();
    expect(screen.getByText("Utilise")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Alice"));
    expect(onSelect).toHaveBeenCalledWith("person_1");
  });
});
