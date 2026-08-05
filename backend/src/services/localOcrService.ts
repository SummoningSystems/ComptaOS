const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_RETRY_DELAY_MS = 750;

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
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OCR_LOCAL_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
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
    const status = (error as Error & { status?: number }).status;
    if (status !== undefined && status < 500) throw error;
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.OCR_LOCAL_RETRY_DELAY_MS) || DEFAULT_RETRY_DELAY_MS));
    return recognizeOnce(baseUrl, buffer, mimetype);
  }
}
