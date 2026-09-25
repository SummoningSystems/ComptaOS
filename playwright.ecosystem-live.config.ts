import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const workspace=mkdtempSync(path.join(tmpdir(),"comptaos-ecosystem-live-e2e-"));
export default defineConfig({
  testDir:"./e2e",outputDir:".artifacts/ecosystem-live",testMatch:"ecosystem-live.spec.ts",workers:1,retries:0,timeout:120000,
  reporter:process.env.CI?[["github"],["list"]]:[["list"]],
  use:{baseURL:"http://localhost:5176",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"]}}],
  webServer:[
    {command:"node backend/node_modules/tsx/dist/cli.mjs backend/src/index.ts",url:"http://127.0.0.1:3004/api/health",reuseExistingServer:false,timeout:120000,env:{WORKSPACE_PATH:workspace,AUTH_ENABLED:"true",HTTPS_ONLY:"false",NODE_ENV:"test",PORT:"3004",HOST:"127.0.0.1",BACKUP_PATH:"",LOCAL_API_KEY:""}},
    {cwd:"frontend",command:"node node_modules/vite/bin/vite.js --port 5176 --strictPort",url:"http://localhost:5176",reuseExistingServer:false,timeout:120000,env:{BASE_PATH:"/",API_TARGET:"http://127.0.0.1:3004"}}
  ]
});
