import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
const workspace=mkdtempSync(path.join(tmpdir(),"comptaos-business-e2e-"));
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: ["household.spec.ts", "ecosystem.spec.ts", "ecosystem-live.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://localhost:5177",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node backend/node_modules/tsx/dist/cli.mjs backend/src/index.ts",
      env: {WORKSPACE_PATH:workspace,AUTH_ENABLED:"false",NODE_ENV:"test",PORT:"3005",HOST:"127.0.0.1",LOCAL_API_KEY:"",BACKUP_PATH:""},
      url: "http://127.0.0.1:3005/api/health",
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "node node_modules/vite/bin/vite.js --port 5177 --strictPort",
      env: {API_TARGET:"http://127.0.0.1:3005"},
      cwd: "frontend",
      url: "http://localhost:5177",
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
