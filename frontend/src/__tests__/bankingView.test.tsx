import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BankingView } from "../components/Banking/BankingView";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
vi.mock("../api/client", () => ({ api }));

describe("BankingView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url: string) => Promise.resolve({ data: url === "/banking/config" ? { configured: true, mode: "hosted" } : [] }));
    api.post.mockImplementation((url: string) => Promise.resolve({ data: url === "/banking/connect" ? { url: "https://webview.powens.test/connect" } : [] }));
  });

  it("ouvre Powens avec un retour dédié puis rafraîchit automatiquement le dossier", async () => {
    const popup = { location: { href: "" }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, "open").mockReturnValue(popup);
    render(<BankingView dossierName="Benoit Jurado" />);

    fireEvent.click(await screen.findByRole("button", { name: "+ Connecter une banque" }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/banking/connect", expect.objectContaining({ redirectUrl: expect.stringContaining("powens_callback=1") })));
    expect(popup.location.href).toBe("https://webview.powens.test/connect");

    window.dispatchEvent(new MessageEvent("message", { origin: window.location.origin, data: { type: "comptaos:powens-callback" } }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith("/banking/refresh"));
    expect(await screen.findByText(/Saisie manuelle.*n’est pas une connexion bancaire/)).toBeInTheDocument();
  });
});
