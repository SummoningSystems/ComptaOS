import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateTargetDimensions, compressAttachment, IMAGE_COMPRESSION_THRESHOLD, shouldCompressImage } from "../utils/imageCompression";

afterEach(() => vi.restoreAllMocks());

describe("compression des justificatifs photo", () => {
  it("réduit une photo de smartphone en conservant ses proportions", () => {
    expect(calculateTargetDimensions(4032, 3024)).toEqual({ width: 2200, height: 1650 });
  });
  it("ne redimensionne pas une petite image déjà adaptée", () => {
    expect(calculateTargetDimensions(1200, 800)).toEqual({ width: 1200, height: 800 });
  });
  it("compresse les grandes photos mais laisse les PDF et GIF inchangés", () => {
    expect(shouldCompressImage({ type: "image/jpeg", size: IMAGE_COMPRESSION_THRESHOLD + 1 })).toBe(true);
    expect(shouldCompressImage({ type: "image/heic", size: 100_000 })).toBe(true);
    expect(shouldCompressImage({ type: "image/gif", size: 4_000_000 })).toBe(false);
    expect(shouldCompressImage({ type: "application/pdf", size: 4_000_000 })).toBe(false);
  });
  it("convertit réellement une grande photo en JPEG allégé", async () => {
    const OriginalImage = globalThis.Image;
    class FakeImage {
      naturalWidth = 4032; naturalHeight = 3024; decoding = "auto"; onload: null | (() => void) = null; onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, value: FakeImage });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    const canvas = { width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() }), toBlob: (callback: (blob: Blob) => void) => callback(new Blob([new Uint8Array(300_000)], { type: "image/jpeg" })) } as unknown as HTMLCanvasElement;
    vi.spyOn(document, "createElement").mockReturnValue(canvas);
    try {
      const input = new File([new Uint8Array(2_000_000)], "note.png", { type: "image/png" });
      const result = await compressAttachment(input);
      expect(result).toMatchObject({ compressed: true, uploadedBytes: 300_000, savedPercent: 85 });
      expect(result.file.name).toBe("note.jpg"); expect(canvas.width).toBe(2200); expect(canvas.height).toBe(1650);
    } finally {
      Object.defineProperty(globalThis, "Image", { configurable: true, value: OriginalImage });
    }
  });
});
