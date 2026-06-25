"""
Invoice parser — deterministic extraction from PDF invoices and image receipts.

Extraction cascade for PDFs:
  1. Native text via pdfplumber (fast, zero-cost for digital PDFs)
  2. Google Cloud Vision OCR (scanned / image PDFs) — DB key preferred
  3. OCR.space cloud API (legacy fallback) — set OCR_API_KEY env var
  4. Local pytesseract (optional, needs system Tesseract + pdf2image install)

Image files (jpg/png/webp/etc.) use Google Cloud Vision OCR first, then legacy/local fallbacks.

Public API:
  parse_invoice_bytes_pdf(content, filename, api_key, ocr_only, debug) -> dict
  parse_invoice_bytes_image(content, filename, api_key, debug) -> dict
  invoice_items_to_ops(items, meta, month, year, week, direction, live_categories) -> list[dict]
  bridge_category(vendor_cat, live_cats) -> str

Item shape returned by parse_* functions:
  {category, sku, description, label, pack_size, unit,
   qty_ordered, qty_shipped, qty_adj, unit_price, ext_price, weight_lbs, raw}
"""

import base64
import io
import logging
import os
import re
from typing import Any

import httpx
import pdfplumber

log = logging.getLogger("mjcc.invoice_parser")

# ── image extensions ──────────────────────────────────────────────────────────
IMAGE_EXTENSIONS = frozenset(
    {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".bmp",
        ".gif",
        ".tif",
        ".tiff",
        ".heic",
        ".heif",
    }
)

# ── line-item regexes ─────────────────────────────────────────────────────────

# US Foods columnar (real PDF column order):
# ORD  SHP  ADJ  SALES_UNIT  PRODUCT_NUMBER  body  UNIT_PRICE  EXT_PRICE
# Groups: G1=ord  G2=shp  G3=adj  G4=unit  G5=product#  G6=body  G7=unit_price  G8=ext_price
#
# Price columns on real US Foods PDFs carry a leading "$" and the UNIT price is
# quoted to 4 decimal places (e.g. "$104.0400"), while EXTENDED is 2 ("$104.04").
# The "$" and the optional 3rd/4th decimal sit OUTSIDE the capture groups so the
# captured value is always a clean number float() can parse.
USFOODS_LINE_RE = re.compile(
    r"^\s*(\d{1,4})"  # G1: qty ordered
    r"\s+(\d{1,4})"  # G2: qty shipped
    r"\s+(-?\d{1,3})"  # G3: qty adjustment
    r"\s+([A-Z]{2,4})"  # G4: sales unit (CS, LB, EA, etc.)
    r"\s+(\d{5,7})"  # G5: US Foods product number (item #)
    r"\s+(.+?)"  # G6: description body (brand + desc + pack)
    r"\s+\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2,4})"  # G7: unit price ($ + 2-4 decimals)
    r"\s+\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2,4})"  # G8: extended price ($ + 2-4 decimals)
    r"\s*$",
)

# Lines that look like column headers, fee/summary lines, or recap rows — skip
# before regex matching.  Fee and summary patterns use ".*" to consume the
# full line (including any amounts after the keyword) so they are not
# accidentally captured by GENERIC_LINE_RE.
USFOODS_SKIP_RE = re.compile(
    r"^\s*(?:"
    r"ORD\s+SHP\s+ADJ|"  # column header row
    r"UNIT\s+PRICE\s+EXT|"  # "UNIT  PRICE  EXT" header
    r"UNIT[\s\t]+PRICE|"  # "UNIT PRICE" alone
    r"ITEM\s*(?:#|NO|NUMBER)|"  # item # header
    r"PRODUCT\s*(?:#|NO|NUMBER)|"  # product # header
    r"DESCRIPTION\s+BRAND|"  # description/brand header
    r"PAGE\s+\d+\s+OF\s+\d+|"  # page numbers
    r"INVOICE\s+(?:SUMMARY|LINE\s+DETAILS)|"  # section headers
    r"STORAGE\s+LOCATION.*|"  # storage location recap row/header
    r"DELIVERY\s+SUMMARY.*|"  # delivery summary totals row
    r"TOTAL\s+(?:PIECES|ITEMS|WEIGHT|EXTENDED).*|"  # recap column headers
    r"BILL\s+TO|SHIP\s+TO|REMIT\s+TO|"  # address block labels
    r"SHIPPED\s+FROM|SHIPPED\s+DATE|"  # shipping info labels
    r"DRIVER\s+(?:NAME|ID)|ROUTE\s+NUMBER|STOP\s+NUMBER|"  # route/driver labels
    r"(?:SUBTOTAL|NET\s+TOTAL|FUEL\s+SURCHARGE|FUEL\s+CHARGE|"
    r"VIZIENT|MEMBER\s+DISCOUNT|GPO\s+DISCOUNT|"
    r"DELIVERED\s+AMOUNT|DELIVERY\s+AMOUNT|AMOUNT\s+DUE|"
    r"TAX|SALES\s+TAX|EXCISE\s+TAX|LEVY|ASSESSMENT|"
    r"FREIGHT|HANDLING|SERVICE\s+CHARGE|MISCELLANEOUS|"
    r"PRICING\s+UNIT|SALES\s+REP|PURCHASE\s+ORDER).*"  # fee/financial lines (whole line)
    r")\s*$",
    re.IGNORECASE,
)

# Thermal / Multi-Flow receipt: QTY  ITEM#  Description  UNIT_PRICE  TOTAL
MULTIFLOW_LINE_RE = re.compile(
    r"^\s*(\d{1,3}(?:\.\d+)?)"  # quantity
    r"\s+([A-Z0-9]{1,6})"  # PO / route column, often 0
    r"\s+([A-Z]?\d{5,12})"  # item / sku code
    r"\s+(.+?)"  # description
    r"\s+\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})"  # unit price
    r"\s+\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})"  # total
    r"\s*$",
    re.IGNORECASE,
)

RECEIPT_LINE_RE = re.compile(
    r"^\s*(\d{1,3}(?:\.\d+)?)"  # quantity (may be fractional)
    r"\s+([A-Z0-9]{3,12})"  # item / sku code
    r"\s+(.+?)"  # description (non-greedy)
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # unit price
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # total
    r"\s*$",
)

# Generic fallback: any line ending with two dollar amounts
GENERIC_LINE_RE = re.compile(
    r"^(.+?)"  # description (anything before prices)
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # unit price
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # ext price
    r"\s*$",
)

