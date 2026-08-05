import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileEditor } from "../components/Editor/FileEditor";

const saveFileContent = vi.fn().mockResolvedValue(undefined);
const markDirty = vi.fn();

vi.mock("../api/client", () => ({
  fetchFileContent: vi.fn().mockResolvedValue("name: ComptaOS\n"),
  rawFileUrl: (path: string) => `/api/files/raw?path=${encodeURIComponent(path)}`,
  saveFileContent: (...args: unknown[]) => saveFileContent(...args),
}));
vi.mock("../stores/appStore", () => ({ useAppStore: () => ({ markDirty }) }));

describe("éditeur de fichiers local", () => {
  beforeEach(() => { saveFileContent.mockClear(); markDirty.mockClear(); });

  it("affiche, modifie et sauvegarde un fichier sans charger Monaco", async () => {
    render(<FileEditor tabId="settings" path="config/settings.yaml" />);
    const editor = await screen.findByLabelText("Contenu de config/settings.yaml");
    expect(editor).toHaveValue("name: ComptaOS\n");

    fireEvent.change(editor, { target: { value: "name: ComptaOS 2\n" } });
    expect(markDirty).toHaveBeenLastCalledWith("settings", true);
    fireEvent.click(screen.getByRole("button", { name: "Sauvegarder" }));

    await waitFor(() => expect(saveFileContent).toHaveBeenCalledWith("config/settings.yaml", "name: ComptaOS 2\n"));
  });

  it("affiche un PDF sans essayer de l'éditer comme du texte", () => {
    render(<FileEditor tabId="receipt" path="attachments/reçu.pdf" />);
    expect(screen.getByTitle("Aperçu de attachments/reçu.pdf")).toHaveAttribute("src", "/api/files/raw?path=attachments%2Fre%C3%A7u.pdf");
    expect(screen.queryByRole("button", { name: "Sauvegarder" })).not.toBeInTheDocument();
  });
});
