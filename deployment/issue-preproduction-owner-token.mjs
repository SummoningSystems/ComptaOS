import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";

assert.equal(process.env.PREPRODUCTION_TOKEN_ISSUER, "true", "Usage réservé à la recette de préproduction.");
const workspace = path.resolve(process.env.WORKSPACE_PATH ?? "/workspace");
const auth = JSON.parse(fs.readFileSync(path.join(workspace, "auth.json"), "utf8"));
const owner = auth.users.find((user) => user.role === "owner" && user.active);
assert(owner, "Propriétaire actif introuvable.");
const secret = fs.readFileSync(path.join(workspace, ".jwt_secret"), "utf8").trim();
process.stdout.write(jwt.sign({ sub: owner.id, username: owner.username, role: owner.role }, secret, { expiresIn: "15m" }));
