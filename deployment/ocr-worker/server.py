import io
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image
from paddleocr import PaddleOCR

MAX_BODY = 20 * 1024 * 1024
OCR_LOCK = threading.Lock()
ENGINE = None


def engine():
    global ENGINE
    if ENGINE is None:
        ENGINE = PaddleOCR(
            lang="fr",
            ocr_version="PP-OCRv5",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_detection_model_name="PP-OCRv5_mobile_det",
            text_recognition_model_name="latin_PP-OCRv5_mobile_rec",
        )
    return ENGINE


def images_from_document(data, mimetype):
    if mimetype == "application/pdf":
        document = pdfium.PdfDocument(data)
        try:
            return [page.render(scale=2).to_pil().convert("RGB") for page in document]
        finally:
            document.close()
    return [Image.open(io.BytesIO(data)).convert("RGB")]


def native_pdf_text(data):
    """Préfère le texte embarqué, plus fiable et moins coûteux que l'OCR visuel."""
    try:
        pages = [(page.extract_text() or "").strip() for page in PdfReader(io.BytesIO(data)).pages]
        text = "\n\n".join(page for page in pages if page)
        return text if len(text) >= 40 else ""
    except Exception:
        return ""


def result_text(result):
    payload = getattr(result, "json", None)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if not isinstance(payload, dict):
        return ""
    values = payload.get("res", payload).get("rec_texts", [])
    return "\n".join(str(value) for value in values if str(value).strip())


def recognize(data, mimetype):
    if mimetype == "application/pdf":
        text = native_pdf_text(data)
        if text:
            return text
    texts = []
    with OCR_LOCK:
        for image in images_from_document(data, mimetype):
            with tempfile.NamedTemporaryFile(suffix=".png") as temp:
                image.save(temp.name)
                for result in engine().predict(temp.name):
                    text = result_text(result)
                    if text:
                        texts.append(text)
    return "\n\n".join(texts)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "engine": "paddleocr-local"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/ocr":
            return self.send_json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", "0"))
        mimetype = self.headers.get("X-Mime-Type", "application/octet-stream")
        if length <= 0 or length > MAX_BODY:
            return self.send_json(413, {"error": "document too large"})
        if mimetype not in {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"}:
            return self.send_json(415, {"error": "unsupported document"})
        try:
            text = recognize(self.rfile.read(length), mimetype)
            self.send_json(200, {"text": text})
        except Exception as error:
            self.send_json(500, {"error": str(error)[:300]})

    def log_message(self, fmt, *args):
        print("ocr-worker:", fmt % args, flush=True)


if __name__ == "__main__":
    # Charge et télécharge les petits modèles avant d'annoncer le service prêt.
    engine()
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8000"))), Handler).serve_forever()
