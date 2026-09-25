import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"./e2e",testMatch:"ecosystem.spec.ts",outputDir:".artifacts/ecosystem",
  workers:1,retries:0,timeout:30000,reporter:[["list"]],
  use:{baseURL:"http://localhost:5175",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"chromium",use:{...devices["Desktop Chrome"],viewport:{width:1512,height:982}}}],
  webServer:{command:"node node_modules/vite/bin/vite.js --port 5175 --strictPort",cwd:"./frontend",url:"http://localhost:5175",reuseExistingServer:false,timeout:30000},
});

