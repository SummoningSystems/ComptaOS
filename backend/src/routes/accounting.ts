import { createReadStream, existsSync } from "fs";
import { basename, join } from "path";
import { FastifyInstance } from "fastify";
import { ZipArchive } from "archiver";
import { buildAccountingPreview, generateBalanceCsv, generateFec, generateJournalCsv, validateFec } from "../services/accountingExportService.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAccountingConfig, loadCompanyProfile, saveAccountingConfig, AccountingConfig, defaultAccountingConfig } from "../services/settingsService.js";
import { loadAllTransactions } from "../services/transactionService.js";
import { activeClosing } from "../services/closingService.js";

async function context(year: string) {
  const config = loadAccountingConfig();
  const transactions = await loadAllTransactions();
  const preview = buildAccountingPreview(transactions, config, year);
  return { config, preview, transactions };
}

function blockers(preview: Awaited<ReturnType<typeof context>>["preview"]) {
  return preview.anomalies.filter((item) => item.severity === "blocking");
}

export async function accountingRoutes(app: FastifyInstance) {
  app.get("/config", async () => loadAccountingConfig());
  app.put<{ Body: AccountingConfig }>("/config", async (request, reply) => {
    const config = request.body;
    const categoryKeys = Object.keys(defaultAccountingConfig().categories) as Array<keyof AccountingConfig["categories"]>;
    const accounts = config && [config.bank, config.revenue, config.vatDeductible, config.vatCollected, ...categoryKeys.map((category) => config.categories?.[category])];
    if (!accounts || accounts.some((account) => !account || typeof account.number !== "string" || typeof account.label !== "string")) return reply.status(400).send({ error: "Configuration comptable incomplète." });
    saveAccountingConfig(request.body);
    return reply.send(loadAccountingConfig());
  });
  app.get<{ Querystring: { year?: string } }>("/preview", async (request) => {
    const { preview } = await context(request.query.year ?? String(new Date().getFullYear()));
    return { ...preview, lines: undefined };
  });
  app.get<{ Querystring: { year?: string } }>("/fec", async (request, reply) => {
    const year = request.query.year ?? String(new Date().getFullYear());
    const { preview } = await context(year); const blocking = blockers(preview);
    if (blocking.length) return reply.status(409).send({ error: "Export bloqué par des anomalies comptables.", anomalies: blocking });
    const fec = generateFec(preview); const errors = validateFec(fec);
    if (errors.length) return reply.status(500).send({ error: "Le validateur interne a rejeté le FEC.", errors });
    const siren = (loadCompanyProfile().siren ?? "ENTREPRISE").replace(/\s/g, "");
    return reply.header("Content-Type", "text/plain; charset=utf-8").header("Content-Disposition", `attachment; filename="${siren}FEC${year}1231.txt"`).send("\uFEFF" + fec);
  });
  app.get<{ Querystring: { year?: string } }>("/package", async (request, reply) => {
    const year = request.query.year ?? String(new Date().getFullYear());
    const { preview, config, transactions } = await context(year); const blocking = blockers(preview);
    if (blocking.length) return reply.status(409).send({ error: "Dossier bloqué par des anomalies comptables.", anomalies: blocking });
    const fec = generateFec(preview); const validationErrors = validateFec(fec);
    if (validationErrors.length) return reply.status(500).send({ error: "Le validateur interne a rejeté le FEC.", errors: validationErrors });
    const profile = loadCompanyProfile(); const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error: Error) => reply.raw.destroy(error));
    reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="dossier-expert-comptable-${year}.zip"`);
    archive.append("\uFEFF" + fec, { name: `FEC/${(profile.siren ?? "ENTREPRISE").replace(/\s/g, "")}FEC${year}1231.txt` });
    archive.append(generateJournalCsv(preview), { name: "journal-comptable.csv" });
    archive.append(generateBalanceCsv(preview), { name: "balance-generale.csv" });
    archive.append(JSON.stringify({ generatedAt: new Date().toISOString(), year, company: profile, accountingConfig: config, controls: { eligibleTransactions: preview.eligibleCount, excludedTransactions: preview.excludedCount, totalDebit: preview.totalDebit, totalCredit: preview.totalCredit, balanced: preview.balanced, fecValidator: "valid", fecValidationErrors: validationErrors }, warnings: preview.anomalies.filter((item) => item.severity === "warning") }, null, 2), { name: "manifest.json" });
    const added = new Set<string>();
    for (const item of preview.lines) {
      if (added.has(item.transactionId)) continue; added.add(item.transactionId);
      const transaction = transactions.find((entry) => entry.id === item.transactionId);
      if (!transaction) continue;
      const attachments = [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])])];
      for (const filename of attachments) {
        const safeName = basename(filename); const path = join(getWorkspaceRoot(), "attachments", safeName);
        if (existsSync(path)) archive.append(createReadStream(path), { name: `justificatifs/${transaction.id}-${safeName.replace(/[^a-zA-Z0-9._-]/g, "_")}` });
      }
    }
    void archive.finalize();
    return reply.send(archive);
  });
  app.get<{ Querystring: { month?: string } }>("/package-month", async (request, reply) => {
    const month = request.query.month ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return reply.status(400).send({ error: "Mois invalide" });
    const transactions = (await loadAllTransactions()).filter((item) => item.date.startsWith(month));
    const config = loadAccountingConfig(); const preview = buildAccountingPreview(transactions, config, month.slice(0, 4));
    const blocking = blockers(preview); if (blocking.length) return reply.status(409).send({ error: "Dossier mensuel bloqué par des anomalies comptables.", anomalies: blocking });
    const closing = await activeClosing(month); const profile = loadCompanyProfile(); const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (error: Error) => reply.raw.destroy(error));
    reply.header("Content-Type", "application/zip").header("Content-Disposition", `attachment; filename="dossier-comptable-${month}.zip"`);
    archive.append(generateJournalCsv(preview), { name: `journal-${month}.csv` });
    archive.append(generateBalanceCsv(preview), { name: `balance-${month}.csv` });
    archive.append(JSON.stringify({ generatedAt: new Date().toISOString(), month, company: profile, closing: closing ?? null, controls: { transactionCount: transactions.length, eligibleTransactions: preview.eligibleCount, totalDebit: preview.totalDebit, totalCredit: preview.totalCredit, balanced: preview.balanced }, warnings: preview.anomalies.filter((item) => item.severity === "warning") }, null, 2), { name: `rapport-cloture-${month}.json` });
    const added = new Set<string>();
    for (const transaction of transactions) for (const filename of [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])])]) {
      const safeName = basename(filename); const attachmentPath = join(getWorkspaceRoot(), "attachments", safeName); const key = `${transaction.id}-${safeName}`;
      if (!added.has(key) && existsSync(attachmentPath)) { added.add(key); archive.append(createReadStream(attachmentPath), { name: `justificatifs/${key.replace(/[^a-zA-Z0-9._-]/g, "_")}` }); }
    }
    void archive.finalize(); return reply.send(archive);
  });
}