# Descriptions that are fee/summary rows, not product items. Applied as a
# post-match guard on GENERIC_LINE_RE (which has no SKU to distinguish them).
_FEE_DESC_RE = re.compile(
    r"(?:FUEL\s+SURCHARGE|FUEL\s+CHARGE|VIZIENT|MEMBER\s+DISCOUNT|GPO\s+DISCOUNT|"
    r"SUBTOTAL|NET\s+TOTAL|AMOUNT\s+DUE|DELIVERED\s+AMOUNT|DELIVERY\s+AMOUNT|"
    r"STORAGE\s+LOCATION|DELIVERY\s+SUMMARY|TOTAL\s+EXTENDED|TOTAL\s+PIECES|"
    r"TOTAL\s+ITEMS|TOTAL\s+WEIGHT|INVOICE\s+SUMMARY|FREIGHT|HANDLING|"
    r"MISCELLANEOUS\s+CHARGE|SERVICE\s+CHARGE|ADMINISTRATIVE|"
    r"\bTAX\b|SALES\s+TAX|EXCISE\s+TAX|LEVY|ASSESSMENT)",
    re.IGNORECASE,
)

# US Foods inline category/section header
INLINE_CAT_RE = re.compile(
    r"^\s*(DRY\s+GROCERY|DRY|REFRIGERATED|FROZEN|BEVERAGES?|"
    r"NON-FOOD|NON\s+FOOD|PRODUCE|DAIRY|BAKERY|MEAT|SEAFOOD|"
    r"POULTRY|PAPER|CLEANING|JANITORIAL|CHEMICAL)\s*$",
    re.IGNORECASE,
)

# Labelled category header: "DEPARTMENT: DRY GROCERY"
CATEGORY_LABEL_RE = re.compile(
    r"(?:DEPARTMENT|CATEGORY|CLASS|SECTION)\s*[:\-]\s*(.+)",
    re.IGNORECASE,
)

# Pack-size token inside US Foods body: 4/5LB, 6/#10, 2/2.5GAL, 12/12OZ
PACK_RE = re.compile(
    r"\d+\s*/\s*[#\d]*\d+(?:\.\d+)?\s*(?:LB|OZ|GAL|CT|EA|CS|PC|KG|ML|L)\b",
    re.IGNORECASE,
)

