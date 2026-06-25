"""File parser — converts uploaded files to structured rows, plain text, or invoice items."""

import csv
import io
import re
from typing import Any

from backend.ai import invoice_parser


def _num(value: Any) -> float | int | None:
    if value in (None, ""):
        return None
    if isinstance(value, int | float):
        return value
    text = str(value).strip().replace("$", "").replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def _clamp_nonneg(value: Any) -> float | int | None:
    """Clamp a numeric value to >= 0, preserving None.

    Physical stock and weekly receive/issue counts can never be negative, but
    MJCC fact-check workbooks legitimately carry negative *ending* balances as an
    audit signal (more pulled than received+starting). The dispatch layer rejects
    negatives outright, which aborts the whole commit. We resolve this at data
    entry — the value is floored to 0 here so a single audit artifact can't block
    importing the other 191 items. The original figure remains visible in the
    source workbook's audit tabs.
    """
    n = _num(value)
    if n is None:
        return None
    return n if n >= 0 else 0


def _inventory_category(label: Any) -> str | None:
    text = str(label or "").strip()
    if not text:
        return None
    norm = re.sub(r"[^a-z0-9]", "", text.lower())
    if norm in {"miamijobcorpscafeteriainventory", "itemdescription"}:
        return None
    if "total" in norm:
        return None
    # Maps normalized cell text from MJCC monthly inventory workbooks to exact
    # inventory_categories names. Taxonomy: Dairy, Cereal, Beverages, Snacks,
    # Meats, Frozen Food, Dry Goods, Produce, Disposables.
    category_map = {
        "dairy": "Dairy",
        "cereal": "Cereal",
        "beverages": "Beverages",
        "beverage": "Beverages",
        "snacks": "Snacks",
        "snack": "Snacks",
        "meats": "Meats",
        "meat": "Meats",
        "protein": "Meats",
        "frozenfood": "Frozen Food",
        "frozenfoods": "Frozen Food",
        "frozengoods": "Frozen Food",
        "frozen": "Frozen Food",
        "drygoods": "Dry Goods",
        "dry": "Dry Goods",
        "produce": "Produce",
        "fresh": "Produce",
        "disposibles": "Disposables",
        "disposables": "Disposables",
        "supplies": "Disposables",
        "supply": "Disposables",
    }
    exact = category_map.get(norm)
    if exact:
        return exact
    # Substring fallback for compound labels like "Produce & Fresh" or
    # "Protein & Meat" (normalize → "producefresh" / "proteinmeat") that don't
    # match an exact key. Order matters — most specific first.
    for token, canonical in (
        ("frozen", "Frozen Food"),
        ("produce", "Produce"),
        ("protein", "Meats"),
        ("meat", "Meats"),
        ("dairy", "Dairy"),
        ("cereal", "Cereal"),
        ("beverage", "Beverages"),
        ("snack", "Snacks"),
        ("drygood", "Dry Goods"),
        ("disposable", "Disposables"),
        ("suppl", "Disposables"),
    ):
        if token in norm:
            return canonical
    return None


def _inventory_sku(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"\d+(\.0)?", text):
        digits = text.split(".", 1)[0]
        if len(digits) < 4:
            return ""
        return digits
    return text


def _find_mjcc_grid_header(
    rows: list[tuple],
) -> tuple[int, int] | None:
    """Locate the MJCC inventory header row and description column.

    Scans every row looking for "item description" (case-insensitive) in any
    of the first 5 columns.  Returns (row_index, desc_col_index) or None.

    The original parser required "item description" at exactly column B (index 1)
    with issued/received headers at fixed offsets.  That fails for workbooks where
    the layout is shifted (column A used for SKU, item-description in column B is
    fine, but some "fact-checked" variants put the description in column A or C).
    """
    for row_idx, row in enumerate(rows):
        for col_idx in range(min(5, len(row))):
            cell = str(row[col_idx] or "").strip().lower()
            if cell == "item description" or cell == "description":
                return row_idx, col_idx
    return None


