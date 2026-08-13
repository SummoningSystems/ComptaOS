// Sur un petit VPS CPU, le premier passage d'une photo tournée peut dépasser
// une minute (chargement des modèles inclus). Les traitements en lot sont déjà
// exécutés en arrière-plan : ce délai protège contre un worker réellement
// bloqué sans interrompre une reconnaissance normale.
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_DELAY_MS = 750;

class LocalOcrTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`L'analyse OCR locale a dépassé ${Math.max(1, Math.ceil(timeoutMs / 1000))} secondes`);
    this.name = "LocalOcrTimeoutError";
  }
}

export function localOcrUrl(): string | undefined {
  return process.env.OCR_LOCAL_URL?.replace(/\/$/, "");
}

async function responseError(response: Response): Promise<string> {
  try {
    const result = await response.json() as { error?: unknown };
    if (typeof result.error === "string" && result.error.trim()) return result.error.trim();
  } catch {
    // The status code remains useful when the worker did not return JSON.
  }
  return `HTTP ${response.status}`;
}

async function recognizeOnce(baseUrl: string, buffer: Buffer, mimetype: string): Promise<string> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.OCR_LOCAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream", "X-Mime-Type": mimetype },
      body: buffer as unknown as BodyInit,
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = new Error(`OCR local indisponible (${response.status}): ${await responseError(response)}`);
      Object.assign(error, { status: response.status });
      throw error;
    }
    const result = await response.json() as { text?: unknown };
    if (typeof result.text !== "string" || !result.text.trim()) throw new Error("Aucun texte reconnu par l'OCR local");
    return result.text;
  } catch (error) {
    if (controller.signal.aborted) throw new LocalOcrTimeoutError(timeoutMs);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractTextLocally(buffer: Buffer, mimetype: string): Promise<string> {
  const baseUrl = localOcrUrl();
  if (!baseUrl) throw new Error("Service OCR local non configuré");

  try {
    return await recognizeOnce(baseUrl, buffer, mimetype);
  } catch (error) {
    // Relancer immédiatement un calcul qui vient réellement d'expirer ne fait
    // qu'empiler une seconde tâche derrière la première dans le worker.
    if (error instanceof LocalOcrTimeoutError) throw error;
    const status = (error as Error & { status?: number }).status;
    if (status !== undefined && status < 500) throw error;
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.OCR_LOCAL_RETRY_DELAY_MS) || DEFAULT_RETRY_DELAY_MS));
    return recognizeOnce(baseUrl, buffer, mimetype);
  }
}

export async function rotateImageLocally(buffer: Buffer, mimetype: string, degrees: -90 | 90 | 180): Promise<Buffer> {
  const baseUrl = localOcrUrl();
  if (!baseUrl) throw new Error("Service OCR local non configuré");
  const response = await fetch(`${baseUrl}/rotate`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Mime-Type": mimetype, "X-Rotation": String(degrees) }, body: buffer as unknown as BodyInit });
  if (!response.ok) throw new Error(`Rotation impossible (${response.status}): ${await responseError(response)}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function transformImageLocally(buffer: Buffer, mimetype: string, operation: "enhance" | "crop"): Promise<Buffer> {
  const baseUrl = localOcrUrl(); if (!baseUrl) throw new Error("Service OCR local non configuré");
  const response = await fetch(`${baseUrl}/transform`, { method: "POST", headers: { "Content-Type": "application/octet-stream", "X-Mime-Type": mimetype, "X-Transform": operation }, body: buffer as unknown as BodyInit });
  if (!response.ok) throw new Error(`Transformation impossible (${response.status}): ${await responseError(response)}`);
  return Buffer.from(await response.arrayBuffer());
}