# ── invoice metadata patterns ─────────────────────────────────────────────────
META_PATTERNS: list[tuple[str, re.Pattern]] = [
    (
        "invoice_number",
        re.compile(
            r"INVOICE\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)", re.IGNORECASE
        ),
    ),
    (
        "invoice_date",
        re.compile(
            r"(?:INVOICE\s+)?DATE\s*[:\s]\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
            re.IGNORECASE,
        ),
    ),
    (
        "account_number",
        re.compile(
            r"(?:ACCOUNT|CUST(?:OMER)?)\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]{4,})",
            re.IGNORECASE,
        ),
    ),
    (
        "vendor_name",
        re.compile(
            r"^(U\.?S\.?\s*FOODS?|SYSCO|PERFORMANCE\s*FOOD|GORDON\s*FOOD|MULTI[\-\s]?FLOW\s+INDUSTRIES)",
            re.IGNORECASE | re.MULTILINE,
        ),
    ),
    (
        "po_number",
        re.compile(
            r"P\.?O\.?\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)", re.IGNORECASE
        ),
    ),
    (
        "delivery_date",
        re.compile(
            r"DELIVERY\s+DATE\s*[:\s]\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
            re.IGNORECASE,
        ),
    ),
    ("route", re.compile(r"ROUTE\s*[:\s]\s*(\w+)", re.IGNORECASE)),
    (
        # Authoritative GOODS subtotal — inventory is valued at this number
        # (before Vizient/fuel/tax).  Only matches the explicit "Product Total $X"
        # label from the invoice summary section.  Do NOT match per-page
        # "DELIVERY SUMMARY TOTALS" rows — those are section subtotals that
        # appear once per page on multi-page invoices and will corrupt the
        # product_total if matched early (e.g. page-1 total << full invoice total).
        # When no "PRODUCT TOTAL" label is found, product_total stays 0 and
        # reconcile_and_adjust falls back to the computed line-item sum (delta=0).
        "product_total",
        re.compile(
            r"PRODUCT\s+TOTAL\s*:?\s*\$\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "subtotal",
        re.compile(
            r"(?:MERCHANDISE\s+)?SUBTOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        # Narrow: requires "INVOICE TOTAL" explicitly — avoids matching "PRODUCT TOTAL"
        # via re.search, which would corrupt the financial net-total record.
        "total_amount",
        re.compile(
            r"INVOICE\s+TOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        # Tax captured for financial record only — NEVER used in item valuation.
        "tax",
        re.compile(
            r"(?:SALES\s+)?TAX\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "discount",
        re.compile(
            r"(?:DISCOUNT|PROMO)\s*[:\s]\s*\$?\s*(-?\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "vizient_discount",
        re.compile(
            r"(?:VIZIENT|MEMBER\s+DISCOUNT|GPO\s+DISCOUNT)\s*[:\s]\s*-?\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "fuel_surcharge",
        re.compile(
            r"FUEL\s+(?:SURCHARGE|CHARGE)\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "net_total",
        re.compile(
            r"(?:INVOICE\s+NET|NET\s+TOTAL|NET\s+AMOUNT|AMOUNT\s+DUE|DELIVERED\s+AMOUNT|DELIVERY\s+AMOUNT)\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "order_number",
        re.compile(
            r"ORDER\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)", re.IGNORECASE
        ),
    ),
    ("salesperson", re.compile(r"SALES(?:PERSON|REP)?\s*[:\s]\s*(.+)", re.IGNORECASE)),
    (
        "ship_to",
        re.compile(r"(?:SHIP\s+TO|DELIVERY\s+ADDRESS)\s*[:\s]\s*(.+)", re.IGNORECASE),
    ),
    ("stop", re.compile(r"STOP\s*(?:#|NO\.?)?\s*[:\s]\s*(\w+)", re.IGNORECASE)),
]

# ── structured extraction tool schema (provider-agnostic, OpenAI function-call format) ──
# Any AI model that supports tool/function calling uses these schemas.
# The engine embeds them in prompts for models without native tool calling.
INVOICE_EXTRACTION_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "extract_invoice_line",
            "description": (
                "Extract a single line item from a US Foods invoice. "
                "Call once per product row — do NOT combine multiple rows."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_number": {
                        "type": "string",
                        "description": "US Foods 5-7 digit product / item number (the SKU)",
                    },
                    "description": {
                        "type": "string",
                        "description": "Product description text",
                    },
                    "brand_label": {
                        "type": "string",
                        "description": "Brand or manufacturer label",
                    },
                    "pack_size": {
                        "type": "string",
                        "description": "Pack size e.g. 4/5LB or 6/#10",
                    },
                    "sales_unit": {
                        "type": "string",
                        "enum": ["CS", "LB", "EA", "BX", "DZ", "PK", "GL", "OZ"],
                    },
                    "qty_ordered": {"type": "integer", "minimum": 0},
                    "qty_shipped": {"type": "integer", "minimum": 0},
                    "qty_adj": {"type": "integer"},
                    "unit_price": {
                        "type": "number",
                        "description": "Price per sales_unit. For LB-priced items divide ext_price by qty_shipped.",
                    },
                    "ext_price": {
                        "type": "number",
                        "description": "Extended (line total) price",
                    },
                    "weight_lbs": {
                        "type": "number",
                        "description": "Catch-weight in pounds for LB-priced items; 0 otherwise",
                    },
                },
                "required": [
                    "product_number",
                    "description",
                    "qty_shipped",
                    "unit_price",
                    "ext_price",
                ],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "extract_invoice_summary",
            "description": "Extract the INVOICE SUMMARY / totals block. Call exactly once per invoice.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_number": {"type": "string"},
                    "invoice_date": {"type": "string", "description": "MM/DD/YYYY"},
                    "account_number": {"type": "string"},
                    "subtotal": {"type": "number"},
                    "vizient_discount": {
                        "type": "number",
                        "description": "Vizient/GPO member discount (store as positive; sign applied by system)",
                    },
                    "fuel_surcharge": {"type": "number"},
                    "net_total": {
                        "type": "number",
                        "description": "Final net amount due",
                    },
                },
                "required": ["net_total"],
            },
        },
    },
]

# ── vendor category → MJCC category bridge ───────────────────────────────────
# Target taxonomy: Dairy, Cereal, Beverages, Snacks, Meats, Frozen Food,
#                  Dry Goods, Produce, Disposables, Uncategorized, New Items
VENDOR_CAT_BRIDGE: dict[str, str] = {
    "DRY": "Dry Goods",
    "DRY GROCERY": "Dry Goods",
    "GROCERY": "Dry Goods",
    "REFRIGERATED": "Dairy",
    "CHILLED": "Dairy",
    "FROZEN": "Frozen Food",
    "BEVERAGES": "Beverages",
    "BEVERAGE": "Beverages",
    "NON-FOOD": "Disposables",
    "NON FOOD": "Disposables",
    "NONFOOD": "Disposables",
    "PRODUCE": "Produce",
    "FRESH PRODUCE": "Produce",
    "DAIRY": "Dairy",
    "BAKERY": "Dry Goods",
    "BREAD": "Dry Goods",
    "MEAT": "Meats",
    "POULTRY": "Meats",
    "SEAFOOD": "Meats",
    "FISH": "Meats",
    "PAPER": "Disposables",
    "CLEANING": "Disposables",
    "JANITORIAL": "Disposables",
    "CHEMICAL": "Disposables",
}

OCR_SPACE_URL = "https://api.ocr.space/parse/image"
GOOGLE_CLOUD_VISION_URL = "https://vision.googleapis.com/v1/images:annotate"


def get_google_cloud_vision_key() -> str:
    """Key dedicated to OCR/image reading, separate from the Gemini language key."""
    from backend.ai import engine as _engine

    key, _ = _engine._get_db_row("google_cloud_vision")
    return (
        key
        or os.getenv("GOOGLE_CLOUD_VISION_API_KEY", "")
        or os.getenv("GOOGLE_VISION_API_KEY", "")
    )


def _google_cloud_vision_images(
    images: list[bytes], api_key: str | None = None, debug: bool = False
) -> list[str]:
    """OCR images via Google Cloud Vision DOCUMENT_TEXT_DETECTION."""
    key = api_key or get_google_cloud_vision_key()
    if not key or not images:
        return []

    pages: list[str] = []
    # Cloud Vision annotate supports batching, but small batches keep payloads sane
    # for rendered PDF pages.
    for start in range(0, len(images), 4):
        batch = images[start : start + 4]
        try:
            body = {
                "requests": [
                    {
                        "image": {"content": base64.b64encode(img).decode("ascii")},
                        "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
                        "imageContext": {"languageHints": ["en"]},
                    }
                    for img in batch
                ]
            }
            resp = httpx.post(
                GOOGLE_CLOUD_VISION_URL,
                params={"key": key},
                json=body,
                timeout=90,
            )
            resp.raise_for_status()
            for item in resp.json().get("responses", []):
                if item.get("error"):
                    if debug:
                        print(
                            f"[invoice_parser] Google Vision page error: {item['error']}"
                        )
                    pages.append("")
                else:
                    pages.append(
                        (item.get("fullTextAnnotation") or {}).get("text")
                        or (item.get("textAnnotations") or [{}])[0].get(
                            "description", ""
                        )
                    )
        except Exception as exc:
            if debug:
                print(f"[invoice_parser] Google Vision OCR error: {exc}")
            return []
    return pages


# ── helpers ───────────────────────────────────────────────────────────────────


def _clean(s: Any) -> str:
    return str(s).strip() if s is not None else ""


def _money(s: str) -> float:
    try:
        return float(str(s).replace(",", "").strip())
    except (ValueError, AttributeError):
        return 0.0


def _int(s: Any) -> int:
    try:
        return int(str(s).split(".")[0].strip())
    except (ValueError, AttributeError):
        return 0


def _split_body(body: str) -> tuple[str, str, str]:
    """Split US Foods body text into (description, brand_label, pack_size)."""
    pack_match = PACK_RE.search(body)
    if pack_match:
        pack_size = pack_match.group(0).strip()
        pre = body[: pack_match.start()].strip()
    else:
        pack_size = ""
        pre = body.strip()

    words = pre.split()
    if len(words) >= 2:
        label = words[0]
        description = " ".join(words[1:])
    else:
        label = ""
        description = pre

    return description, label, pack_size


# ── OCR ───────────────────────────────────────────────────────────────────────


def _normalize_receipt_lines(text: str) -> list[str]:
    """Make OCR output from narrow thermal invoices more row-like."""
    lines = [_clean(line) for line in text.splitlines()]
    normalized: list[str] = []
    pending = ""
    price_pair_re = re.compile(
        r"^\$?\s*\d{1,3}(?:,\d{3})*\.\d{2}\s+\$?\s*\d{1,3}(?:,\d{3})*\.\d{2}$"
    )
    item_start_re = re.compile(
        r"^\d{1,3}(?:\.\d+)?\s+[A-Z0-9]{1,6}\s+[A-Z]?\d{5,12}\b",
        re.IGNORECASE,
    )

    for line in lines:
        if not line:
            if pending:
                normalized.append(pending)
                pending = ""
            continue
        compact = re.sub(r"\s+", " ", line)
        if pending and price_pair_re.match(compact):
            normalized.append(f"{pending} {compact}")
            pending = ""
            continue
        if pending:
            normalized.append(pending)
            pending = ""
        if item_start_re.match(compact) and not re.search(
            r"\d{1,3}(?:,\d{3})*\.\d{2}\s+\$?\d", compact
        ):
            pending = compact
        else:
            normalized.append(compact)
    if pending:
        normalized.append(pending)
    return normalized


def _normalize_image_for_ocr(content: bytes, max_dim: int = 1800) -> bytes:
    """Convert phone/image receipts to bounded JPEG bytes for OCR providers."""
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(content))
        img.load()
        if max(img.size) > max_dim:
            scale = max_dim / max(img.size)
            img = img.resize(
                (max(1, int(img.width * scale)), max(1, int(img.height * scale)))
            )
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=88)
        img.close()
        return buf.getvalue()
    except Exception:
        return content


