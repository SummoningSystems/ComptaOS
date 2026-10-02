export function authCookieName(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.AUTH_COOKIE_NAME?.trim();
  return value && /^[A-Za-z0-9_-]+$/.test(value) ? value : "comptaos_token";
}

export function authCookiePath(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.AUTH_COOKIE_PATH?.trim();
  return value && /^\/[A-Za-z0-9/_-]*$/.test(value) ? value : "/";
}

export function shouldUseSecureCookies(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HTTPS_ONLY === "true" || env.NODE_ENV === "production";
}