def _parse_mjcc_monthly_inventory(content: bytes) -> list[dict[str, Any]]:
    try:
        import openpyxl
    except ImportError:
        return []

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    parsed: list[dict[str, Any]] = []
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))

        header_info = _find_mjcc_grid_header(rows)
        if not header_info:
            continue
        _, desc_col = header_info

        # Derive column offsets relative to the description column.
        # Standard MJCC layout (desc_col=1):
        #   col 0 = SKU, col 1 = Item Description, col 2 = On Hand,
        #   col 3 = Unit Price, col 4 = Unit (sometimes absent),
        #   cols 5-8 = W1-W4 Issued, cols 9-12 = W1-W4 Received
        # When desc_col differs, shift all offsets accordingly.
        sku_col = desc_col - 1 if desc_col > 0 else None
        onhand_col = desc_col + 1
        price_col = desc_col + 2
        # Issued / received: offset from desc_col.  In the standard layout
        # there is one "gap" column (unit) at desc_col+3, then 4 issued columns,
        # then 4 received columns.  Use a flexible scan: treat any column at
        # desc_col+3 or later that is numeric as week data in order.
        w_start = desc_col + 3  # first weekly column (W1 issued or W1 received)
        cat_col = desc_col  # category labels appear in the same column as desc

        # Need at least onhand column to bother parsing
        min_cols_needed = price_col + 1
        if not any(len(row) >= min_cols_needed for row in rows):
            continue

        category: str | None = None
        for row in rows:
            cells = list(row) + [None] * max(0, w_start + 9 - len(row))
            maybe_category = _inventory_category(cells[cat_col])
            # Detect amount columns: onhand, price, and first four weekly cols
            amount_indices = [onhand_col, price_col] + list(range(w_start, w_start + 4))
            row_has_item_amounts = any(
                _num(cells[idx]) is not None
                for idx in amount_indices
                if idx < len(cells)
            )
            if maybe_category and not row_has_item_amounts:
                category = maybe_category
                continue
            if category is None:
                continue

            desc = str(cells[cat_col] or "").strip()
            if (
                not desc
                or desc.lower() in ("item description", "description")
                or "total" in desc.lower()
            ):
                continue
            onhand_val = (
                _clamp_nonneg(cells[onhand_col]) if onhand_col < len(cells) else None
            )
            price_val = (
                _clamp_nonneg(cells[price_col]) if price_col < len(cells) else None
            )
            sku_val = (
                _inventory_sku(cells[sku_col])
                if sku_col is not None and sku_col < len(cells)
                else ""
            )
            if onhand_val is None and price_val is None and not sku_val:
                continue

            def _wcol(offset: int) -> float | int | None:
                idx = w_start + offset
                return _clamp_nonneg(cells[idx]) if idx < len(cells) else None

            parsed.append(
                {
                    "sku": sku_val,
                    "desc": desc,
                    "category": category,
                    "onHand": onhand_val or 0,
                    "price": price_val,
                    "w1i": _wcol(0) or 0,
                    "w2i": _wcol(1) or 0,
                    "w3i": _wcol(2) or 0,
                    "w4i": _wcol(3) or 0,
                    "w1r": _wcol(4) or 0,
                    "w2r": _wcol(5) or 0,
                    "w3r": _wcol(6) or 0,
                    "w4r": _wcol(7) or 0,
                    "unit": "each",
                    "__sheet": ws.title,
                }
            )
    return parsed


_FLAT_INV_HEADER_ALIASES: dict[str, str] = {
    # category
    "category": "category",
    "cat": "category",
    # sku
    "sku": "sku",
    "originalsku": "sku",
    "invoicesku": "sku",
    "itemcode": "sku",
    "code": "sku",
    # description
    "description": "desc",
    "itemdescription": "desc",
    "invoicedescription": "desc",
    "item": "desc",
    # on-hand = the OPENING balance for the period. In this system on_hand is the
    # opening figure and ENDING is computed (opening + received - issued). So map
    # the STARTING balance here. Mapping "Ending OH" was a bug: it fed the closing
    # stock back in as the opening, which hid all received/issued activity and
    # double-stated the balance. "Ending OH" / "Ending Value" are deliberately
    # NOT mapped — ending is derived, never imported as on_hand.
    "startoh": "onHand",
    "startingoh": "onHand",
    "startonhand": "onHand",
    "startingonhand": "onHand",
    "startingbalance": "onHand",
    "beginningoh": "onHand",
    "openingoh": "onHand",
    "openingbalance": "onHand",
    # Plain single-column snapshots (no separate start/ending) — treat the lone
    # on-hand column as the opening for entry.
    "onhand": "onHand",
    "qtyonhand": "onHand",
    # price
    "unitprice": "price",
    "latestunitcost": "price",
    "latestunitcost$": "price",
    "unitcost": "price",
    "price": "price",
    # par / reorder threshold (header normalized: non-alphanumerics stripped)
    "par": "par",
    "parlevel": "par",
    "parstock": "par",
    "reorder": "par",
    "reorderpoint": "par",
    "reorderlevel": "par",
    "minstock": "par",
    "minimum": "par",
    "minqty": "par",
    "threshold": "par",
}


