import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}assets/pdf.worker.min.js`;

export function PdfPreview({ url, data, title }: { url?: string; data?: Uint8Array; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!url && !data) { setError("Source PDF indisponible"); setLoading(false); return; }
    setLoading(true);
    setError("");
    const task = pdfjs.getDocument(data ? { data: new Uint8Array(data) } : { url: url!, withCredentials: true });
    async function render() {
      try {
        const document = await task.promise;
        if (!containerRef.current || cancelled) return;
        containerRef.current.replaceChildren();
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          if (!containerRef.current || cancelled) return;
          const baseViewport = page.getViewport({ scale: 1 });
          const availableWidth = Math.max(320, containerRef.current.clientWidth - 32);
          const viewport = page.getViewport({ scale: Math.min(2, availableWidth / baseViewport.width) });
          const canvas = window.document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.className = "mx-auto mb-4 max-w-full bg-white shadow-lg";
          canvas.setAttribute("aria-label", `${title} — page ${pageNumber}`);
          containerRef.current.appendChild(canvas);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Canvas indisponible");
          await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Lecture du PDF impossible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void render();
    return () => { cancelled = true; void task.destroy(); };
  }, [url, data, title]);

  return <div className="relative min-h-0 w-full flex-1 self-stretch overflow-auto bg-black/20 p-4">
    {loading && <p className="py-8 text-center text-sm text-vscode-muted">Chargement du PDF…</p>}
    {error && <p role="alert" className="py-8 text-center text-sm text-red-400">Impossible d’afficher ce PDF : {error}</p>}
    <div ref={containerRef} />
  </div>;
}
