"""Tests for the new standard 14-column MJCC workbook format.

Reference workbooks are optional: tests that need real files skip cleanly
when the files are absent.
"""

import io
import pathlib

import pytest

openpyxl = pytest.importorskip("openpyxl")

_JUNE_PATH = pathlib.Path(r"C:\Users\ogdev\JobCorp\June 2026\June Pre-Published Inventory.xlsx")
_MAY_PATH = pathlib.Path(r"C:\Users\ogdev\JobCorp\May 2026\May Published Inventory.xlsx")

STANDARD_HEADER = [
    "Category", "SKU", "Description", "Opening OH",
    "Received Wk1", "Pulled Wk1", "Received Wk2", "Pulled Wk2",
    "Received Wk3", "Pulled Wk3",
    "Total Received", "Total Pulled", "Ending OH", "Unit Price",
]


def _wb_bytes(data_rows: list[list], sheet: str = "Inventory") -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet
    ws.append(STANDARD_HEADER)
    for row in data_rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ── header/mapping ──────────────────────────────────────────────────────────

def test_opening_oh_maps_to_onhand():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_wb_bytes([
        ["Dairy", "12345", "Whole Milk", 50, 10, 5, 8, 3, 6, 2, 24, 10, 40, 1.25],
    ]))
    assert rows and rows[0]["onHand"] == 50


def test_unit_price_maps_to_price():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_wb_bytes([
        ["Dairy", "12345", "Whole Milk", 50, 10, 5, 8, 3, 6, 2, 24, 10, 40, 1.25],
    ]))
    assert rows and rows[0]["price"] == 1.25


# ── Ending OH must NOT become onHand ───────────────────────────────────────

def test_ending_oh_not_imported_as_onhand():
    from backend.ai.parser import parse_excel
    # Opening OH=50, Ending OH=35 — onHand must be 50
    rows = parse_excel(_wb_bytes([
        ["Dairy", "12345", "Whole Milk", 50, 10, 5, 8, 3, 6, 2, 24, 10, 35, 1.25],
    ]))
    assert rows
    assert rows[0]["onHand"] == 50, f"Ending OH imported as onHand; got {rows[0]['onHand']}"


# ── weekly received ────────────────────────────────────────────────────────

def test_weekly_received_mapped():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_wb_bytes([
        ["Dry Goods", "99001", "Rice 25lb", 100, 20, 0, 15, 0, 10, 0, 45, 0, 100, 12.50],
    ]))
    assert rows
    item = rows[0]
    assert item.get("w1r") == 20
    assert item.get("w2r") == 15
    assert item.get("w3r") == 10


# ── weekly pulled when present ─────────────────────────────────────────────

def test_weekly_pulled_mapped_when_present():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_wb_bytes([
        ["Meats", "55010", "Chicken Breast", 80, 10, 5, 8, 3, 6, 2, 24, 10, 70, 3.99],
    ]))
    assert rows
    item = rows[0]
    assert item.get("w1i") == 5
    assert item.get("w2i") == 3
    assert item.get("w3i") == 2


# ── May case: blank weekly pulls, positive Total Pulled ────────────────────

def test_may_total_pulled_preserved_when_weekly_blank():
    from backend.ai.parser import parse_excel
    # Weekly pull cols are None; Total Pulled = 40 (verified monthly figure)
    rows = parse_excel(_wb_bytes([
        ["Produce", "77002", "Lettuce", 60, 15, None, 10, None, 8, None, 33, 40, 27, 0.89],
    ]))
    assert rows
    item = rows[0]
    assert item.get("w1i", 0) == 0, "w1i invented from blank pull col"
    assert item.get("w2i", 0) == 0
    assert item.get("w3i", 0) == 0
    assert item.get("total_pulled_raw") == 40, f"total_pulled_raw not preserved; got {item.get('total_pulled_raw')}"


def test_june_total_pulled_not_preserved_when_weekly_present():
    """When weekly pulls ARE present, total_pulled_raw should NOT be emitted."""
    from backend.ai.parser import parse_excel
    rows = parse_excel(_wb_bytes([
        ["Meats", "55010", "Chicken Breast", 80, 10, 5, 8, 3, 6, 2, 24, 10, 70, 3.99],
    ]))
    assert rows
    assert "total_pulled_raw" not in rows[0], "total_pulled_raw emitted when weekly pulls present"


# ── real workbook row counts ───────────────────────────────────────────────

@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_row_count_june():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_JUNE_PATH.read_bytes())
    assert len(rows) >= 200, f"Expected ~291 rows, got {len(rows)}"


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_row_count_may():
    from backend.ai.parser import parse_excel
    rows = parse_excel(_MAY_PATH.read_bytes())
    assert len(rows) >= 200, f"Expected ~266 rows, got {len(rows)}"


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_may_ending_oh_not_onhand():
    """Verify real May workbook: no row has Ending OH (col M) imported as onHand."""
    from backend.ai.parser import parse_excel

    content = _MAY_PATH.read_bytes()
    rows = parse_excel(content)
    assert rows

    # Load raw Opening OH (col D, idx 3) and Ending OH (col M, idx 12) to compare.
    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    ws = wb["Inventory"]
    raw_all = list(ws.iter_rows(values_only=True))
    wb.close()

    # Find header row by looking for "Opening OH" label
    hdr_idx = next(
        (i for i, r in enumerate(raw_all) if any(str(c or "").strip().lower() == "opening oh" for c in r)),
        None,
    )
    assert hdr_idx is not None, "Could not find header row in May workbook"

    raw_data = [r for r in raw_all[hdr_idx + 1:] if any(v is not None for v in r)]
    mismatches = []
    for parsed, raw in zip(rows, raw_data):
        opening = raw[3] if len(raw) > 3 else None
        ending = raw[12] if len(raw) > 12 else None
        # Only flag rows where opening ≠ ending AND the parsed onHand matches ending
        if opening is not None and ending is not None and opening != ending:
            try:
                if int(parsed["onHand"]) == int(ending):
                    mismatches.append(parsed.get("desc", "?"))
            except (TypeError, ValueError):
                pass

    assert not mismatches, f"Ending OH imported as onHand for: {mismatches[:5]}"


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_may_total_pulled_raw_present():
    """Real May workbook: items with blank weekly pulls should carry total_pulled_raw."""
    from backend.ai.parser import parse_excel

    rows = parse_excel(_MAY_PATH.read_bytes())
    assert rows
    # May has verified monthly Total Pulled in col L; at least some rows should
    # carry total_pulled_raw (those where weekly pull cols were blank).
    preserved = [r for r in rows if r.get("total_pulled_raw")]
    assert preserved, "No total_pulled_raw values preserved from May workbook"
