import { describe, expect, it } from "vitest";
import { workspaceContext } from "../services/workspaceContext.js";

describe("contexte comptable par requête", () => {
  it("isole deux utilisateurs exécutés simultanément", async () => {
    const first = workspaceContext.run({ companyId: "a", root: "/workspace/a", actor: { id: "alice", role: "member" }, accessRole: "manager" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return workspaceContext.getStore();
    });
    const second = workspaceContext.run({ companyId: "b", root: "/workspace/b", actor: { id: "bob", role: "readonly" }, accessRole: "viewer" }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return workspaceContext.getStore();
    });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ companyId: "a", actor: { id: "alice" } });
    expect(b).toMatchObject({ companyId: "b", actor: { id: "bob" } });
  });
});
