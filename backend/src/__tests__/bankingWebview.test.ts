import { describe, expect, it } from "vitest";
import { buildConnectWebviewUrl } from "../services/bankingService.js";

describe("Powens Webview URL", () => {
  it("utilise la route localisée, le domaine complet et conserve exactement le retour autorisé", () => {
    const redirect = "https://tipforgood.com/comptaos-preprod/";
    const url = new URL(buildConnectWebviewUrl("summoning", "client id", redirect, "temporary code"));
    expect(url.origin).toBe("https://webview.powens.com");
    expect(url.pathname).toBe("/fr/connect");
    expect(url.searchParams.get("domain")).toBe("summoning.biapi.pro");
    expect(url.searchParams.get("client_id")).toBe("client id");
    expect(url.searchParams.get("redirect_uri")).toBe(redirect);
    expect(url.searchParams.get("code")).toBe("temporary code");
  });

  it("utilise le gestionnaire Powens sans URL de retour sur un environnement non autorisé", () => {
    const url = new URL(buildConnectWebviewUrl("summoning", "123", undefined, "temporary"));
    expect(url.pathname).toBe("/fr/manage");
    expect(url.searchParams.get("redirect_uri")).toBeNull();
    expect(url.searchParams.get("domain")).toBe("summoning.biapi.pro");
    expect(url.searchParams.get("code")).toBe("temporary");
  });
});
