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
        import openpyxl
    except ImportError:
        raise RuntimeError(
            "openpyxl is required for Excel parsing: pip install openpyxl"
        )
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [
        str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(rows[0])
    ]
    result = []
    for row in rows[1:]:
        if all(v is None for v in row):
            continue
        result.append({headers[i]: row[i] for i in range(len(headers))})
    return result


def parse_pdf(content: bytes) -> str:
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError(
            "pdfplumber is required for PDF parsing: pip install pdfplumber"
        )
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        pages = [page.extract_text() or "" for page in pdf.pages]
    return "\n".join(pages).strip()


def rows_to_text(rows: list[dict]) -> str:
    """Convert structured rows to a readable text block for AI prompts."""
    if not rows:
        return ""
    headers = list(rows[0].keys())
    lines = ["\t".join(headers)]
    for row in rows:
        lines.append("\t".join(str(row.get(h, "")) for h in headers))
    return "\n".join(lines)


def detect_and_parse(filename: str, content: bytes) -> tuple[str, list[dict] | str | dict]:
    """
    Returns (kind, data):
      'rows'           — list of dicts (CSV/Excel/TSV): deterministic column mapping.
      'text'           — plain string (PDF/txt): AI text extraction.
      'invoice_items'  — dict {'meta':..., 'items':[...]} from deterministic invoice parser.
      'invoice_images' — dict {'images':[bytes,...], 'meta':{}} for vision/OCR path.

    Content sniffed by magic bytes first; filename extension used as fallback only.
    """
    import zipfile as _zipfile

    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    # ── magic-byte sniffing ───────────────────────────────────────────────────
    is_pdf   = content[:4] == b'%PDF'
    is_zip   = content[:4] == b'PK\x03\x04'
    is_jpeg  = content[:2] == b'\xff\xd8'
    is_png   = content[:4] == b'\x89PNG'
    is_image = is_jpeg or is_png or f'.{ext}' in invoice_parser.IMAGE_EXTENSIONS

    # ZIPs that bundle images (e.g. multi-page invoice scan saved as .pdf)
    if is_zip:
        try:
            with _zipfile.ZipFile(io.BytesIO(content)) as zf:
                image_bytes_list = []
                for name in sorted(zf.namelist()):
                    lo = name.lower()
                    if any(lo.endswith(e) for e in ('.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff')):
                        with zf.open(name) as img_f:
                            image_bytes_list.append(img_f.read())
                if image_bytes_list:
                    return 'invoice_images', {'images': image_bytes_list, 'meta': {'filename': filename}}
        except Exception:
            pass

    # PDFs: try deterministic invoice parser first, fall back to plain text
    if is_pdf or ext == 'pdf':
        try:
            parsed = invoice_parser.parse_invoice_bytes_pdf(content, filename)
            if parsed['items']:
                return 'invoice_items', parsed
        except Exception:
            pass
        try:
            return 'text', parse_pdf(content)
        except Exception:
            return 'text', ''

    # Single images: OCR path first, vision path as fallback signal
    if is_image:
        try:
            parsed = invoice_parser.parse_invoice_bytes_image(content, filename)
            if parsed.get('items'):
                return 'invoice_items', parsed
        except Exception:
            pass
        # Return as invoice_images so caller can route to vision AI
        return 'invoice_images', {'images': [content], 'meta': {'filename': filename}}

    if ext == 'csv':
        return 'rows', parse_csv(content)
    if ext in ('xls', 'xlsx'):
        return 'rows', parse_excel(content)
    if ext == 'tsv':
        return 'rows', parse_tsv(content)

    # CSV heuristic for unknown text files
    try:
        rows = parse_csv(content)
        if rows and len(rows[0]) > 1:
            return 'rows', rows
    except Exception:
        pass

    return 'text', content.decode('utf-8', errors='replace')
