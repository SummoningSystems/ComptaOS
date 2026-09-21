import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const workspace=mkdtempSync(path.join(tmpdir(),"comptaos-household-e2e-"));
export default defineConfig({
  testDir:"./e2e",outputDir:".artifacts/household",testMatch:"household.spec.ts",workers:1,retries:0,timeout:60000,
  reporter:[["list"]],
  use:{baseURL:"http://localhost:5174",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}],
  webServer:[
    {command:"node backend/node_modules/tsx/dist/cli.mjs backend/src/index.ts",url:"http://127.0.0.1:3002/api/health",reuseExistingServer:false,timeout:60000,env:{WORKSPACE_PATH:workspace,AUTH_ENABLED:"true",HTTPS_ONLY:"false",NODE_ENV:"test",PORT:"3002",HOST:"127.0.0.1",BACKUP_PATH:"",LOCAL_API_KEY:""}},
    {command:"node frontend/node_modules/vite/bin/vite.js frontend --port 5174 --strictPort",url:"http://localhost:5174",reuseExistingServer:false,timeout:60000,env:{API_TARGET:"http://127.0.0.1:3002"}}
  ]
});
