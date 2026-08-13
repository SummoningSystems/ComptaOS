import { afterEach, describe, expect, it, vi } from "vitest";
import { extractTextLocally } from "../services/localOcrService.js";

describe("extractTextLocally", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OCR_LOCAL_URL;
    delete process.env.OCR_LOCAL_RETRY_DELAY_MS;
    delete process.env.OCR_LOCAL_TIMEOUT_MS;
  });

  it("retries once after a transient worker failure", async () => {
    process.env.OCR_LOCAL_URL = "http://ocr:8000";
    process.env.OCR_LOCAL_RETRY_DELAY_MS = "1";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "temporary Paddle failure" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "TOTAL 26,80" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractTextLocally(Buffer.from("receipt"), "image/jpeg")).resolves.toBe("TOTAL 26,80");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry an unsupported document", async () => {
    process.env.OCR_LOCAL_URL = "http://ocr:8000";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "unsupported document" }), { status: 415 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(extractTextLocally(Buffer.from("receipt"), "text/plain"))
      .rejects.toThrow("OCR local indisponible (415): unsupported document");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not stack a retry after a worker timeout", async () => {
    vi.useFakeTimers();
    process.env.OCR_LOCAL_URL = "http://ocr:8000";
    process.env.OCR_LOCAL_TIMEOUT_MS = "10";
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = extractTextLocally(Buffer.from("receipt"), "image/jpeg");
    const assertion = expect(pending).rejects.toThrow("dépassé 1 secondes");
    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
