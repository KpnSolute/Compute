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
IMAGE_EXTENSIONS = frozenset({
    '.jpg', '.jpeg', '.png', '.webp', '.bmp',
    '.gif', '.tif', '.tiff', '.heic', '.heif',
})

# ── line-item regexes ─────────────────────────────────────────────────────────

# US Foods columnar: ITEM_NO  ORD  SHP  ADJ  UNIT  VENDOR_SKU  body  UNIT_PRICE  EXT_PRICE
USFOODS_LINE_RE = re.compile(
    r'^\s*(\d{5,7})'                          # item number (5-7 digits)
    r'\s+(\d{1,4})'                            # qty ordered
    r'\s+(\d{1,4})'                            # qty shipped
    r'\s+(-?\d{1,3})'                          # qty adj
    r'\s+([A-Z]{2,4})'                         # unit (CS, LB, EA, etc.)
    r'\s+(\S+)'                                # vendor / mfgr SKU
    r'\s+(.+?)'                                # body: brand + description + pack (non-greedy)
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # unit price
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # ext price
    r'\s*$',
)

# Thermal / Multi-Flow receipt: QTY  ITEM#  Description  UNIT_PRICE  TOTAL
RECEIPT_LINE_RE = re.compile(
    r'^\s*(\d{1,3}(?:\.\d+)?)'                # quantity (may be fractional)
    r'\s+([A-Z0-9]{3,12})'                    # item / sku code
    r'\s+(.+?)'                                # description (non-greedy)
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # unit price
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # total
    r'\s*$',
)

# Generic fallback: any line ending with two dollar amounts
GENERIC_LINE_RE = re.compile(
    r'^(.+?)'                                  # description (anything before prices)
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # unit price
    r'\s+(\d{1,3}(?:,\d{3})*\.\d{2})'         # ext price
    r'\s*$',
)

# US Foods inline category/section header
INLINE_CAT_RE = re.compile(
    r'^\s*(DRY\s+GROCERY|DRY|REFRIGERATED|FROZEN|BEVERAGES?|'
    r'NON-FOOD|NON\s+FOOD|PRODUCE|DAIRY|BAKERY|MEAT|SEAFOOD|'
    r'POULTRY|PAPER|CLEANING|JANITORIAL|CHEMICAL)\s*$',
    re.IGNORECASE,
)

# Labelled category header: "DEPARTMENT: DRY GROCERY"
CATEGORY_LABEL_RE = re.compile(
    r'(?:DEPARTMENT|CATEGORY|CLASS|SECTION)\s*[:\-]\s*(.+)',
    re.IGNORECASE,
)

# Pack-size token inside US Foods body: 4/5LB, 6/#10, 2/2.5GAL, 12/12OZ
PACK_RE = re.compile(
    r'\d+\s*/\s*[#\d]*\d+(?:\.\d+)?\s*(?:LB|OZ|GAL|CT|EA|CS|PC|KG|ML|L)\b',
    re.IGNORECASE,
)

# ── invoice metadata patterns ─────────────────────────────────────────────────
META_PATTERNS: list[tuple[str, re.Pattern]] = [
    ('invoice_number', re.compile(r'INVOICE\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)', re.IGNORECASE)),
    ('invoice_date',   re.compile(r'(?:INVOICE\s+)?DATE\s*[:\s]\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})', re.IGNORECASE)),
    ('account_number', re.compile(r'(?:ACCOUNT|CUST(?:OMER)?)\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]{4,})', re.IGNORECASE)),
    ('vendor_name',    re.compile(r'^(U\.?S\.?\s*FOODS?|SYSCO|PERFORMANCE\s*FOOD|GORDON\s*FOOD)', re.IGNORECASE | re.MULTILINE)),
    ('po_number',      re.compile(r'P\.?O\.?\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)', re.IGNORECASE)),
    ('delivery_date',  re.compile(r'DELIVERY\s+DATE\s*[:\s]\s*(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})', re.IGNORECASE)),
    ('route',          re.compile(r'ROUTE\s*[:\s]\s*(\w+)', re.IGNORECASE)),
    ('subtotal',       re.compile(r'SUBTOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})', re.IGNORECASE)),
    ('total_amount',   re.compile(r'(?:INVOICE\s+)?TOTAL\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})', re.IGNORECASE)),
    ('tax',            re.compile(r'TAX\s*[:\s]\s*\$?\s*(\d{1,3}(?:,\d{3})*\.\d{2})', re.IGNORECASE)),
    ('discount',       re.compile(r'(?:DISCOUNT|PROMO)\s*[:\s]\s*\$?\s*(-?\d{1,3}(?:,\d{3})*\.\d{2})', re.IGNORECASE)),
    ('order_number',   re.compile(r'ORDER\s*(?:#|NO\.?|NUMBER)?\s*[:\s]\s*([A-Z0-9\-]+)', re.IGNORECASE)),
    ('salesperson',    re.compile(r'SALES(?:PERSON|REP)?\s*[:\s]\s*(.+)', re.IGNORECASE)),
    ('ship_to',        re.compile(r'(?:SHIP\s+TO|DELIVERY\s+ADDRESS)\s*[:\s]\s*(.+)', re.IGNORECASE)),
    ('stop',           re.compile(r'STOP\s*(?:#|NO\.?)?\s*[:\s]\s*(\w+)', re.IGNORECASE)),
]

