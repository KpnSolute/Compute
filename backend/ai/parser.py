"""File parser — converts uploaded files to structured rows, plain text, or invoice items."""

import csv
import io
from typing import Any

from backend.ai import invoice_parser


def parse_csv(content: bytes) -> list[dict[str, Any]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def parse_tsv(content: bytes) -> list[dict[str, Any]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [dict(row) for row in reader]


def parse_excel(content: bytes) -> list[dict[str, Any]]:
    try:
        import pandas as pd

        sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, engine="openpyxl")
        result: list[dict[str, Any]] = []
        for sheet_name, frame in sheets.items():
            frame = frame.dropna(how="all")
            if frame.empty:
                continue
            frame.columns = [
                str(col).strip() if col is not None else f"col_{i}"
                for i, col in enumerate(frame.columns)
            ]
            for row in frame.where(pd.notnull(frame), None).to_dict(orient="records"):
                row["__sheet"] = sheet_name
                result.append(row)
        if result:
            return result
    except ImportError:
        pass
    except Exception:
        pass

    try:
        import openpyxl
    except ImportError:
        raise RuntimeError(
            "openpyxl is required for Excel parsing: pip install openpyxl"
        )
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    result: list[dict[str, Any]] = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        headers = [
            str(h).strip() if h is not None else f"col_{i}"
            for i, h in enumerate(rows[0])
        ]
        for row in rows[1:]:
            if all(v is None for v in row):
                continue
            mapped = {
                headers[i]: row[i] if i < len(row) else None
                for i in range(len(headers))
            }
            mapped["__sheet"] = ws.title
            result.append(mapped)
    return result


_PDF_PAGE_CAP = 40  # matches invoice_parser._PDF_MAX_PAGES


def parse_pdf(content: bytes) -> str:
    pages: list[str] = []
    try:
        import pdfplumber

        with pdfplumber.open(io.BytesIO(content)) as pdf:
            total = min(len(pdf.pages), _PDF_PAGE_CAP)
            for i in range(total):
                page = pdf.pages[i]
                try:
                    text = page.extract_text() or ""
                except Exception:
                    text = ""
                finally:
                    page.close()
                pages.append(text)
    except ImportError:
        pass

    text = "\n".join(pages).strip()
    if text:
        return text

    try:
        from pdfminer.high_level import extract_text

        return (extract_text(io.BytesIO(content), maxpages=_PDF_PAGE_CAP) or "").strip()
    except ImportError:
        raise RuntimeError("pdfplumber or pdfminer.six is required for PDF parsing.")
    except Exception:
        return ""


def rows_to_text(rows: list[dict]) -> str:
    """Convert structured rows to a readable text block for AI prompts."""
    if not rows:
        return ""
    headers = list(rows[0].keys())
    lines = ["\t".join(headers)]
    for row in rows:
        lines.append("\t".join(str(row.get(h, "")) for h in headers))
    return "\n".join(lines)


def detect_and_parse(
    filename: str, content: bytes
) -> tuple[str, list[dict] | str | dict]:
    """
    Returns (kind, data):
      'rows'           — list of dicts (CSV/Excel/TSV): deterministic column mapping.
      'text'           — plain string (PDF/txt): AI text extraction.
      'invoice_items'  — dict {'meta':..., 'items':[...]} from deterministic invoice parser.
      'invoice_images' — dict {'images':[bytes,...], 'meta':{}} for vision/OCR path.

    Content sniffed by magic bytes first; filename extension used as fallback only.
    """
    import zipfile as _zipfile

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    # ── magic-byte sniffing ───────────────────────────────────────────────────
    is_pdf = content[:4] == b"%PDF"
    is_zip = content[:4] == b"PK\x03\x04"
    is_jpeg = content[:2] == b"\xff\xd8"
    is_png = content[:4] == b"\x89PNG"
    is_image = is_jpeg or is_png or f".{ext}" in invoice_parser.IMAGE_EXTENSIONS

    # ZIPs that bundle images (e.g. multi-page invoice scan saved as .pdf).
    # OOM GUARD: a 13-page JPEG bundle at native size can exceed 100-200MB
    # decompressed on a 512MB Render instance -- the same memory ceiling that
    # forced the 6-page/96dpi cap on the PDF-render fallback below. Apply the
    # same discipline here: cap pages AND re-encode/downscale each image so
    # peak heap stays bounded regardless of how the scan was captured.
    _ZIP_IMG_PAGE_CAP = 8
    _ZIP_IMG_MAX_DIM = 1600  # px, longest side
    if is_zip:
        try:
            with _zipfile.ZipFile(io.BytesIO(content)) as zf:
                all_names = [
                    n
                    for n in sorted(zf.namelist())
                    if n.lower().endswith(
                        (
                            ".jpg",
                            ".jpeg",
                            ".png",
                            ".webp",
                            ".bmp",
                            ".tif",
                            ".tiff",
                        )
                    )
                ]
                names = all_names[:_ZIP_IMG_PAGE_CAP]
                image_bytes_list: list[bytes] = []
                for name in names:
                    with zf.open(name) as img_f:
                        raw = img_f.read()
                    try:
                        from PIL import Image as _PILImage

                        _im = _PILImage.open(io.BytesIO(raw))
                        _im.load()
                        if max(_im.size) > _ZIP_IMG_MAX_DIM:
                            _scale = _ZIP_IMG_MAX_DIM / max(_im.size)
                            _im = _im.resize(
                                (
                                    max(1, int(_im.width * _scale)),
                                    max(1, int(_im.height * _scale)),
                                )
                            )
                        _buf = io.BytesIO()
                        _im.convert("RGB").save(_buf, format="JPEG", quality=82)
                        image_bytes_list.append(_buf.getvalue())
                        _im.close()
                    except Exception:
                        # If Pillow can't downscale this one, fall back to the
                        # raw bytes rather than dropping the page entirely.
                        image_bytes_list.append(raw)
                if image_bytes_list:
                    return "invoice_images", {
                        "images": image_bytes_list,
                        "meta": {
                            "filename": filename,
                            "pages_truncated": len(names) < len(all_names),
                            "pages_total": len(all_names),
                            "pages_used": len(names),
                        },
                    }
        except Exception:
            pass

    # PDFs: try deterministic invoice parser first, fall back to plain text,
    # then convert to page images for vision AI if text extraction yields nothing.
    if is_pdf or ext == "pdf":
        try:
            parsed = invoice_parser.parse_invoice_bytes_pdf(content, filename)
            if parsed["items"]:
                return "invoice_items", parsed
        except Exception:
            pass
        raw_text = ""
        try:
            raw_text = parse_pdf(content)
        except Exception:
            pass
        if raw_text.strip():
            return "text", raw_text
        # All-image PDF (scanned / no native text) — render pages as PNG for vision AI.
        # 150 DPI is the floor for the model to reliably read dense invoice line-item
        # text (product codes, packed columns, small prices). 96 DPI was tried
        # previously and reliably produced empty extractions — the model could not
        # read the text, not a timeout or API error.
        #
        # Pages are now sent to the vision model ONE AT A TIME (see
        # invoice_parser.extract_invoice_vision), not batched into one request, so
        # raising DPI does not multiply a single request's payload size — peak
        # memory is bounded by ONE page image at a time, not all pages at once.
        # We still cap total pages to guard against pathological uploads.
        _PDF_RENDER_DPI = 150
        _PDF_PAGE_CAP = 8
        try:
            import fitz

            page_images: list[bytes] = []
            with fitz.open(stream=content, filetype="pdf") as _doc:
                pages_total = _doc.page_count
                zoom = _PDF_RENDER_DPI / 72
                matrix = fitz.Matrix(zoom, zoom)
                for _page_index in range(min(pages_total, _PDF_PAGE_CAP)):
                    _page = _doc.load_page(_page_index)
                    _pix = _page.get_pixmap(matrix=matrix, alpha=False)
                    page_images.append(_pix.tobytes("png"))
            if page_images:
                return "invoice_images", {
                    "images": page_images,
                    "meta": {
                        "filename": filename,
                        "pages_total": pages_total,
                        "pages_used": len(page_images),
                        "pages_truncated": pages_total > _PDF_PAGE_CAP,
                    },
                }
        except Exception:
            pass

        try:
            import pdfplumber as _plumber

            page_images: list[bytes] = []
            with _plumber.open(io.BytesIO(content)) as _pdf:
                pages_total = len(_pdf.pages)
                for _page in _pdf.pages[:_PDF_PAGE_CAP]:
                    try:
                        _buf = io.BytesIO()
                        _page.to_image(resolution=_PDF_RENDER_DPI).save(
                            _buf, format="PNG"
                        )
                        page_images.append(_buf.getvalue())
                    except Exception:
                        pass
                    finally:
                        _page.close()
            if page_images:
                return "invoice_images", {
                    "images": page_images,
                    "meta": {
                        "filename": filename,
                        "pages_total": pages_total,
                        "pages_used": len(page_images),
                        "pages_truncated": pages_total > _PDF_PAGE_CAP,
                    },
                }
        except Exception:
            pass
        return "text", ""

    # Single images: OCR path first, vision path as fallback signal
    if is_image:
        try:
            parsed = invoice_parser.parse_invoice_bytes_image(content, filename)
            if parsed.get("items"):
                return "invoice_items", parsed
        except Exception:
            pass
        # Return as invoice_images so caller can route to vision AI
        return "invoice_images", {"images": [content], "meta": {"filename": filename}}

    if ext == "csv":
        return "rows", parse_csv(content)
    if ext in ("xls", "xlsx"):
        return "rows", parse_excel(content)
    if ext == "tsv":
        return "rows", parse_tsv(content)

    # CSV heuristic for unknown text files
    try:
        rows = parse_csv(content)
        if rows and len(rows[0]) > 1:
            return "rows", rows
    except Exception:
        pass

    return "text", content.decode("utf-8", errors="replace")