def _ocr_space(
    content: bytes,
    filename: str,
    api_key: str,
    *,
    is_pdf: bool = False,
    debug: bool = False,
) -> list[str]:
    """Submit bytes to OCR.space and return page text strings.

    is_pdf=True  → sends as application/pdf with a fixed "invoice.pdf" filename.
    is_pdf=False → derives mime from filename extension; defaults to image/jpeg.
    """
    if is_pdf:
        file_tuple = ("invoice.pdf", content, "application/pdf")
        extra_data: dict = {}
        timeout = 120
        label = "PDF"
    else:
        ext = (os.path.splitext(filename)[1].lower() or ".jpg").lstrip(".")
        mime = "image/jpeg" if ext == "jpg" else f"image/{ext}"
        file_tuple = (filename, content, mime)
        extra_data = {"scale": "true"}
        timeout = 60
        label = "image"
    try:
        resp = httpx.post(
            OCR_SPACE_URL,
            data={
                "apikey": api_key,
                "language": "eng",
                "isOverlayRequired": "false",
                "OCREngine": "2",
                "isTable": "true",
                **extra_data,
            },
            files={"file": file_tuple},
            timeout=timeout,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("IsErroredOnProcessing"):
            errs = result.get("ErrorMessage", ["OCR.space error"])
            raise RuntimeError(errs[0] if isinstance(errs, list) else errs)
        return [p.get("ParsedText", "") for p in result.get("ParsedResults", [])]
    except Exception as exc:
        if debug:
            print(f"[invoice_parser] OCR.space {label} error: {exc}")
        return []


_PDF_MAX_PAGES = (
    40  # no US Foods invoice exceeds this; guards against malformed uploads
)


def _extract_text_native(content: bytes) -> list[str]:
    """Extract text from a digital PDF via pdfplumber.

    Streams one page at a time and closes each page object immediately to keep
    heap usage flat on the 512 MB Render instance.  Stops after _PDF_MAX_PAGES.
    """
    pages: list[str] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        total = min(len(pdf.pages), _PDF_MAX_PAGES)
        for i in range(total):
            page = pdf.pages[i]
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            finally:
                page.close()  # release page-level resources immediately
            pages.append(text)
    return pages


def _extract_text_local_ocr(content: bytes, debug: bool = False) -> list[str]:
    """Extract text from a scanned PDF via local Tesseract (optional dep)."""
    try:
        from pdf2image import convert_from_bytes  # type: ignore
        import pytesseract  # type: ignore
    except ImportError:
        if debug:
            print(
                "[invoice_parser] pdf2image/pytesseract not installed — skipping local OCR"
            )
        return []
    try:
        images = convert_from_bytes(content, dpi=200)
        return [pytesseract.image_to_string(img) for img in images]
    except Exception as exc:
        if debug:
            print(f"[invoice_parser] Local PDF OCR error: {exc}")
        return []


def _extract_image_local_ocr(content: bytes, debug: bool = False) -> list[str]:
    """Extract text from an image via local pytesseract (optional dep)."""
    try:
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
    except ImportError:
        if debug:
            print(
                "[invoice_parser] Pillow/pytesseract not installed — skipping local image OCR"
            )
        return []
    try:
        img = Image.open(io.BytesIO(content))
        return [pytesseract.image_to_string(img)]
    except Exception as exc:
        if debug:
            print(f"[invoice_parser] Local image OCR error: {exc}")
        return []


# ── extraction ────────────────────────────────────────────────────────────────


def _extract_meta(pages: list[str]) -> dict[str, str]:
    """Extract invoice metadata from raw page text using regex patterns."""
    combined = "\n".join(pages)
    meta: dict[str, str] = {}
    for key, pattern in META_PATTERNS:
        m = pattern.search(combined)
        if m:
            meta[key] = _clean(m.group(1))
    if meta.get("po_number", "").upper() == "ITEM":
        meta.pop("po_number", None)
    # US Foods lists each GPO incentive on its own line (e.g. "VIZIENT-.50% ...
    # -$98.17 CR" and "VIZIENT-.60% ... -$117.80 CR"). Sum ALL of them for the true
    # member discount instead of capturing only the first.
    viz = re.findall(
        r"(?:VIZIENT|MEMBER\s+DISCOUNT|GPO)[^\n]*?-\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})\s*CR?",
        combined,
        re.IGNORECASE,
    )
    if viz:
        meta["vizient_discount"] = f"{sum(float(v.replace(',', '')) for v in viz):.2f}"
    return meta


def _parse_page_lines(text: str, current_cat: str) -> tuple[list[dict], str]:
    """Parse one page worth of lines into item dicts. Returns (items, updated_category)."""
    items: list[dict] = []
    for line in _normalize_receipt_lines(text):
        stripped = line.strip()
        if not stripped:
            continue

        # skip column headers and INVOICE SUMMARY noise lines
        if USFOODS_SKIP_RE.match(stripped):
            continue

        # inline category / section header
        cat_m = INLINE_CAT_RE.match(stripped)
        if cat_m:
            current_cat = cat_m.group(1).upper().strip()
            continue
        label_m = CATEGORY_LABEL_RE.match(stripped)
        if label_m:
            current_cat = label_m.group(1).upper().strip()
            continue

        # US Foods tabular format (fixed column order: ORD SHP ADJ UNIT PRODUCT# body UNIT_PRICE EXT_PRICE)
        m = USFOODS_LINE_RE.match(stripped)
        if m:
            body = _clean(m.group(6))
            desc, label, pack_size = _split_body(body)
            qty_shipped = _int(m.group(2))
            unit = _clean(m.group(4))
            unit_price = _money(m.group(7))
            ext_price = _money(m.group(8))
            # EXT_PRICE is the authoritative line total. Store the effective cost
            # per SALES unit = ext / qty so qty * unit_price always reconciles to
            # ext. This fixes catch-weight items (sold by the case but PRICED per
            # pound — the printed unit-price column is per-lb while qty is in cases,
            # e.g. flank steak: 2 CS @ $9.72/lb, ext $1,517.36, true case cost
            # $758.68). For normal CS/EA lines ext/qty already equals the printed
            # unit price, so this is a no-op there.
            if qty_shipped > 0 and ext_price > 0:
                unit_price = round(ext_price / qty_shipped, 4)
            items.append(
                {
                    "category": current_cat,
                    "sku": _clean(m.group(5)),  # US Foods product number
                    "description": desc or body,
                    "label": label,
                    "pack_size": pack_size,
                    "unit": unit,
                    "qty_ordered": _int(m.group(1)),
                    "qty_shipped": qty_shipped,
                    "qty_adj": _int(m.group(3)),
                    "unit_price": unit_price,
                    "ext_price": ext_price,
                    "weight_lbs": 0.0,
                    "raw": stripped,
                }
            )
            continue

        # Multi-Flow thermal format:
        # Qty  PO  Item  Description  Price  Total
        m = MULTIFLOW_LINE_RE.match(stripped)
        if m:
            qty_raw = _money(m.group(1))
            qty = int(qty_raw) if qty_raw == int(qty_raw) else 1
            items.append(
                {
                    "category": current_cat or "BEVERAGES",
                    "sku": _clean(m.group(3)).upper(),
                    "description": _clean(m.group(4)),
                    "label": "Multi-Flow",
                    "pack_size": "",
                    "unit": "EA",
                    "qty_ordered": qty,
                    "qty_shipped": qty,
                    "qty_adj": 0,
                    "unit_price": _money(m.group(5)),
                    "ext_price": _money(m.group(6)),
                    "weight_lbs": 0,
                    "raw": stripped,
                }
            )
            continue

        # Thermal / receipt format
        m = RECEIPT_LINE_RE.match(stripped)
        if m:
            qty_raw = _money(m.group(1))
            qty = int(qty_raw) if qty_raw == int(qty_raw) else 1
            items.append(
                {
                    "category": current_cat,
                    "sku": _clean(m.group(2)),
                    "description": _clean(m.group(3)),
                    "label": "",
                    "pack_size": "",
                    "unit": "EA",
                    "qty_ordered": qty,
                    "qty_shipped": qty,
                    "qty_adj": 0,
                    "unit_price": _money(m.group(4)),
                    "ext_price": _money(m.group(5)),
                    "weight_lbs": 0,
                    "raw": stripped,
                }
            )
            continue

        # Generic fallback: description + two prices at end
        m = GENERIC_LINE_RE.match(stripped)
        if m and len(_clean(m.group(1))) >= 4:
            unit_p = _money(m.group(2))
            ext_p = _money(m.group(3))
            # skip noise lines: equal tiny values are usually page numbers
            if unit_p == ext_p and unit_p < 1.0:
                continue
            # skip fee/charge/summary lines that slipped past USFOODS_SKIP_RE
            if _FEE_DESC_RE.search(m.group(1)):
                continue
            items.append(
                {
                    "category": current_cat,
                    "sku": "",
                    "description": _clean(m.group(1)),
                    "label": "",
                    "pack_size": "",
                    "unit": "EA",
                    "qty_ordered": 1,
                    "qty_shipped": 1,
                    "qty_adj": 0,
                    "unit_price": unit_p,
                    "ext_price": ext_p,
                    "weight_lbs": 0,
                    "raw": stripped,
                }
            )

    return items, current_cat


def _parse_text_pages(pages: list[str]) -> tuple[list[dict], dict]:
    """Parse all pages into items. Returns (items, extra_meta)."""
    items: list[dict] = []
    current_cat = ""
    for page in pages:
        page_items, current_cat = _parse_page_lines(page, current_cat)
        items.extend(page_items)

    extra: dict = {}
    if items:
        total = sum(i["ext_price"] for i in items)
        if total > 0:
            extra["computed_total"] = f"{total:.2f}"

    return items, extra


def reconcile_and_adjust(items: list[dict], meta: dict) -> tuple[list[dict], dict]:
    """Value inventory at the invoice's PRODUCT (goods) total — never the net.

    Each item's cost = its printed line total; the parsed line items are normalized
    only to the stated Product Total / merchandise Subtotal to absorb small parse
    noise. Vizient/GPO discount, fuel surcharge and tax are extracted and recorded
    SEPARATELY for the invoice financial record — they are NOT folded into per-item
    inventory cost. So week receivable = sum of item product costs; month = sum of
    weeks. The reconciliation stats are a parse-quality check, not a price adjuster.

    Returns (adjusted_items, reconciliation_stats).
    reconciliation_stats keys:
        computed_subtotal  — sum of raw ext_price before adjustment
        stated_subtotal    — subtotal field from invoice header (0 if absent)
        vizient_discount   — discount amount from invoice header
        fuel_surcharge     — surcharge amount from invoice header
        net_total          — net_total from invoice header
        discount_factor    — multiplier applied to every unit_price/ext_price
        adjusted_total     — sum of ext_price after adjustment (should == net_total)
        delta              — abs(adjusted_total - net_total)
        delta_pct          — delta as % of net_total
        reconciled         — True when delta_pct < 1.0
        item_count         — number of items after adjustment
    """

    def _f(v: Any) -> float:
        try:
            return float(str(v).replace(",", "")) if v else 0.0
        except (ValueError, TypeError):
            return 0.0

    computed_subtotal = round(sum(_f(i.get("ext_price", 0)) for i in items), 2)

    # ── goods-cost fields (the ONLY inputs that drive item valuation) ──────────
    product_total = _f(meta.get("product_total"))  # "Product Total $X" — preferred
    stated_subtotal = _f(meta.get("subtotal"))  # merchandise subtotal — fallback

    # ── financial-record-only fields (NEVER touch item prices) ────────────────
    vizient = _f(meta.get("vizient_discount"))  # GPO/member discount
    fuel = _f(meta.get("fuel_surcharge"))  # fuel surcharge
    tax = _f(meta.get("tax"))  # sales/excise tax
    net_total = _f(meta.get("net_total") or meta.get("total_amount"))  # amount due

    # Valuation target = goods cost ONLY.  Tax, fuel, Vizient, and net_total
    # are NEVER used here — they go to the invoice financial record only.
    valuation_target = product_total or stated_subtotal or 0.0
    valuation_factor = 1.0
    if valuation_target > 0 and computed_subtotal > 0:
        candidate = valuation_target / computed_subtotal
        # Trust normalization only when it is a small correction; a wildly different
        # "total" is a mis-parse → keep the raw line-item cost.
        if 0.9 <= candidate <= 1.1:
            valuation_factor = candidate

    # Multi-Flow thermal receipts have unreliable printed totals — never scale them.
    if any(str(i.get("label", "")).lower() == "multi-flow" for i in items):
        valuation_factor = 1.0

    adjusted: list[dict] = []
    for item in items:
        raw_unit = _f(item.get("unit_price", 0))
        raw_ext = _f(item.get("ext_price", 0))
        adjusted.append(
            {
                **item,
                "unit_price": round(raw_unit * valuation_factor, 4),
                "ext_price": round(raw_ext * valuation_factor, 2),
            }
        )

    # Inventory received value = sum of the product-cost line items.
    product_cost = round(sum(_f(i["ext_price"]) for i in adjusted), 2)

    # Net amount due — financial record ONLY. Prefer the stated net; else derive it
    # from product cost minus the GPO discount plus fuel + tax.
    if net_total <= 0:
        net_total = round(product_cost - vizient + fuel + tax, 2)

    # Reconciliation CHECK (flags a bad parse; does NOT drive valuation): how close
    # the raw parsed line items are to the stated product total.
    ref = valuation_target or computed_subtotal
    delta = round(abs(computed_subtotal - ref), 2)
    delta_pct = round(delta / ref * 100, 3) if ref > 0 else 0.0

    # Finalize the invoice financial fields for the invoices record.
    meta["product_total"] = f"{(valuation_target or computed_subtotal):.2f}"
    meta.setdefault("subtotal", meta["product_total"])
    meta["net_total"] = f"{net_total:.2f}"
    if vizient:
        meta["vizient_discount"] = f"{vizient:.2f}"
    if fuel:
        meta["fuel_surcharge"] = f"{fuel:.2f}"

    stats: dict = {
        "computed_subtotal": computed_subtotal,
        "stated_subtotal": stated_subtotal,
        "product_total": valuation_target or computed_subtotal,
        "product_cost": product_cost,
        "vizient_discount": vizient,
        "fuel_surcharge": fuel,
        "tax": tax,
        "net_total": net_total,
        "discount_factor": round(valuation_factor, 6),
        "adjusted_total": product_cost,
        "delta": delta,
        "delta_pct": delta_pct,
        "reconciled": delta_pct < 1.0,
        "item_count": len(adjusted),
    }
    return adjusted, stats


# ── public API ────────────────────────────────────────────────────────────────


def parse_invoice_bytes_pdf(
    content: bytes,
    filename: str = "invoice.pdf",
    api_key: str | None = None,
    ocr_only: bool = False,
    debug: bool = False,
) -> dict:
    """Parse a PDF invoice from raw bytes.

    Returns {'meta': {...}, 'items': [...]}.
    Tries native text first; falls back to OCR.space, then local Tesseract.
    """
    pages: list[str] = []

    if not ocr_only:
        pages = _extract_text_native(content)

    if not any(p.strip() for p in pages):
        key = api_key or os.getenv("OCR_API_KEY", "")
        if key:
            pages = _ocr_space(content, "invoice.pdf", key, is_pdf=True, debug=debug)
        if not any(p.strip() for p in pages):
            pages = _extract_text_local_ocr(content, debug)

    meta = _extract_meta(pages)
    items, extra = _parse_text_pages(pages)
    meta.update(extra)
    meta["source_file"] = filename

    # Reconcile: apply Vizient discount proportionally so stored prices = what was paid
    items, recon = reconcile_and_adjust(items, meta)
    meta["reconciliation"] = recon

    return {"meta": meta, "items": items}


def parse_invoice_text_pages(
    pages: list[str], filename: str = "cloud-vision.txt"
) -> dict:
    """Parse OCR text pages into the standard invoice parser shape."""
    clean_pages = [p or "" for p in pages]
    meta = _extract_meta(clean_pages)
    items, extra = _parse_text_pages(clean_pages)
    meta.update(extra)
    meta["source_file"] = filename
    meta["ocr_engine"] = "google_cloud_vision"

    items, recon = reconcile_and_adjust(items, meta)
    meta["reconciliation"] = recon

    return {"meta": meta, "items": items}


def parse_invoice_bytes_image(
    content: bytes,
    filename: str = "receipt.jpg",
    api_key: str | None = None,
    debug: bool = False,
) -> dict:
    """Parse an image receipt from raw bytes.

    Returns {'meta': {...}, 'items': [...]}.
    Tries OCR.space first; falls back to local pytesseract.
    """
    key = api_key or os.getenv("OCR_API_KEY", "")
    ocr_content = _normalize_image_for_ocr(content)
    pages: list[str] = []

    google_pages = _google_cloud_vision_images([ocr_content], debug=debug)
    if any(p.strip() for p in google_pages):
        pages = google_pages
    elif key:
        pages = _ocr_space(ocr_content, filename, key, debug=debug)
    if not any(p.strip() for p in pages):
        pages = _extract_image_local_ocr(content, debug)

    if any(p.strip() for p in google_pages):
        return parse_invoice_text_pages(pages, filename)

    meta = _extract_meta(pages)
    items, extra = _parse_text_pages(pages)
    meta.update(extra)
    meta["source_file"] = filename

    items, recon = reconcile_and_adjust(items, meta)
    meta["reconciliation"] = recon

    return {"meta": meta, "items": items}


def bridge_category(vendor_cat: str, live_cats: list[str] | None = None) -> str:
    """Map a vendor category string to the closest MJCC category name.

    Checks the static VENDOR_CAT_BRIDGE first, then tries a case-insensitive
    match against live DB category names. Unknown categories pass through as-is;
    dispatch.py routes them to 'New Items' for manager review.
    """
    key = vendor_cat.upper().strip()
    mapped = VENDOR_CAT_BRIDGE.get(key, "")

    if live_cats:
        target = mapped or vendor_cat
        target_lower = target.lower()
        for cat in live_cats:
            if cat.lower() == target_lower:
                return cat
        # prefix match as fallback
        if len(target_lower) >= 3:
            for cat in live_cats:
                if cat.lower().startswith(target_lower[:4]):
                    return cat

    return mapped or vendor_cat


def invoice_items_to_ops(
    items: list[dict],
    meta: dict,
    month: int,
    year: int,
    week: int,
    direction: str,
    live_categories: dict[str, int] | None = None,
) -> list[dict]:
    """Convert parsed invoice items to MJCC dispatch operation dicts.

    week=0  → inventory_save (whole-month on_hand update)
    week=1-4 → inventory_week_update (post qty_shipped into w{week}_{direction})

    Items without a usable SKU or description are skipped. Unknown categories
    pass through as-is and resolve to 'New Items' in the dispatch layer when
    review_new=True.
    """
    live_cats = list(live_categories.keys()) if live_categories else None
    weekly = week in (1, 2, 3, 4)
    invoice_ref = meta.get("invoice_number", "")
    ops: list[dict] = []
    skipped = 0

    for item in items:
        sku = _clean(item.get("sku", ""))
        desc = _clean(item.get("description", ""))
        unit_price = item.get("unit_price") or 0.0
        # Received quantity = qty SHIPPED (what actually arrived). An item ordered
        # but NOT shipped (SHP=0, $0.00 line — out of stock) was not received, so
        # skip it; otherwise it creates a phantom receipt with no price. We do NOT
        # fall back to qty_ordered, which would record goods that never arrived.
        qty = _int(item.get("qty_shipped"))
        if qty <= 0:
            skipped += 1
            continue

        # drop fee/surcharge/summary rows that leaked through the parser
        if desc and _FEE_DESC_RE.search(desc):
            skipped += 1
            continue

        # skip items with no identity signal
        if not sku and not desc:
            skipped += 1
            continue

        # generate a deterministic slug SKU from description when vendor SKU absent
        if not sku and desc:
            words = desc.upper().split()[:2]
            slug = "".join(w[:3] for w in words)
            sku = f"INV-{slug}" if slug else ""

        if not sku:
            skipped += 1
            continue

        cat_name = bridge_category(item.get("category", ""), live_cats)

        if weekly:
            ops.append(
                {
                    "operation": "inventory_week_update",
                    "payload": {
                        "month": month,
                        "year": year,
                        "week": week,
                        "direction": direction,
                        "review_new": True,
                        "items": [
                            {
                                "sku": sku,
                                "desc": desc or sku,
                                "category": cat_name,
                                "qty": qty,
                                "price": unit_price if unit_price > 0 else None,
                            }
                        ],
                    },
                }
            )
        else:
            ops.append(
                {
                    "operation": "inventory_save",
                    "payload": {
                        "month": month,
                        "year": year,
                        "notes": f"Invoice import: {invoice_ref}"
                        if invoice_ref
                        else "Invoice import",
                        "review_new": True,
                        "items": [
                            {
                                "sku": sku,
                                "desc": desc or sku,
                                "category": cat_name,
                                "onHand": qty,
                                "price": unit_price if unit_price > 0 else None,
                                "par": 0,
                            }
                        ],
                    },
                }
            )

    if skipped:
        log.warning(
            "[invoice_parser] invoice_items_to_ops: skipped %d/%d item(s) with no "
            "usable SKU or description — these will NOT appear in staging",
            skipped,
            len(items),
        )

    return ops


# ── Vision-based invoice extraction ──────────────────────────────────────────

_VISION_PROMPT = """You are an invoice data extraction engine for a food service cafeteria.
This image is ONE PAGE of a multi-page invoice. Extract ALL line items visible on
THIS page only using the extract_invoice_line tool, then call extract_invoice_summary
once for the totals block IF this page shows totals (not every page will).

If the model does not support tool calling, return ONLY valid JSON matching this schema:
{
  "vendor": "vendor name or null",
  "invoice_number": "string or null",
  "invoice_date": "MM/DD/YYYY or null",
  "subtotal": 0.0,
  "vizient_discount": 0.0,
  "fuel_surcharge": 0.0,
  "net_total": 0.0,
  "items": [
    {
      "sku": "US Foods 5-7 digit product number",
      "description": "product name",
      "label": "brand label",
      "pack_size": "e.g. 4/5LB",
      "unit": "CS",
      "qty_ordered": 1,
      "qty_shipped": 1,
      "qty_adj": 0,
      "unit_price": 12.34,
      "ext_price": 12.34,
      "weight_lbs": 0.0,
      "category": "one of the valid category names below"
    }
  ]
}
Rules:
- sku: use the vendor's item/product code exactly as printed (e.g. US Foods 5-7 digit code,
  Multi-Flow codes like F00072501 or F00321005, or FE997); fall back to a slug from the description
- If multiple separate invoices appear in this image, extract ALL line items from ALL of them
- For LB-priced items: unit_price = ext_price / qty_shipped (per-case cost)
- qty_shipped: numeric quantity delivered; use 1 if not shown
- Include EVERY product line item visible — skip subtotal/header/address/fuel-surcharge lines
- If this page has NO product line items (e.g. it's a cover/summary/blank page),
  return "items": []  — do not invent items.
- Any field you cannot find (vendor, invoice_number, totals, etc.): use null / 0.0, do not guess.
- category: classify each item into EXACTLY one of these valid MJCC categories:
  Dairy, Cereal, Beverages, Snacks, Meats, Frozen Food, Dry Goods, Produce, Disposables
  Examples: chicken breast → Meats, whole milk → Dairy, plastic gloves → Disposables,
  orange juice → Beverages, frozen pizza → Frozen Food, lettuce → Produce,
  flour → Dry Goods, corn flakes → Cereal, paper cups → Disposables, chips → Snacks.
  If uncertain, use Dry Goods.
- Return ONLY the JSON object, no explanation."""


def _extract_vision_page(
    image: bytes,
    cfg: dict,
    *,
    page_num: int,
    called_by: str | None,
) -> dict | None:
    """Run vision extraction on a single page image. Returns parsed dict or None on failure.

    Failures here are caught by the caller (extract_invoice_vision) so that one
    unreadable page does not sink extraction of the rest of the invoice.
    """
    from backend.ai import engine as ai_engine

    raw_text = ai_engine.complete_vision(
        _VISION_PROMPT,
        [image],
        cfg,
        operation="invoice_vision",
        called_by=called_by,
    )
    data = ai_engine.extract_json(raw_text)
    if not isinstance(data, dict):
        log.warning(
            "[invoice_parser] page %d: vision response was not a JSON object", page_num
        )
        return None
    return data


def extract_invoice_vision(
    images: list[bytes],
    meta: dict,
    cfg: dict,
    *,
    called_by: str | None = None,
) -> dict:
    """Extract invoice line items from image(s) using AI vision.

    Pages are processed ONE AT A TIME and merged. This is deliberate:
      - A single batched request asking the model to read N pages at once was
        found to silently return an empty item list once images got dense
        (the model would "give up" rather than partially extract). Per-page
        calls are slower in wall-clock time but each call is small, focused,
        and a bad/unreadable page does not zero out the whole invoice.
      - Keeps peak request payload size (and provider-side processing time)
        bounded regardless of how many pages the invoice has.

    Returns {'meta': {...}, 'items': [...], 'reconciled': bool, 'computed_total': float,
             'pages_total': int, 'pages_failed': int}.
    Items have the same field shape as parse_invoice_bytes_pdf/image.
    """
    merged_meta: dict[str, Any] = {}
    items: list[dict] = []
    pages_failed = 0
    consecutive_empty = 0

    for i, img in enumerate(images, start=1):
        try:
            data = _extract_vision_page(img, cfg, page_num=i, called_by=called_by)
        except Exception as e:
            pages_failed += 1
            log.error(
                "[invoice_parser] page %d/%d vision extraction failed: %s",
                i,
                len(images),
                e,
            )
            consecutive_empty += 1
            if consecutive_empty >= 2 and items:
                break  # past the line-item section; remaining pages are summaries/terms
            continue

        if data is None:
            pages_failed += 1
            consecutive_empty += 1
            if consecutive_empty >= 2 and items:
                break
            continue

        # First non-null value for each meta field wins (most invoices put
        # vendor/invoice#/date on page 1, totals on the last page).
        for key in (
            "vendor",
            "invoice_number",
            "invoice_date",
            "subtotal",
            "vizient_discount",
            "fuel_surcharge",
            "net_total",
        ):
            val = data.get(key)
            if val not in (None, "", 0, 0.0) and not merged_meta.get(key):
                merged_meta[key] = val

        page_items = data.get("items") or []
        if not page_items:
            log.info(
                "[invoice_parser] page %d/%d: 0 items extracted (may be a cover/"
                "summary page, or page was unreadable)",
                i,
                len(images),
            )
            consecutive_empty += 1
            if consecutive_empty >= 2 and items:
                break
        else:
            consecutive_empty = 0
        items.extend(page_items)

    if pages_failed and pages_failed == len(images):
        log.error(
            "[invoice_parser] vision extraction failed on ALL %d page(s) — "
            "returning empty result",
            len(images),
        )
        return {
            "meta": meta,
            "items": [],
            "reconciled": False,
            "computed_total": 0.0,
            "pages_total": len(images),
            "pages_failed": pages_failed,
        }

    parsed_meta = {
        **meta,
        "vendor_name": merged_meta.get("vendor"),
        "invoice_number": merged_meta.get("invoice_number"),
        "invoice_date": merged_meta.get("invoice_date"),
        "subtotal": merged_meta.get("subtotal"),
        "vizient_discount": merged_meta.get("vizient_discount"),
        "fuel_surcharge": merged_meta.get("fuel_surcharge"),
        "net_total": merged_meta.get("net_total"),
    }

    norm_items = []
    for it in items:
        sku = str(it.get("sku") or "").strip()
        desc = str(it.get("description") or sku).strip()
        unit = str(it.get("unit") or "CS").upper()
        qty = int(float(it.get("qty_shipped") or 1))
        unit_price = float(it.get("unit_price") or 0)
        ext_price = float(it.get("ext_price") or (qty * unit_price))
        # Normalise weight-priced items from vision path
        if unit == "LB" and qty > 0 and unit_price > 0:
            unit_price = round(ext_price / qty, 4)
        norm_items.append(
            {
                "category": str(it.get("category") or ""),
                "sku": sku,
                "description": desc,
                "label": str(it.get("label") or desc),
                "pack_size": str(it.get("pack_size") or ""),
                "unit": unit,
                "qty_ordered": int(float(it.get("qty_ordered") or qty)),
                "qty_shipped": qty,
                "qty_adj": int(float(it.get("qty_adj") or 0)),
                "unit_price": round(unit_price, 4),
                "ext_price": round(ext_price, 2),
                "weight_lbs": float(it.get("weight_lbs") or 0),
                "raw": str(it),
            }
        )

    # Apply Vizient discount proportionally so stored prices = what was paid.
    # This mirrors what parse_invoice_bytes_pdf does for OCR-parsed invoices.
    norm_items, recon = reconcile_and_adjust(norm_items, parsed_meta)
    parsed_meta["reconciliation"] = recon

    reconciled = recon.get("reconciled", False)
    computed_total = recon.get(
        "adjusted_total", round(sum(it["ext_price"] for it in norm_items), 2)
    )

    log.info(
        "[invoice_parser] vision extraction complete | pages=%d pages_failed=%d "
        "items=%d reconciled=%s",
        len(images),
        pages_failed,
        len(norm_items),
        reconciled,
    )

    return {
        "meta": parsed_meta,
        "items": norm_items,
        "reconciled": reconciled,
        "computed_total": computed_total,
        "pages_total": len(images),
        "pages_failed": pages_failed,
    }
