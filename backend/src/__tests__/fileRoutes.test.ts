import fs from "fs/promises";
import os from "os";
import path from "path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "" }));
vi.mock("../services/companiesService.js", () => ({
  getActiveCompanyPath: () => workspace.root,
}));

import { filesRoutes } from "../routes/files.js";

describe("file API path rejection", () => {
  beforeEach(async () => {
    workspace.root = await fs.mkdtemp(path.join(os.tmpdir(), "comptaos-file-api-"));
  });

  afterEach(async () => {
    await fs.rm(workspace.root, { recursive: true, force: true });
  });

  it("returns HTTP 403 for an escaping path", async () => {
    const app = Fastify();
    await app.register(filesRoutes, { prefix: "/api/files" });
    const response = await app.inject({
      method: "GET",
      url: "/api/files/content?path=..%2Foutside.txt",
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
