import io
import json
import os
import tempfile
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pypdfium2 as pdfium
from pypdf import PdfReader
from PIL import Image, ImageEnhance, ImageOps
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
            # Les photos de smartphone ne conservent pas toujours leur EXIF
            # après compression. Ce petit modèle détecte aussi les documents
            # physiquement tournés à 90, 180 ou 270 degrés.
            use_doc_orientation_classify=True,
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
    # Corrige gratuitement l'orientation lorsque le téléphone a conservé
    # l'information EXIF, avant de laisser PaddleOCR traiter les autres cas.
    with Image.open(io.BytesIO(data)) as source:
        return [ImageOps.exif_transpose(source).convert("RGB")]


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
    def send_bytes(self, status, body, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # Le client peut avoir fermé la connexion pendant une analyse
            # longue. Le worker reste sain et accepte la prochaine tâche.
            pass

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {"status": "ok", "engine": "paddleocr-local"})
        else:
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path not in {"/ocr", "/rotate", "/transform"}:
            return self.send_json(404, {"error": "not found"})
        length = int(self.headers.get("Content-Length", "0"))
        mimetype = self.headers.get("X-Mime-Type", "application/octet-stream")
        if length <= 0 or length > MAX_BODY:
            return self.send_json(413, {"error": "document too large"})
        if mimetype not in {"application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"}:
            return self.send_json(415, {"error": "unsupported document"})
        try:
            data = self.rfile.read(length)
            if self.path == "/rotate":
                if not mimetype.startswith("image/"):
                    return self.send_json(415, {"error": "only images can be rotated"})
                degrees = int(self.headers.get("X-Rotation", "0"))
                if degrees not in {-90, 90, 180}:
                    return self.send_json(400, {"error": "rotation must be -90, 90 or 180"})
                with Image.open(io.BytesIO(data)) as source:
                    image = ImageOps.exif_transpose(source).convert("RGB").rotate(-degrees, expand=True)
                    output = io.BytesIO()
                    image.save(output, format="JPEG", quality=90, optimize=True)
                return self.send_bytes(200, output.getvalue(), "image/jpeg")
            if self.path == "/transform":
                if not mimetype.startswith("image/"):
                    return self.send_json(415, {"error": "only images can be transformed"})
                operation = self.headers.get("X-Transform", "")
                with Image.open(io.BytesIO(data)) as source:
                    image = ImageOps.exif_transpose(source).convert("RGB")
                    if operation == "enhance":
                        image = ImageEnhance.Contrast(ImageOps.autocontrast(ImageOps.grayscale(image))).enhance(1.35).convert("RGB")
                    elif operation == "crop":
                        # Retire les marges de prise de vue sans risquer de couper le centre du ticket.
                        left, top = int(image.width * .04), int(image.height * .04)
                        image = image.crop((left, top, image.width - left, image.height - top))
                    else:
                        return self.send_json(400, {"error": "unknown transform"})
                    output = io.BytesIO(); image.save(output, format="JPEG", quality=90, optimize=True)
                return self.send_bytes(200, output.getvalue(), "image/jpeg")
            text = recognize(data, mimetype)
            self.send_json(200, {"text": text})
        except Exception as error:
            traceback.print_exc()
            self.send_json(500, {"error": str(error)[:300]})

    def log_message(self, fmt, *args):
        print("ocr-worker:", fmt % args, flush=True)


if __name__ == "__main__":
    # Charge et télécharge les petits modèles avant d'annoncer le service prêt.
    engine()
    ThreadingHTTPServer(("0.0.0.0", int(os.getenv("PORT", "8000"))), Handler).serve_forever()
