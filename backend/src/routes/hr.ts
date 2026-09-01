import { createReadStream, existsSync } from "fs";
import fs from "fs/promises";
import { extname, join, basename } from "path";
import multipart from "@fastify/multipart";
import { FastifyInstance } from "fastify";
import { nanoid } from "../utils/id.js";
import { getWorkspaceRoot } from "../services/fileSystem.js";
import { loadAllTransactions, updateTransaction } from "../services/transactionService.js";
import { hrDocumentsPath, isHrDeadline, isHrDocument, isHrEmployee, isHrPayrollMonth, isHrVariable, loadHrStore, saveHrStore, type HrDocument, type HrDocumentType, type HrStore } from "../services/hrService.js";

const validStore = (body: unknown): body is HrStore => {
  if (!body || typeof body !== "object") return false; const data = body as Partial<HrStore>;
  return Array.isArray(data.employees) && data.employees.every(isHrEmployee) && Array.isArray(data.variables) && data.variables.every(isHrVariable) && Array.isArray(data.documents) && data.documents.every(isHrDocument) && Array.isArray(data.deadlines) && data.deadlines.every(isHrDeadline) && Array.isArray(data.payrollMonths) && data.payrollMonths.every(isHrPayrollMonth);
};
const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export async function hrRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024 } });
  async function detachFromTransaction(document: HrDocument) {
    if (!document.transactionId) return;
    const transaction = (await loadAllTransactions()).find((item) => item.id === document.transactionId); if (!transaction) return;
    const attachmentName = `hr_${document.storedName}`; const attachments = [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : [])])].filter((item) => item !== attachmentName);
    try { await fs.unlink(join(getWorkspaceRoot(), "attachments", attachmentName)); } catch { /* déjà absent */ }
    await updateTransaction(transaction.id, { attachment: attachments[0], attachments, justified: attachments.length > 0 });
  }
  app.get("/employees", async () => loadHrStore().employees);
  app.put<{ Body: HrStore["employees"] }>("/employees", async (request, reply) => {
    if (!Array.isArray(request.body) || !request.body.every(isHrEmployee)) return reply.status(400).send({ error: "La liste contient un dossier RH invalide." });
    const store = loadHrStore(); saveHrStore({ ...store, employees: request.body }); return { saved: request.body.length };
  });
  app.get("/workspace", async () => loadHrStore());
  app.put<{ Body: HrStore }>("/workspace", async (request, reply) => {
    if (!validStore(request.body)) return reply.status(400).send({ error: "Les données RH sont invalides." }); saveHrStore(request.body); return { saved: true };
  });
  app.post<{ Params: { employeeId: string }; Querystring: { type?: HrDocumentType; month?: string } }>("/documents/:employeeId", async (request, reply) => {
    const store = loadHrStore(); if (!store.employees.some((item) => item.id === request.params.employeeId)) return reply.status(404).send({ error: "Salarié introuvable." });
    const part = await request.file(); if (!part) return reply.status(400).send({ error: "Aucun fichier reçu." });
    const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]); if (!allowed.has(part.mimetype)) return reply.status(400).send({ error: "Format accepté : PDF, JPEG, PNG ou WEBP." });
    const documentTypes = new Set(["contract", "amendment", "identity", "medical", "expense", "payslip", "other"]); const type = request.query.type ?? "other";
    if (!documentTypes.has(type) || (request.query.month && !/^\d{4}-\d{2}$/.test(request.query.month))) return reply.status(400).send({ error: "Type de document ou mois invalide." });
    const id = nanoid(); const storedName = `${id}${extname(part.filename).toLowerCase() || ".bin"}`;
    await fs.mkdir(hrDocumentsPath(), { recursive: true }); await fs.writeFile(join(hrDocumentsPath(), storedName), await part.toBuffer());
    const document: HrDocument = { id, employeeId: request.params.employeeId, type, month: request.query.month || undefined, originalName: part.filename, storedName, uploadedAt: new Date().toISOString() };
    saveHrStore({ ...store, documents: [...store.documents, document] }); return reply.status(201).send(document);
  });
  app.get<{ Params: { id: string } }>("/documents/file/:id", async (request, reply) => {
    const document = loadHrStore().documents.find((item) => item.id === request.params.id); if (!document) return reply.status(404).send({ error: "Document introuvable." });
    const path = join(hrDocumentsPath(), basename(document.storedName)); if (!existsSync(path)) return reply.status(404).send({ error: "Fichier introuvable." });
    const ext = extname(path); const mime = ext === ".pdf" ? "application/pdf" : ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return reply.header("Content-Type", mime).header("Content-Disposition", `inline; filename="${document.originalName.replaceAll('"', "")}"`).send(createReadStream(path));
  });
  app.delete<{ Params: { id: string } }>("/documents/:id", async (request, reply) => {
    const store = loadHrStore(); const document = store.documents.find((item) => item.id === request.params.id); if (!document) return reply.status(404).send({ error: "Document introuvable." });
    await detachFromTransaction(document);
    try { await fs.unlink(join(hrDocumentsPath(), basename(document.storedName))); } catch { /* déjà absent */ }
    saveHrStore({ ...store, documents: store.documents.filter((item) => item.id !== document.id) }); return { deleted: true };
  });
  app.post<{ Params: { id: string }; Body: { transactionId?: string } }>("/documents/:id/link", async (request, reply) => {
    const store = loadHrStore(); const document = store.documents.find((item) => item.id === request.params.id);
    if (!document || document.type !== "payslip") return reply.status(404).send({ error: "Bulletin introuvable." });
    const transactionId = request.body?.transactionId;
    if (document.transactionId && document.transactionId !== transactionId) await detachFromTransaction(document);
    if (transactionId) {
      const transaction = (await loadAllTransactions()).find((item) => item.id === transactionId); if (!transaction || transaction.amount_ttc >= 0) return reply.status(404).send({ error: "Paiement de salaire introuvable." });
      const attachmentName = `hr_${document.storedName}`; const attachmentsDir = join(getWorkspaceRoot(), "attachments"); await fs.mkdir(attachmentsDir, { recursive: true });
      await fs.copyFile(join(hrDocumentsPath(), basename(document.storedName)), join(attachmentsDir, attachmentName));
      const attachments = [...new Set([...(transaction.attachments ?? []), ...(transaction.attachment ? [transaction.attachment] : []), attachmentName])];
      await updateTransaction(transaction.id, { category: "salary", justified: true, attachment: attachments[0], attachments });
    }
    const documents = store.documents.map((item) => item.id === document.id ? { ...item, transactionId: transactionId || undefined } : item); saveHrStore({ ...store, documents }); return { document: documents.find((item) => item.id === document.id) };
  });
  app.get<{ Querystring: { month?: string } }>("/export.csv", async (request, reply) => {
    const month = request.query.month ?? new Date().toISOString().slice(0, 7); const store = loadHrStore();
    const header = ["Matricule", "Salarié", "Contrat", "Brut mensuel", "Net mensuel", "Coût employeur", "Type variable", "Libellé", "Montant", "Quantité", "Bulletin", "Transaction rapprochée"];
    const rows = store.employees.filter((employee) => employee.active).flatMap((employee) => {
      const variables = store.variables.filter((item) => item.employeeId === employee.id && item.month === month); const payslip = store.documents.find((item) => item.employeeId === employee.id && item.type === "payslip" && item.month === month);
      const base = [employee.id, `${employee.firstName} ${employee.lastName}`, employee.contractType, employee.grossMonthly, employee.netMonthly, employee.employerCostMonthly];
      return (variables.length ? variables : [undefined]).map((variable) => [...base, variable?.type ?? "", variable?.label ?? "", variable?.amount ?? "", variable?.quantity ?? "", payslip?.originalName ?? "", payslip?.transactionId ?? ""]);
    });
    const content = [header, ...rows].map((row) => row.map(csv).join(";")).join("\r\n");
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="preparation-paie-${month}.csv"`).send(`\uFEFF${content}`);
  });
}
