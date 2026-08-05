import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreview({ url, title }: { url: string; title: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url, withCredentials: true });
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
  }, [url, title]);

  return <div className="relative min-h-0 flex-1 overflow-auto bg-black/20 p-4">
    {loading && <p className="py-8 text-center text-sm text-vscode-muted">Chargement du PDF…</p>}
    {error && <p role="alert" className="py-8 text-center text-sm text-red-400">Impossible d’afficher ce PDF : {error}</p>}
    <div ref={containerRef} />
  </div>;
}
