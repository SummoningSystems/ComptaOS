import { describe, expect, it } from "vitest";
import { isAuthEnabled } from "../routes/auth.js";
import { authCookieName, authCookiePath, shouldUseSecureCookies } from "../services/authCookie.js";

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

describe("isolation des cookies d'instance", () => {
  it("permet un nom et un chemin dédiés à la préproduction", () => {
    const env = { AUTH_COOKIE_NAME: "comptaos_preprod_token", AUTH_COOKIE_PATH: "/comptaos-preprod" } as NodeJS.ProcessEnv;
    expect(authCookieName(env)).toBe("comptaos_preprod_token");
    expect(authCookiePath(env)).toBe("/comptaos-preprod");
  });

  it("refuse les valeurs pouvant injecter des attributs de cookie", () => {
    expect(authCookieName({ AUTH_COOKIE_NAME: "bad; Secure" })).toBe("comptaos_token");
    expect(authCookiePath({ AUTH_COOKIE_PATH: "/bad; Secure" })).toBe("/");
  });
});

describe("auth status configuration", () => {
  it("active l'authentification uniquement sur demande explicite", () => {
    expect(isAuthEnabled({ AUTH_ENABLED: "true" })).toBe(true);
    expect(isAuthEnabled({ AUTH_ENABLED: "false" })).toBe(false);
    expect(isAuthEnabled({})).toBe(false);
  });
});