def _norm_header(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").strip().lower())


def _parse_mjcc_flat_inventory(content: bytes) -> list[dict[str, Any]]:
    """Parse a flat columnar MJCC inventory workbook (e.g. "* Full Inventory" /
    "* Fact checked" exports).

    Unlike the weekly grid (_parse_mjcc_monthly_inventory), these sheets carry a
    title banner in the top rows, then a single header row such as:

        Category | SKU | Description | Start OH | Total Rcvd | Total Pulled |
        Ending OH | Unit Price | Ending Value

    We locate that header row by scanning the first rows of each sheet for one
    that contains a description column plus a sku or category column, map columns
    by name, and emit one row per item.  Only the FIRST sheet with a usable
    header is consumed so multi-tab audit workbooks don't double-count.

    Mapping rules (see _FLAT_INV_HEADER_ALIASES):
    - Start OH  -> on_hand   (the OPENING balance; ending is computed downstream)
    - Unit Price -> unit_price
    - Ending OH / Ending Value are NOT imported — ending = opening + received -
      issued, so importing the closing figure as on_hand would double-state stock
      and hide all weekly activity.
    - Total Rcvd / Total Pulled are NOT forced into weekly columns — a monthly
      total has no honest week attribution, and the weekly received/issued data
      is owned by the per-week invoice/pull-sheet uploads. dispatch_inventory_save
      preserves existing weekly columns when those keys are omitted.
    """
    try:
        import openpyxl
    except ImportError:
        return []

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue

        header_idx: int | None = None
        col_map: dict[int, str] = {}
        # Scan the first 15 rows for a recognizable header.
        for r_idx, row in enumerate(rows[:15]):
            mapping: dict[int, str] = {}
            for c_idx, cell in enumerate(row):
                canonical = _FLAT_INV_HEADER_ALIASES.get(_norm_header(cell))
                if canonical and c_idx not in mapping:
                    mapping[c_idx] = canonical
            fields = set(mapping.values())
            if "desc" in fields and ("sku" in fields or "category" in fields):
                header_idx = r_idx
                col_map = mapping
                break

        if header_idx is None:
            continue

        parsed: list[dict[str, Any]] = []
        for row in rows[header_idx + 1 :]:
            if all(v is None for v in row):
                continue
            rec: dict[str, Any] = {}
            for c_idx, canonical in col_map.items():
                if c_idx < len(row):
                    rec[canonical] = row[c_idx]

            desc = str(rec.get("desc") or "").strip()
            cat_raw = str(rec.get("category") or "").strip()
            # Skip total / summary / repeated-header rows.
            if not desc or "total" in desc.lower() or desc.lower() == "description":
                continue
            if "total" in cat_raw.lower():
                continue

            sku = _inventory_sku(rec.get("sku"))
            category = _inventory_category(cat_raw) or cat_raw or "Dry Goods"
            onhand = _clamp_nonneg(rec.get("onHand"))
            price = _clamp_nonneg(rec.get("price"))
            par = _clamp_nonneg(
                rec.get("par")
            )  # par/reorder level when the sheet has it
            if not sku and onhand is None and price is None:
                continue

            row_out: dict[str, Any] = {
                "sku": sku,
                "desc": desc,
                "category": category,
                "onHand": onhand if onhand is not None else 0,
                "price": price,
                "unit": "each",
                "__sheet": ws.title,
            }
            # Emit par for every row when the sheet HAS a par column (0 for blanks),
            # so map_rows_to_inventory sees the column even if the first row is blank.
            if "par" in col_map.values():
                row_out["par"] = par if par is not None else 0
            parsed.append(row_out)

        if parsed:
            return parsed  # first usable sheet wins — avoid double-counting tabs
    return []


_HEADER_ROW_TOKENS = set(_FLAT_INV_HEADER_ALIASES) | {
    "itemdescription",
    "qty",
    "quantity",
    "onhand",
    "par",
    "unit",
    "received",
    "issued",
    "pulled",
    "total",
}


def _looks_like_banner_headers(keys: list[Any]) -> bool:
    """True when a sheet's column keys are a title banner / placeholders rather
    than real headers (e.g. pandas read 'MIAMI JOB CORPS CENTER' + 'Unnamed: 1'
    ... because the real header sits a few rows down)."""
    real = [k for k in keys if k != "__sheet"]
    if not real:
        return False
    junk = 0
    recognized = 0
    for k in real:
        norm = _norm_header(k)
        low = str(k).strip().lower()
        if low.startswith(("unnamed", "col_")) or not norm:
            junk += 1
        if norm in _HEADER_ROW_TOKENS:
            recognized += 1
    # Banner if almost nothing is a recognized column AND placeholders dominate.
    return recognized < 2 and junk >= max(1, len(real) // 2)


def _reheader_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Repair rows whose header is actually a title banner.

    When a workbook carries a banner above the real header, pandas keys every
    row by that banner ('Unnamed: 1'...), burying the true column names in the
    first data row. This scans the first rows for the genuine header (a row whose
    *values* contain recognized column tokens) and re-keys every row beneath it.

    This is what lets the AI fallback succeed: rows_to_text() keys its output off
    the first row, so without this the model receives 'Unnamed: 1' columns with
    the real header as a stray data line — the exact input that was timing out.
    Re-keying also gives map_rows_to_inventory a second, deterministic chance.
    """
    if not rows or not _looks_like_banner_headers(list(rows[0].keys())):
        return rows

    header_idx: int | None = None
    for i, row in enumerate(rows[:15]):
        vals = [v for k, v in row.items() if k != "__sheet"]
        score = sum(1 for v in vals if _norm_header(v) in _HEADER_ROW_TOKENS)
        if score >= 2:
            header_idx = i
            break
    if header_idx is None:
        return rows

    header_row = rows[header_idx]
    data_keys = [k for k in header_row if k != "__sheet"]
    new_keys = [
        str(header_row[k]).strip() if header_row[k] not in (None, "") else f"col_{j}"
        for j, k in enumerate(data_keys)
    ]
    sheet = rows[0].get("__sheet")

    out: list[dict[str, Any]] = []
    for row in rows[header_idx + 1 :]:
        vals = [row[k] for k in row if k != "__sheet"]
        if all(v is None for v in vals):
            continue
        rec: dict[str, Any] = {
            new_keys[j]: vals[j] for j in range(min(len(new_keys), len(vals)))
        }
        rec["__sheet"] = sheet
        out.append(rec)
    return out or rows


def parse_csv(content: bytes) -> list[dict[str, Any]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [dict(row) for row in reader]


def parse_tsv(content: bytes) -> list[dict[str, Any]]:
    text = content.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [dict(row) for row in reader]


def parse_excel(content: bytes) -> list[dict[str, Any]]:
    monthly_inventory = _parse_mjcc_monthly_inventory(content)
    if monthly_inventory:
        return monthly_inventory

    # Flat columnar exports ("Full Inventory" / "Fact checked") carry a title
    # banner above a Category|SKU|Description|...|Ending OH|Unit Price header.
    # Detect and map these deterministically before falling back to pandas
    # (which would read the banner row as headers) or AI (which times out).
    flat_inventory = _parse_mjcc_flat_inventory(content)
    if flat_inventory:
        return flat_inventory

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
            sheet_rows = [
                {**row, "__sheet": sheet_name}
                for row in frame.where(pd.notnull(frame), None).to_dict(
                    orient="records"
                )
            ]
            # Repair banner-as-header sheets so both the deterministic mapper and
            # the AI fallback receive real column names instead of 'Unnamed: N'.
            result.extend(_reheader_rows(sheet_rows))
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
    _ZIP_IMG_PAGE_CAP = 16
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
        _PDF_PAGE_CAP = 10  # ponytail: US Foods invoices ≤ 8 pages; 10 is safe ceiling
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

    # Single images: always route to vision AI (Gemini/GPT-4o/etc.) as primary.
    # Pre-running OCR here and short-circuiting on partial results caused Gemini
    # to be skipped for multi-invoice photos and thermal receipts where OCR only
    # captured some items. The OCR→regex cascade is the fallback inside _extract_ops.
    if is_image:
        try:
            content = invoice_parser._normalize_image_for_ocr(content)
        except Exception:
            pass
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