# ── vendor category → MJCC category bridge ───────────────────────────────────
VENDOR_CAT_BRIDGE: dict[str, str] = {
    'DRY': 'Dry Goods',
    'DRY GROCERY': 'Dry Goods',
    'GROCERY': 'Dry Goods',
    'REFRIGERATED': 'Refrigerated',
    'CHILLED': 'Refrigerated',
    'FROZEN': 'Frozen',
    'BEVERAGES': 'Beverages',
    'BEVERAGE': 'Beverages',
    'NON-FOOD': 'Supplies',
    'NON FOOD': 'Supplies',
    'NONFOOD': 'Supplies',
    'PRODUCE': 'Produce',
    'FRESH PRODUCE': 'Produce',
    'DAIRY': 'Dairy',
    'BAKERY': 'Bakery',
    'BREAD': 'Bakery',
    'MEAT': 'Meat',
    'POULTRY': 'Meat',
    'SEAFOOD': 'Seafood',
    'FISH': 'Seafood',
    'PAPER': 'Supplies',
    'CLEANING': 'Supplies',
    'JANITORIAL': 'Supplies',
    'CHEMICAL': 'Supplies',
}

OCR_SPACE_URL = 'https://api.ocr.space/parse/image'


# ── helpers ───────────────────────────────────────────────────────────────────


def _clean(s: Any) -> str:
    return str(s).strip() if s is not None else ''


def _money(s: str) -> float:
    try:
        return float(str(s).replace(',', '').strip())
    except (ValueError, AttributeError):
        return 0.0


def _int(s: Any) -> int:
    try:
        return int(str(s).split('.')[0].strip())
    except (ValueError, AttributeError):
        return 0


def _split_body(body: str) -> tuple[str, str, str]:
    """Split US Foods body text into (description, brand_label, pack_size)."""
    pack_match = PACK_RE.search(body)
    if pack_match:
        pack_size = pack_match.group(0).strip()
        pre = body[: pack_match.start()].strip()
    else:
        pack_size = ''
        pre = body.strip()

    words = pre.split()
    if len(words) >= 2:
        label = words[0]
        description = ' '.join(words[1:])
    else:
        label = ''
        description = pre

    return description, label, pack_size


# ── OCR ───────────────────────────────────────────────────────────────────────


