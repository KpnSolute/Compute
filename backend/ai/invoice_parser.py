"""
Invoice parser — deterministic extraction from PDF invoices and image receipts.

Extraction cascade for PDFs:
  1. Native text via pdfplumber (fast, zero-cost for digital PDFs)
  2. OCR.space cloud API (scanned / image PDFs) — set OCR_API_KEY env var
  3. Local pytesseract (optional, needs system Tesseract + pdf2image install)

Image files (jpg/png/webp/etc.) go directly to OCR.space → pytesseract fallback.

Public API:
  parse_invoice_bytes_pdf(content, filename, api_key, ocr_only, debug) -> dict
  parse_invoice_bytes_image(content, filename, api_key, debug) -> dict
  invoice_items_to_ops(items, meta, month, year, week, direction, live_categories) -> list[dict]
  bridge_category(vendor_cat, live_cats) -> str

Item shape returned by parse_* functions:
  {category, sku, description, label, pack_size, unit,
   qty_ordered, qty_shipped, qty_adj, unit_price, ext_price, weight_lbs, raw}
"""

import io
import os
import re
from typing import Any

import httpx
import pdfplumber

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
USFOODS_LINE_RE = re.compile(
    r"^\s*(\d{1,4})"  # G1: qty ordered
    r"\s+(\d{1,4})"  # G2: qty shipped
    r"\s+(-?\d{1,3})"  # G3: qty adjustment
    r"\s+([A-Z]{2,4})"  # G4: sales unit (CS, LB, EA, etc.)
    r"\s+(\d{5,7})"  # G5: US Foods product number (item #)
    r"\s+(.+?)"  # G6: description body (brand + desc + pack)
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # G7: unit price
    r"\s+(\d{1,3}(?:,\d{3})*\.\d{2})"  # G8: extended price
    r"\s*$",
)

# Lines that look like column headers or page noise — skip before regex matching
USFOODS_SKIP_RE = re.compile(
    r"^\s*(?:"
    r"ORD\s+SHP\s+ADJ|"  # column header row
    r"ITEM\s*(?:#|NO|NUMBER)|"  # item header
    r"PAGE\s+\d+\s+OF\s+\d+|"  # page numbers
    r"INVOICE\s+SUMMARY|"  # INVOICE SUMMARY section header (parsed separately)
    r"(?:SUBTOTAL|NET\s+TOTAL|FUEL\s+SURCHARGE|VIZIENT|MEMBER\s+DISCOUNT)\s*[:\$]"
    r")\s*$",
    re.IGNORECASE,
)

