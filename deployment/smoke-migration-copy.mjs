import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const workspace = path.resolve(process.env.MIGRATION_WORKSPACE_PATH ?? "");
const baseUrl = (process.env.MIGRATION_BASE_URL ?? "http://127.0.0.1:3015").replace(/\/$/, "");
assert(workspace && fs.existsSync(workspace), "MIGRATION_WORKSPACE_PATH doit pointer vers la copie restaurée.");

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const jwt = requireFromBackend("jsonwebtoken");
const auth = JSON.parse(fs.readFileSync(path.join(workspace, "auth.json"), "utf8"));
const owner = auth.users.find((user) => user.role === "owner" && user.active);
assert(owner, "Aucun propriétaire actif dans la copie.");
const secret = fs.readFileSync(path.join(workspace, ".jwt_secret"), "utf8").trim();
assert(secret.length >= 32, "Secret JWT de la copie invalide.");
const ownerToken = jwt.sign({ sub: owner.id, username: owner.username, role: owner.role }, secret, { expiresIn: "15m" });
const ownerCookie = `comptaos_token=${encodeURIComponent(ownerToken)}`;

async function request(route, { method = "GET", body, cookie = ownerCookie } = {}) {
  const response = await fetch(baseUrl + route, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("json") ? await response.json() : Buffer.from(await response.arrayBuffer());
  return { status: response.status, body: payload, setCookie: response.headers.get("set-cookie") ?? "", contentType };
}

assert.equal((await request("/api/health", { cookie: "" })).status, 200);
assert.equal((await request("/api/auth/me")).body.id, owner.id);
const originalWorkspaces = (await request("/api/workspaces")).body;
const legacy = originalWorkspaces.find((item) => item.path === ".") ?? originalWorkspaces[0];
assert(legacy, "Espace historique introuvable.");

const legacyTransactions = (await request(`/api/workspaces/${legacy.id}/transactions`)).body;
const evidenceTransaction = legacyTransactions.find((transaction) => transaction.reconciled === true && typeof transaction.notes === "string" && (transaction.attachment || transaction.attachments?.length));
assert(evidenceTransaction, "Aucune transaction rapprochée avec justificatif n'a été trouvée.");
const evidenceNames = [...new Set([...(evidenceTransaction.attachments ?? []), ...(evidenceTransaction.attachment ? [evidenceTransaction.attachment] : [])])];
for (const filename of evidenceNames) assert(fs.existsSync(path.join(workspace, "attachments", path.basename(filename))), `Justificatif absent : ${path.basename(filename)}`);
const preserved = { status: evidenceTransaction.status, reconciled: evidenceTransaction.reconciled, attachment: evidenceTransaction.attachment, attachments: evidenceTransaction.attachments, justified: evidenceTransaction.justified };
const marker = `migration-smoke-${Date.now()}`;
let changed = await request(`/api/workspaces/${legacy.id}/transactions/${evidenceTransaction.id}`, { method: "PATCH", body: { notes: `${evidenceTransaction.notes}\n${marker}` } });
assert.equal(changed.status, 200);
for (const [key, value] of Object.entries(preserved)) assert.deepEqual(changed.body[key], value, `${key} a changé pendant la modification.`);
const restored = await request(`/api/workspaces/${legacy.id}/transactions/${evidenceTransaction.id}`, { method: "PATCH", body: { notes: evidenceTransaction.notes } });
assert.equal(restored.status, 200);
for (const [key, value] of Object.entries(preserved)) assert.deepEqual(restored.body[key], value, `${key} n'a pas été restauré.`);

const suffix = Date.now().toString(36);
const workspaceResponse = await request("/api/workspaces", { method: "POST", body: { name: `Migration ${suffix}`, kind: "business" } });
assert.equal(workspaceResponse.status, 201);
const testWorkspace = workspaceResponse.body;
const transaction = {
  id: `migration_${suffix}`,
  date: "2026-09-25",
  label: "Écriture de validation migration",
  amount_ht: -100,
  vat: -20,
  amount_ttc: -120,
  currency: "EUR",
  category: "office_supplies",
  account: "512",
  status: "validated",
  reconciled: true,
  justified: true,
  invoiceRef: `MIG-${suffix}`,
  notes: "Donnée jetable de préproduction",
};
assert.equal((await request(`/api/workspaces/${testWorkspace.id}/transactions`, { method: "POST", body: transaction })).status, 201);
const transactionPatch = await request(`/api/workspaces/${testWorkspace.id}/transactions/${transaction.id}`, { method: "PATCH", body: { notes: "Modification contrôlée" } });
assert.equal(transactionPatch.status, 200);
assert.equal(transactionPatch.body.reconciled, true);
const preview = await request(`/api/workspaces/${testWorkspace.id}/accounting/preview?year=2026`);
assert.equal(preview.status, 200);
assert.equal(preview.body.eligibleCount, 1);
assert.equal(preview.body.balanced, true);
const exportXlsx = await request(`/api/workspaces/${testWorkspace.id}/export/xlsx?year=2026`);
assert.equal(exportXlsx.status, 200);
assert(exportXlsx.contentType.includes("spreadsheetml"));
assert(exportXlsx.body.length > 1000, "Export XLSX vide.");
const annualThirdParty = await request(`/api/workspaces/${testWorkspace.id}/annual-accounting/third-parties`, {
  method: "POST",
  body: { kind: "supplier", name: "Fournisseur migration", accountNumber: "401100" },
});
assert.equal(annualThirdParty.status, 201);
const annualAdjustment = await request(`/api/workspaces/${testWorkspace.id}/annual-accounting/adjustments`, {
  method: "POST",
  body: { year: "2026", date: "2026-12-31", type: "other", label: "OD migration", debitAccount: "606300", debitLabel: "Fournitures", creditAccount: "401100", creditLabel: "Fournisseur", amount: 12, status: "draft" },
});
assert.equal(annualAdjustment.status, 201);
const annualState = await request(`/api/workspaces/${testWorkspace.id}/annual-accounting?year=2026`);
assert.equal(annualState.status, 200);
assert.equal(annualState.body.workspace.thirdParties.length, 1);
assert.equal(annualState.body.workspace.adjustments.length, 1);

const ecosystemResponse = await request("/api/ecosystems", { method: "POST", body: { name: `Écosystème migration ${suffix}` } });
assert.equal(ecosystemResponse.status, 201);
let ecosystem = ecosystemResponse.body;
for (const entity of [
  { id: `person_${suffix}`, kind: "person", name: "Personne de test" },
  { id: `company_${suffix}`, kind: "company", name: "Entreprise de test", accountingEnabled: true, vatEnabled: true },
  { id: `account_${suffix}`, kind: "account", name: "Compte de test" },
]) {
  const command = await request(`/api/ecosystems/${ecosystem.id}/commands`, { method: "POST", body: { revision: ecosystem.revision, action: "entity", entity } });
  assert.equal(command.status, 200);
  ecosystem = command.body;
}
assert.deepEqual(ecosystem.entities.map((entity) => entity.kind).sort(), ["account", "company", "person"]);

const invitation = await request("/api/auth/invite", { method: "POST", body: { role: "readonly", workspaceId: testWorkspace.id } });
assert.equal(invitation.status, 201);
const credentials = { username: `migration-${suffix}`, displayName: "Lecture migration", password: `Migration-${suffix}-Test!` };
assert.equal((await request(`/api/auth/invite/${invitation.body.token}/accept`, { method: "POST", body: credentials, cookie: "" })).status, 201);
const login = await request("/api/auth/login", { method: "POST", body: { username: credentials.username, password: credentials.password }, cookie: "" });
assert.equal(login.status, 200);
assert(login.setCookie.includes("HttpOnly"), "Cookie de connexion incomplet.");
const readonlyCookie = login.setCookie.split(";")[0];
const visible = await request("/api/workspaces", { cookie: readonlyCookie });
assert.equal(visible.status, 200);
assert(visible.body.some((item) => item.id === testWorkspace.id), "L'espace invité n'est pas visible.");
assert.equal((await request(`/api/workspaces/${testWorkspace.id}/transactions/${transaction.id}`, { method: "PATCH", body: { notes: "Interdit" }, cookie: readonlyCookie })).status, 403);
const privateWorkspace = await request(`/api/workspaces/${ecosystem.entities.find((entity) => entity.kind === "company").workspaceId}/transactions`, { cookie: readonlyCookie });
assert.equal(privateWorkspace.status, 403);
const privateAnnualWorkspace = await request(`/api/workspaces/${ecosystem.entities.find((entity) => entity.kind === "company").workspaceId}/annual-accounting?year=2026`, { cookie: readonlyCookie });
assert.equal(privateAnnualWorkspace.status, 403);

console.log(JSON.stringify({
  ok: true,
  legacyWorkspace: legacy.id,
  legacyTransactions: legacyTransactions.length,
  preservedTransaction: evidenceTransaction.id,
  preservedEvidence: evidenceNames.length,
  createdWorkspace: testWorkspace.id,
  createdEcosystem: ecosystem.id,
  accountingExportBytes: exportXlsx.body.length,
  annualAccountingScoped: true,
  readonlyVisibilityChecked: true,
}, null, 2));