def _ocr_space_image(content: bytes, filename: str, api_key: str, debug: bool = False) -> list[str]:
    """Submit image bytes to OCR.space and return page text strings."""
    ext = (os.path.splitext(filename)[1].lower() or '.jpg').lstrip('.')
    mime = f'image/{ext}' if ext not in ('jpg',) else 'image/jpeg'
    try:
        resp = httpx.post(
            OCR_SPACE_URL,
            data={
                'apikey': api_key,
                'language': 'eng',
                'isOverlayRequired': 'false',
                'OCREngine': '2',
                'isTable': 'true',
                'scale': 'true',
            },
            files={'file': (filename, content, mime)},
            timeout=60,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get('IsErroredOnProcessing'):
            errs = result.get('ErrorMessage', ['OCR.space error'])
            raise RuntimeError(errs[0] if isinstance(errs, list) else errs)
        return [p.get('ParsedText', '') for p in result.get('ParsedResults', [])]
    except Exception as exc:
        if debug:
            print(f'[invoice_parser] OCR.space image error: {exc}')
        return []


def _ocr_space_pdf(content: bytes, api_key: str, debug: bool = False) -> list[str]:
    """Submit PDF bytes to OCR.space (free tier: up to 3 pages)."""
    try:
        resp = httpx.post(
            OCR_SPACE_URL,
            data={
                'apikey': api_key,
                'language': 'eng',
                'isOverlayRequired': 'false',
                'OCREngine': '2',
                'isTable': 'true',
            },
            files={'file': ('invoice.pdf', content, 'application/pdf')},
            timeout=120,
        )
        resp.raise_for_status()
        result = resp.json()
        if result.get('IsErroredOnProcessing'):
            errs = result.get('ErrorMessage', ['OCR.space error'])
            raise RuntimeError(errs[0] if isinstance(errs, list) else errs)
        return [p.get('ParsedText', '') for p in result.get('ParsedResults', [])]
    except Exception as exc:
        if debug:
            print(f'[invoice_parser] OCR.space PDF error: {exc}')
        return []


def _extract_text_native(content: bytes) -> list[str]:
    """Extract text from a digital PDF via pdfplumber."""
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        return [page.extract_text() or '' for page in pdf.pages]


def _extract_text_local_ocr(content: bytes, debug: bool = False) -> list[str]:
    """Extract text from a scanned PDF via local Tesseract (optional dep)."""
    try:
        from pdf2image import convert_from_bytes  # type: ignore
        import pytesseract  # type: ignore
    except ImportError:
        if debug:
            print('[invoice_parser] pdf2image/pytesseract not installed — skipping local OCR')
        return []
    try:
        images = convert_from_bytes(content, dpi=200)
        return [pytesseract.image_to_string(img) for img in images]
    except Exception as exc:
        if debug:
            print(f'[invoice_parser] Local PDF OCR error: {exc}')
        return []


def _extract_image_local_ocr(content: bytes, debug: bool = False) -> list[str]:
    """Extract text from an image via local pytesseract (optional dep)."""
    try:
        from PIL import Image  # type: ignore
        import pytesseract  # type: ignore
    except ImportError:
        if debug:
            print('[invoice_parser] Pillow/pytesseract not installed — skipping local image OCR')
        return []
    try:
        img = Image.open(io.BytesIO(content))
        return [pytesseract.image_to_string(img)]
    except Exception as exc:
        if debug:
            print(f'[invoice_parser] Local image OCR error: {exc}')
        return []


# ── extraction ────────────────────────────────────────────────────────────────


def _extract_meta(pages: list[str]) -> dict[str, str]:
    """Extract invoice metadata from raw page text using regex patterns."""
    combined = '\n'.join(pages)
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

        # inline category / section header
        cat_m = INLINE_CAT_RE.match(stripped)
        if cat_m:
            current_cat = cat_m.group(1).upper().strip()
            continue
        label_m = CATEGORY_LABEL_RE.match(stripped)
        if label_m:
            current_cat = label_m.group(1).upper().strip()
            continue

        # US Foods tabular format
        m = USFOODS_LINE_RE.match(stripped)
        if m:
            body = _clean(m.group(7))
            desc, label, pack_size = _split_body(body)
            items.append({
                'category': current_cat,
                'sku': _clean(m.group(6)),
                'description': desc or body,
                'label': label,
                'pack_size': pack_size,
                'unit': _clean(m.group(5)),
                'qty_ordered': _int(m.group(2)),
                'qty_shipped': _int(m.group(3)),
                'qty_adj': _int(m.group(4)),
                'unit_price': _money(m.group(8)),
                'ext_price': _money(m.group(9)),
                'weight_lbs': 0,
                'raw': stripped,
            })
            continue

        # Thermal / receipt format
        m = RECEIPT_LINE_RE.match(stripped)
        if m:
            qty_raw = _money(m.group(1))
            qty = int(qty_raw) if qty_raw == int(qty_raw) else 1
            items.append({
                'category': current_cat,
                'sku': _clean(m.group(2)),
                'description': _clean(m.group(3)),
                'label': '',
                'pack_size': '',
                'unit': 'EA',
                'qty_ordered': qty,
                'qty_shipped': qty,
                'qty_adj': 0,
                'unit_price': _money(m.group(4)),
                'ext_price': _money(m.group(5)),
                'weight_lbs': 0,
                'raw': stripped,
            })
            continue

        # Generic fallback: description + two prices at end
        m = GENERIC_LINE_RE.match(stripped)
        if m and len(_clean(m.group(1))) >= 4:
            unit_p = _money(m.group(2))
            ext_p = _money(m.group(3))
            # skip noise lines: equal tiny values are usually page numbers
            if unit_p == ext_p and unit_p < 1.0:
                continue
            items.append({
                'category': current_cat,
                'sku': '',
                'description': _clean(m.group(1)),
                'label': '',
                'pack_size': '',
                'unit': 'EA',
                'qty_ordered': 1,
                'qty_shipped': 1,
                'qty_adj': 0,
                'unit_price': unit_p,
                'ext_price': ext_p,
                'weight_lbs': 0,
                'raw': stripped,
            })

    return items, current_cat


def _parse_text_pages(pages: list[str]) -> tuple[list[dict], dict]:
    """Parse all pages into items. Returns (items, extra_meta)."""
    items: list[dict] = []
    current_cat = ''
    for page in pages:
        page_items, current_cat = _parse_page_lines(page, current_cat)
        items.extend(page_items)

    extra: dict = {}
    if items:
        total = sum(i['ext_price'] for i in items)
        if total > 0:
            extra['computed_total'] = f'{total:.2f}'

    return items, extra


# ── public API ────────────────────────────────────────────────────────────────


def parse_invoice_bytes_pdf(
    content: bytes,
    filename: str = 'invoice.pdf',
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
        key = api_key or os.getenv('OCR_API_KEY', '')
        if key:
            pages = _ocr_space_pdf(content, key, debug)
        if not any(p.strip() for p in pages):
            pages = _extract_text_local_ocr(content, debug)

    meta = _extract_meta(pages)
    items, extra = _parse_text_pages(pages)
    meta.update(extra)
    meta['source_file'] = filename

    return {'meta': meta, 'items': items}


def parse_invoice_bytes_image(
    content: bytes,
    filename: str = 'receipt.jpg',
    api_key: str | None = None,
    debug: bool = False,
) -> dict:
    """Parse an image receipt from raw bytes.

    Returns {'meta': {...}, 'items': [...]}.
    Tries OCR.space first; falls back to local pytesseract.
    """
    key = api_key or os.getenv('OCR_API_KEY', '')
    pages: list[str] = []

    if key:
        pages = _ocr_space_image(content, filename, key, debug)
    if not any(p.strip() for p in pages):
        pages = _extract_image_local_ocr(content, debug)

    meta = _extract_meta(pages)
    items, extra = _parse_text_pages(pages)
    meta.update(extra)
    meta['source_file'] = filename

    return {'meta': meta, 'items': items}


def bridge_category(vendor_cat: str, live_cats: list[str] | None = None) -> str:
    """Map a vendor category string to the closest MJCC category name.

    Checks the static VENDOR_CAT_BRIDGE first, then tries a case-insensitive
    match against live DB category names. Unknown categories pass through as-is;
    dispatch.py routes them to 'New Items' for manager review.
    """
    key = vendor_cat.upper().strip()
    mapped = VENDOR_CAT_BRIDGE.get(key, '')

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
    invoice_ref = meta.get('invoice_number', '')
    ops: list[dict] = []

    for item in items:
        sku = _clean(item.get('sku', ''))
        desc = _clean(item.get('description', ''))
        unit_price = item.get('unit_price') or 0.0
        qty = _int(item.get('qty_shipped') or item.get('qty_ordered') or 0)

        # skip items with no identity signal
        if not sku and not desc:
            continue

        # generate a deterministic slug SKU from description when vendor SKU absent
        if not sku and desc:
            words = desc.upper().split()[:2]
            slug = ''.join(w[:3] for w in words)
            sku = f'INV-{slug}' if slug else ''

        if not sku:
            continue

        cat_name = bridge_category(item.get('category', ''), live_cats)

        if weekly:
            ops.append({
                'operation': 'inventory_week_update',
                'payload': {
                    'month': month,
                    'year': year,
                    'week': week,
                    'direction': direction,
                    'review_new': True,
                    'items': [{
                        'sku': sku,
                        'desc': desc or sku,
                        'category': cat_name,
                        'qty': qty,
                        'price': unit_price if unit_price > 0 else None,
                    }],
                },
            })
        else:
            ops.append({
                'operation': 'inventory_save',
                'payload': {
                    'month': month,
                    'year': year,
                    'notes': f'Invoice import: {invoice_ref}' if invoice_ref else 'Invoice import',
                    'review_new': True,
                    'items': [{
                        'sku': sku,
                        'desc': desc or sku,
                        'category': cat_name,
                        'onHand': qty,
                        'price': unit_price if unit_price > 0 else None,
                        'par': 0,
                    }],
                },
            })

    return ops