# Thermal / Multi-Flow receipt: QTY  ITEM#  Description  UNIT_PRICE  TOTAL
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
            r"^(U\.?S\.?\s*FOODS?|SYSCO|PERFORMANCE\s*FOOD|GORDON\s*FOOD)",
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
        "subtotal",
        re.compile(
            r"SUBTOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})", re.IGNORECASE
        ),
    ),
    (
        "total_amount",
        re.compile(
            r"(?:INVOICE\s+)?TOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
            re.IGNORECASE,
        ),
    ),
    (
        "tax",
        re.compile(r"TAX\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})", re.IGNORECASE),
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
            r"(?:INVOICE\s+NET|NET\s+TOTAL|NET\s+AMOUNT|AMOUNT\s+DUE)\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})",
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
VENDOR_CAT_BRIDGE: dict[str, str] = {
    "DRY": "Dry Goods",
    "DRY GROCERY": "Dry Goods",
    "GROCERY": "Dry Goods",
    "REFRIGERATED": "Refrigerated",
    "CHILLED": "Refrigerated",
    "FROZEN": "Frozen",
    "BEVERAGES": "Beverages",
    "BEVERAGE": "Beverages",
    "NON-FOOD": "Supplies",
    "NON FOOD": "Supplies",
    "NONFOOD": "Supplies",
    "PRODUCE": "Produce",
    "FRESH PRODUCE": "Produce",
    "DAIRY": "Dairy",
    "BAKERY": "Bakery",
    "BREAD": "Bakery",
    "MEAT": "Meat",
    "POULTRY": "Meat",
    "SEAFOOD": "Seafood",
    "FISH": "Seafood",
    "PAPER": "Supplies",
    "CLEANING": "Supplies",
    "JANITORIAL": "Supplies",
    "CHEMICAL": "Supplies",
}

OCR_SPACE_URL = "https://api.ocr.space/parse/image"


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


def _ocr_space_image(
    content: bytes, filename: str, api_key: str, debug: bool = False
) -> list[str]:
    """Submit image bytes to OCR.space and return page text strings."""
    ext = (os.path.splitext(filename)[1].lower() or ".jpg").lstrip(".")
    mime = f"image/{ext}" if ext not in ("jpg",) else "image/jpeg"
    try:
        resp = httpx.post(
            OCR_SPACE_URL,
            data={
                "apikey": api_key,
                "language": "eng",
                "isOverlayRequired": "false",
                "OCREngine": "2",
                "isTable": "true",
                "scale": "true",
            },
            files={"file": (filename, content, mime)},
            timeout=60,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("IsErroredOnProcessing"):
            errs = result.get("ErrorMessage", ["OCR.space error"])
            raise RuntimeError(errs[0] if isinstance(errs, list) else errs)
        return [p.get("ParsedText", "") for p in result.get("ParsedResults", [])]
    except Exception as exc:
        if debug:
            print(f"[invoice_parser] OCR.space image error: {exc}")
        return []


def _ocr_space_pdf(content: bytes, api_key: str, debug: bool = False) -> list[str]:
    """Submit PDF bytes to OCR.space (free tier: up to 3 pages)."""
    try:
        resp = httpx.post(
            OCR_SPACE_URL,
            data={
                "apikey": api_key,
                "language": "eng",
                "isOverlayRequired": "false",
                "OCREngine": "2",
                "isTable": "true",
            },
            files={"file": ("invoice.pdf", content, "application/pdf")},
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get("IsErroredOnProcessing"):
            errs = result.get("ErrorMessage", ["OCR.space error"])
            raise RuntimeError(errs[0] if isinstance(errs, list) else errs)
        return [p.get("ParsedText", "") for p in result.get("ParsedResults", [])]
    except Exception as exc:
        if debug:
            print(f"[invoice_parser] OCR.space PDF error: {exc}")
        return []


def _extract_text_native(content: bytes) -> list[str]:
    """Extract text from a digital PDF via pdfplumber."""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


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
    return meta


def _parse_page_lines(text: str, current_cat: str) -> tuple[list[dict], str]:
    """Parse one page worth of lines into item dicts. Returns (items, updated_category)."""
    items: list[dict] = []
    for line in text.splitlines():
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
            # Weight-priced items (PRICING_UNIT=LB): per-case cost = ext_price / qty_shipped
            if unit == "LB" and qty_shipped > 0:
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
    """Distribute the invoice-level discount across line items so that
    SUM(qty × adjusted_unit_price) == invoices.net_total exactly.

    The Vizient GPO discount on US Foods invoices is a lump-sum reduction —
    line items carry the pre-discount price.  This function applies a
    proportional discount_factor so every item's stored price reflects what
    the cafeteria actually paid.

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
    stated_subtotal = _f(meta.get("subtotal"))
    vizient = _f(meta.get("vizient_discount"))
    fuel = _f(meta.get("fuel_surcharge"))
    net_total = _f(meta.get("net_total") or meta.get("total_amount"))

    # Derive net_total from components when the header omits it
    if net_total <= 0 and stated_subtotal > 0:
        net_total = round(stated_subtotal - vizient + fuel, 2)
    if net_total <= 0 and computed_subtotal > 0 and vizient > 0:
        net_total = round(computed_subtotal - vizient + fuel, 2)

    # Discount factor: scale all prices so they sum to net_total
    discount_factor = 1.0
    if net_total > 0 and computed_subtotal > 0:
        discount_factor = net_total / computed_subtotal

    adjusted: list[dict] = []
    for item in items:
        raw_unit = _f(item.get("unit_price", 0))
        raw_ext = _f(item.get("ext_price", 0))
        adj_unit = round(raw_unit * discount_factor, 4)
        adj_ext = round(raw_ext * discount_factor, 2)
        adjusted.append({**item, "unit_price": adj_unit, "ext_price": adj_ext})

    adjusted_total = round(sum(_f(i["ext_price"]) for i in adjusted), 2)
    delta = round(abs(adjusted_total - net_total), 2) if net_total > 0 else 0.0
    delta_pct = round(delta / net_total * 100, 3) if net_total > 0 else 0.0

    stats: dict = {
        "computed_subtotal": computed_subtotal,
        "stated_subtotal": stated_subtotal,
        "vizient_discount": vizient,
        "fuel_surcharge": fuel,
        "net_total": net_total,
        "discount_factor": round(discount_factor, 6),
        "adjusted_total": adjusted_total,
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
            pages = _ocr_space_pdf(content, key, debug)
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
    pages: list[str] = []

    if key:
        pages = _ocr_space_image(content, filename, key, debug)
    if not any(p.strip() for p in pages):
        pages = _extract_image_local_ocr(content, debug)

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
    weekly = week in (1, 2, 3, 4, 5)
    invoice_ref = meta.get("invoice_number", "")
    ops: list[dict] = []

    for item in items:
        sku = _clean(item.get("sku", ""))
        desc = _clean(item.get("description", ""))
        unit_price = item.get("unit_price") or 0.0
        qty = _int(item.get("qty_shipped") or item.get("qty_ordered") or 0)

        # skip items with no identity signal
        if not sku and not desc:
            continue

        # generate a deterministic slug SKU from description when vendor SKU absent
        if not sku and desc:
            words = desc.upper().split()[:2]
            slug = "".join(w[:3] for w in words)
            sku = f"INV-{slug}" if slug else ""

        if not sku:
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

    return ops


# ── Vision-based invoice extraction ──────────────────────────────────────────

_VISION_PROMPT = """You are an invoice data extraction engine for a food service cafeteria.
Extract ALL line items from this invoice image using the extract_invoice_line tool,
then call extract_invoice_summary once for the totals block.

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
      "weight_lbs": 0.0
    }
  ]
}
Rules:
- sku: use the US Foods product number (5-7 digits) when visible; fall back to description slug
- For LB-priced items: unit_price = ext_price / qty_shipped (per-case cost)
- qty_shipped: numeric quantity delivered; use 1 if not shown
- Include EVERY product line item — skip subtotal/header/address lines
- Return ONLY the JSON object, no explanation."""


def extract_invoice_vision(
    images: list[bytes],
    meta: dict,
    cfg: dict,
    *,
    called_by: str | None = None,
) -> dict:
    """Extract invoice line items from image(s) using AI vision.

    Returns {'meta': {...}, 'items': [...], 'reconciled': bool, 'computed_total': float}.
    Items have the same field shape as parse_invoice_bytes_pdf/image.
    """
    from backend.ai import engine as ai_engine

    raw_text = ai_engine.complete_vision(
        _VISION_PROMPT,
        images,
        cfg,
        operation="invoice_vision",
        called_by=called_by,
    )

    try:
        data = ai_engine.extract_json(raw_text)
    except Exception:
        return {"meta": meta, "items": [], "reconciled": False, "computed_total": 0.0}

    if not isinstance(data, dict):
        return {"meta": meta, "items": [], "reconciled": False, "computed_total": 0.0}

    parsed_meta = {
        **meta,
        "vendor_name": data.get("vendor"),
        "invoice_number": data.get("invoice_number"),
        "invoice_date": data.get("invoice_date"),
        "subtotal": data.get("subtotal"),
        "vizient_discount": data.get("vizient_discount"),
        "fuel_surcharge": data.get("fuel_surcharge"),
        "net_total": data.get("net_total"),
    }

    items = []
    for it in data.get("items") or []:
        sku = str(it.get("sku") or "").strip()
        desc = str(it.get("description") or sku).strip()
        unit = str(it.get("unit") or "CS").upper()
        qty = int(float(it.get("qty_shipped") or 1))
        unit_price = float(it.get("unit_price") or 0)
        ext_price = float(it.get("ext_price") or (qty * unit_price))
        # Normalise weight-priced items from vision path
        if unit == "LB" and qty > 0 and unit_price > 0:
            unit_price = round(ext_price / qty, 4)
        items.append(
            {
                "category": "",
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

    subtotal = float(parsed_meta.get("subtotal") or 0)
    computed_total = round(sum(it["ext_price"] for it in items), 2)
    reconciled = (
        subtotal > 0
        and computed_total > 0
        and abs(computed_total - subtotal) / max(subtotal, 0.01) < 0.02
    )

    return {
        "meta": parsed_meta,
        "items": items,
        "reconciled": reconciled,
        "computed_total": computed_total,
    }
