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
      'rows'         — list of dicts (CSV/Excel/TSV): deterministic column mapping.
      'text'         — plain string (PDF/txt): AI extraction.
      'invoice_items' — dict {'meta':..., 'items':[...]} from deterministic invoice parser.
    """
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''

    # PDFs: try deterministic invoice parser first, fall back to plain text
    if ext == 'pdf':
        try:
            parsed = invoice_parser.parse_invoice_bytes_pdf(content, filename)
            if parsed['items']:
                return 'invoice_items', parsed
        except Exception:
            pass
        return 'text', parse_pdf(content)

    # Image receipts: route through OCR invoice parser
    if f'.{ext}' in invoice_parser.IMAGE_EXTENSIONS:
        try:
            parsed = invoice_parser.parse_invoice_bytes_image(content, filename)
            return 'invoice_items', parsed
        except Exception:
            pass
        return 'text', ''

    if ext == 'csv':
        return 'rows', parse_csv(content)
    if ext in ('xls', 'xlsx'):
        return 'rows', parse_excel(content)
    if ext == 'tsv':
        return 'rows', parse_tsv(content)

    # try CSV heuristic for unknown text files
    try:
        rows = parse_csv(content)
        if rows and len(rows[0]) > 1:
            return 'rows', rows
    except Exception:
        pass

    return 'text', content.decode('utf-8', errors='replace')
