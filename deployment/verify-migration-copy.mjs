import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const [referenceArg, candidateArg] = process.argv.slice(2);
assert(referenceArg && candidateArg, "Usage: node verify-migration-copy.mjs <reference> <candidate>");
const reference = path.resolve(referenceArg);
const candidate = path.resolve(candidateArg);
assert(fs.existsSync(reference), `Restauration de référence introuvable : ${reference}`);
assert(fs.existsSync(candidate), `Copie candidate introuvable : ${candidate}`);

const requireFromBackend = createRequire(new URL("../backend/package.json", import.meta.url));
const yaml = requireFromBackend("yaml");

function filesUnder(root, segment, extension = undefined) {
  const found = [];
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (!extension || entry.name.endsWith(extension)) found.push(absolute);
    }
  }
  const start = path.join(root, segment);
  if (fs.existsSync(start)) visit(start);
  return found;
}

function referenceTransactionFiles(root) {
  return filesUnder(root, "transactions", ".yaml").concat(
    ...fs.readdirSync(path.join(root, "companies"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => filesUnder(root, path.join("companies", entry.name, "transactions"), ".yaml")),
  );
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function transactionMetrics(files) {
  const values = files.map((file) => yaml.parse(fs.readFileSync(file, "utf8")));
  return {
    transactions: values.length,
    reconciled: values.filter((value) => value.reconciled === true).length,
    justified: values.filter((value) => value.justified === true || value.attachment || value.attachments?.length).length,
    balance: Number(values.reduce((sum, value) => sum + Number(value.amount_ttc ?? value.amount ?? 0), 0).toFixed(2)),
  };
}

const transactionFiles = referenceTransactionFiles(reference);
for (const source of transactionFiles) {
  const relative = path.relative(reference, source);
  const target = path.join(candidate, relative);
  assert(fs.existsSync(target), `Transaction historique supprimée : ${relative}`);
  assert.deepEqual(
    yaml.parse(fs.readFileSync(target, "utf8")),
    yaml.parse(fs.readFileSync(source, "utf8")),
    `Transaction historique modifiée : ${relative}`,
  );
}

const attachmentFiles = filesUnder(reference, "attachments").concat(
  ...fs.readdirSync(path.join(reference, "companies"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => filesUnder(reference, path.join("companies", entry.name, "attachments"))),
);
for (const source of attachmentFiles) {
  const relative = path.relative(reference, source);
  const target = path.join(candidate, relative);
  assert(fs.existsSync(target), `Justificatif historique supprimé : ${relative}`);
  assert.equal(digest(target), digest(source), `Justificatif historique modifié : ${relative}`);
}

const bankingFiles = filesUnder(reference, "banking").concat(
  ...fs.readdirSync(path.join(reference, "companies"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => filesUnder(reference, path.join("companies", entry.name, "banking"))),
);
for (const source of bankingFiles) {
  const relative = path.relative(reference, source);
  const target = path.join(candidate, relative);
  assert(fs.existsSync(target), `Compte bancaire historique supprimé : ${relative}`);
  assert.equal(digest(target), digest(source), `Compte bancaire historique modifié : ${relative}`);
}

console.log(JSON.stringify({
  ok: true,
  historical: transactionMetrics(transactionFiles),
  attachments: attachmentFiles.length,
  bankingFiles: bankingFiles.length,
}, null, 2));
