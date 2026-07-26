import { describe, expect, it } from "vitest";
import { isAuthEnabled, shouldUseSecureCookies } from "../routes/auth.js";

describe("secure auth cookies", () => {
  it("active Secure automatiquement en production", () => {
    expect(shouldUseSecureCookies({ NODE_ENV: "production" })).toBe(true);
  });

  it("permet de forcer Secure hors production", () => {
    expect(shouldUseSecureCookies({ NODE_ENV: "development", HTTPS_ONLY: "true" })).toBe(true);
  });

  it("conserve les cookies HTTP pour le développement local", () => {
    expect(shouldUseSecureCookies({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("auth status configuration", () => {
  it("active l'authentification uniquement sur demande explicite", () => {
    expect(isAuthEnabled({ AUTH_ENABLED: "true" })).toBe(true);
    expect(isAuthEnabled({ AUTH_ENABLED: "false" })).toBe(false);
    expect(isAuthEnabled({})).toBe(false);
  });
});
