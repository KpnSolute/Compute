"""Tests for the new standard 14-column MJCC workbook format.

Reference workbooks are optional: tests that need real files skip cleanly
when the files are absent.
"""

import io
import pathlib

import pytest

openpyxl = pytest.importorskip("openpyxl")

_JUNE_PATH = pathlib.Path(
    r"C:\Users\ogdev\JobCorp\June 2026\June Published Inventory.xlsx"
)
_MAY_PATH = pathlib.Path(
    r"C:\Users\ogdev\JobCorp\May 2026\May Published Inventory.xlsx"
)
_TEMPLATE_PATH = pathlib.Path(r"C:\Users\ogdev\JobCorp\Monthly Inventory Template.xlsx")

STANDARD_HEADER = [
    "Category",
    "SKU",
    "Description",
    "Opening OH",
    "Received Wk1",
    "Pulled Wk1",
    "Received Wk2",
    "Pulled Wk2",
    "Received Wk3",
    "Pulled Wk3",
    "Total Received",
    "Total Pulled",
    "Ending OH",
    "Unit Price",
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

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Dairy",
                    "12345",
                    "Whole Milk",
                    50,
                    10,
                    5,
                    8,
                    3,
                    6,
                    2,
                    24,
                    10,
                    40,
                    1.25,
                ],
            ]
        )
    )
    assert rows and rows[0]["onHand"] == 50


def test_unit_price_maps_to_price():
    from backend.ai.parser import parse_excel

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Dairy",
                    "12345",
                    "Whole Milk",
                    50,
                    10,
                    5,
                    8,
                    3,
                    6,
                    2,
                    24,
                    10,
                    40,
                    1.25,
                ],
            ]
        )
    )
    assert rows and rows[0]["price"] == 1.25


# ── Ending OH must NOT become onHand ───────────────────────────────────────


def test_ending_oh_not_imported_as_onhand():
    from backend.ai.parser import parse_excel

    # Opening OH=50, Ending OH=35 — onHand must be 50
    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Dairy",
                    "12345",
                    "Whole Milk",
                    50,
                    10,
                    5,
                    8,
                    3,
                    6,
                    2,
                    24,
                    10,
                    35,
                    1.25,
                ],
            ]
        )
    )
    assert rows
    assert rows[0]["onHand"] == 50, (
        f"Ending OH imported as onHand; got {rows[0]['onHand']}"
    )


# ── weekly received ────────────────────────────────────────────────────────


def test_weekly_received_mapped():
    from backend.ai.parser import parse_excel

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Dry Goods",
                    "99001",
                    "Rice 25lb",
                    100,
                    20,
                    0,
                    15,
                    0,
                    10,
                    0,
                    45,
                    0,
                    100,
                    12.50,
                ],
            ]
        )
    )
    assert rows
    item = rows[0]
    assert item.get("w1r") == 20
    assert item.get("w2r") == 15
    assert item.get("w3r") == 10


# ── weekly pulled when present ─────────────────────────────────────────────


def test_weekly_pulled_mapped_when_present():
    from backend.ai.parser import parse_excel

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Meats",
                    "55010",
                    "Chicken Breast",
                    80,
                    10,
                    5,
                    8,
                    3,
                    6,
                    2,
                    24,
                    10,
                    70,
                    3.99,
                ],
            ]
        )
    )
    assert rows
    item = rows[0]
    assert item.get("w1p") == 5
    assert item.get("w2p") == 3
    assert item.get("w3p") == 2


# ── May case: blank weekly pulls, positive Total Pulled ────────────────────


def test_may_total_pulled_preserved_when_weekly_blank():
    from backend.ai.parser import parse_excel

    # Weekly pull cols are None; Total Pulled = 40 (verified monthly figure)
    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Produce",
                    "77002",
                    "Lettuce",
                    60,
                    15,
                    None,
                    10,
                    None,
                    8,
                    None,
                    33,
                    40,
                    27,
                    0.89,
                ],
            ]
        )
    )
    assert rows
    item = rows[0]
    assert item.get("w1p", 0) == 0, "w1p invented from blank pull col"
    assert item.get("w2p", 0) == 0
    assert item.get("w3p", 0) == 0
    assert item.get("total_pulled_raw") == 40, (
        f"total_pulled_raw not preserved; got {item.get('total_pulled_raw')}"
    )


def test_june_total_pulled_not_preserved_when_weekly_present():
    """When weekly pulls ARE present, total_pulled_raw should NOT be emitted."""
    from backend.ai.parser import parse_excel

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Meats",
                    "55010",
                    "Chicken Breast",
                    80,
                    10,
                    5,
                    8,
                    3,
                    6,
                    2,
                    24,
                    10,
                    70,
                    3.99,
                ],
            ]
        )
    )
    assert rows
    assert "total_pulled_raw" not in rows[0], (
        "total_pulled_raw emitted when weekly pulls present"
    )


def test_formula_totals_without_cached_values_are_derived_from_weekly_columns():
    """openpyxl data_only=True returns None for uncached formulas; weekly cells remain authoritative."""
    from backend.ai.parser import parse_excel

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventory"
    ws.append(STANDARD_HEADER)
    ws.append(
        [
            "Dry Goods",
            "1067389",
            "SYRUP, PNCK SS CUP SHLF STABL",
            0,
            3,
            None,
            1,
            None,
            0,
            None,
            "=SUM(E2,G2,I2)",
            "=SUM(F2,H2,J2)",
            "=D2+K2-L2",
            16.56,
        ]
    )
    buf = io.BytesIO()
    wb.save(buf)

    rows = parse_excel(buf.getvalue())
    assert rows
    item = rows[0]
    assert item["onHand"] == 0
    assert item["w1r"] == 3
    assert item["w2r"] == 1
    assert item["w3r"] == 0
    assert item["w1p"] == 0
    assert item["w2p"] == 0
    assert item["w3p"] == 0
    assert "total_pulled_raw" not in item


# ── Review-tab reconciliation ──────────────────────────────────────────────


def _wb_with_review(data_rows, review_rows):
    """Build a workbook with an Inventory grid + a Review control block."""
    wb = openpyxl.Workbook()
    inv = wb.active
    inv.title = "Inventory"
    inv.append(STANDARD_HEADER)
    for row in data_rows:
        inv.append(row)
    rv = wb.create_sheet("Review")
    rv.append(["JUNE 2026 INVENTORY REVIEW"])
    rv.append([])
    rv.append(["Quantity Control", "Verified Total"])
    for label, val in review_rows:
        rv.append([label, val])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_reconciliation_passes_when_grid_matches_review():
    from backend.ai.parser import extract_workbook_reconciliation

    # one item: opening 5, received 10 (4+3+3), pulled 6 (2+2+2) → ending 9
    content = _wb_with_review(
        [["Dairy", "111", "Milk", 5, 4, 2, 3, 2, 3, 2, 10, 6, 9, 1.0]],
        [
            ("Inventory Items", 1),
            ("Opening OH", 5),
            ("Total Received", 10),
            ("Total Pulled", 6),
            ("Ending OH", 9),
        ],
    )
    r = extract_workbook_reconciliation(content)
    assert r is not None
    assert r["reconciled"] is True, r["mismatches"]


def test_reconciliation_fails_when_review_is_stale():
    """Grid has pulls but the Review tab still shows zero pulls (stale) — must flag."""
    from backend.ai.parser import extract_workbook_reconciliation

    content = _wb_with_review(
        [["Dairy", "111", "Milk", 5, 4, 2, 3, 2, 3, 2, 10, 6, 9, 1.0]],
        [
            ("Inventory Items", 1),
            ("Opening OH", 5),
            ("Total Received", 10),
            ("Total Pulled", 0),
            ("Ending OH", 15),
        ],
    )
    r = extract_workbook_reconciliation(content)
    assert r is not None
    assert r["reconciled"] is False
    metrics = {m["metric"] for m in r["mismatches"]}
    assert "pulled" in metrics and "ending" in metrics


def test_reconciliation_none_without_review_tab():
    from backend.ai.parser import extract_workbook_reconciliation

    # _wb_bytes builds an Inventory sheet only — no Review control block.
    content = _wb_bytes([["Dairy", "111", "Milk", 5, 4, 2, 3, 2, 3, 2, 10, 6, 9, 1.0]])
    assert extract_workbook_reconciliation(content) is None


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_reconciliation_may_published_is_clean():
    from backend.ai.parser import extract_workbook_reconciliation

    r = extract_workbook_reconciliation(_MAY_PATH.read_bytes())
    assert r is not None
    assert r["reconciled"] is True, r["mismatches"]


def test_formula_report_extracts_and_matches_template():
    """The system extracts the derived-column formulas and confirms they match the
    template (=SUM(E,G,I) / =SUM(F,H,J) / =D+K-L), recomputing internally."""
    from backend.ai.parser import extract_workbook_formula_report

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventory"
    ws.append(STANDARD_HEADER)
    ws.append(
        [
            "Dairy",
            "111",
            "Milk",
            5,
            4,
            2,
            3,
            2,
            3,
            2,
            "=SUM(E2,G2,I2)",
            "=SUM(F2,H2,J2)",
            "=D2+K2-L2",
            1.0,
        ]
    )
    buf = io.BytesIO()
    wb.save(buf)
    rep = extract_workbook_formula_report(buf.getvalue())
    assert rep is not None
    assert rep["recomputed_internally"] is True
    assert all(rep["template_match"].values())
    assert rep["formulas"]["ending_oh"] == "=D2+K2-L2"


def test_formula_report_flags_stale_cached_cell():
    """A cached formula result that disagrees with the recomputed value is flagged
    as stale (system uses the recomputed value, not the cache)."""
    from backend.ai.parser import extract_workbook_formula_report

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inventory"
    ws.append(STANDARD_HEADER)
    # Total Pulled cached as 0 though weekly pulls sum to 6 → stale.
    ws.append(["Dairy", "111", "Milk", 5, 4, 2, 3, 2, 3, 2, 10, 0, 15, 1.0])
    buf = io.BytesIO()
    wb.save(buf)
    rep = extract_workbook_formula_report(buf.getvalue())
    assert rep is not None
    assert rep["stale_cached_cells"]["total_pulled"] == 1
    assert rep["stale_cached_cells"]["ending_oh"] == 1


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
def test_may_review_financial_controls_are_preserved():
    from backend.ai.parser import parse_excel

    rows = parse_excel(_MAY_PATH.read_bytes())
    assert round(sum(r.get("opening_value") or 0 for r in rows), 2) == 7828.94
    assert round(sum(r.get("received_value") or 0 for r in rows), 2) == 29718.76
    assert round(sum(r.get("pulled_value") or 0 for r in rows), 2) == 27972.68
    assert round(sum(r.get("ending_value") or 0 for r in rows), 2) == 9575.02


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_june_review_financial_controls_are_preserved():
    from backend.ai.parser import parse_excel

    rows = parse_excel(_JUNE_PATH.read_bytes())
    assert round(sum(r.get("opening_value") or 0 for r in rows), 2) == 9575.02
    assert round(sum(r.get("received_value") or 0 for r in rows), 2) == 30744.57
    assert round(sum(r.get("pulled_value") or 0 for r in rows), 2) == 30814.01
    assert round(sum(r.get("ending_value") or 0 for r in rows), 2) == 9505.58


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_may_weekly_invoice_totals_are_read_from_review_tab():
    from backend.ai.parser import extract_workbook_reconciliation

    recon = extract_workbook_reconciliation(_MAY_PATH.read_bytes())
    assert recon is not None
    totals = recon["weekly_invoice_totals"]
    assert totals["weeks"] == {"1": 21846.93, "2": 5512.92, "3": 2259.87}
    assert totals["total"] == 29619.72
    assert "US Foods Inv #2312098" in totals["notes"]["1"]


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_june_weekly_invoice_totals_are_read_from_review_tab():
    from backend.ai.parser import extract_workbook_reconciliation

    recon = extract_workbook_reconciliation(_JUNE_PATH.read_bytes())
    assert recon is not None
    totals = recon["weekly_invoice_totals"]
    assert totals["weeks"] == {"1": 19735.19, "2": 6647.03, "3": 2097.05}
    assert totals["total"] == 28479.27
    assert "US Foods Inv #578613" in totals["notes"]["1"]


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_june_signed_inventory_flow_values_are_preserved():
    from backend.ai.parser import parse_excel

    rows = parse_excel(_JUNE_PATH.read_bytes())
    signed = {
        r["sku"]: r.get("pulled_value") for r in rows if r.get("pulled_value", 0) < 0
    }
    assert signed == {"3330099": -1.9000000000000057, "6358832": -33.08}


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_june_signed_inventory_flow_values_survive_mapper():
    from backend.ai.mapper import map_rows_to_inventory
    from backend.ai.parser import parse_excel

    rows = parse_excel(_JUNE_PATH.read_bytes())
    payload = map_rows_to_inventory(
        rows,
        {
            "Dairy": 1,
            "Cereal": 2,
            "Beverages": 3,
            "Snacks": 4,
            "Meats": 5,
            "Frozen Food": 6,
            "Dry Goods": 7,
            "Produce": 8,
            "Disposables": 9,
        },
        month=6,
        year=2026,
    )
    assert payload is not None
    signed = {
        item["sku"]: item.get("pulled_value")
        for item in payload["items"]
        if item.get("pulled_value", 0) < 0
    }
    assert signed == {"3330099": -1.9000000000000057, "6358832": -33.08}
    assert (
        round(sum(item.get("pulled_value") or 0 for item in payload["items"]), 2)
        == 30814.01
    )


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_june_review_controls_include_standardized_counts_and_financials():
    from backend.ai.parser import extract_workbook_reconciliation

    recon = extract_workbook_reconciliation(_JUNE_PATH.read_bytes())
    assert recon is not None
    assert recon["reconciled"] is True
    assert recon["grid"]["invoice_skus"] == 277
    assert recon["grid"]["temp_items"] == 14
    assert recon["grid"]["negative_ending_rows"] == 0
    assert recon["review"]["invoice_skus"] == 277
    assert recon["review"]["temp_items"] == 14
    assert recon["review"]["negative_ending_rows"] == 0
    assert recon["financial"]["reconciled"] is True
    assert recon["financial"]["parsed"]["pulled_value"] == 30814.01


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
        (
            i
            for i, r in enumerate(raw_all)
            if any(str(c or "").strip().lower() == "opening oh" for c in r)
        ),
        None,
    )
    assert hdr_idx is not None, "Could not find header row in May workbook"

    raw_data = [r for r in raw_all[hdr_idx + 1 :] if any(v is not None for v in r)]
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


def test_total_pulled_raw_fallback_for_blank_weekly_pulls():
    """Safety net: a non-standard sheet with blank weekly pulls but a verified
    monthly Total Pulled must still carry total_pulled_raw (legacy/edge files)."""
    from backend.ai.parser import parse_excel

    rows = parse_excel(
        _wb_bytes(
            [
                [
                    "Produce",
                    "77002",
                    "Lettuce",
                    60,
                    15,
                    None,
                    10,
                    None,
                    8,
                    None,
                    33,
                    40,
                    27,
                    0.89,
                ]
            ]
        )
    )
    assert rows and rows[0].get("total_pulled_raw") == 40


@pytest.mark.skipif(not _MAY_PATH.exists(), reason="May workbook not present")
def test_standardized_may_uses_per_week_pulls_not_fallback():
    """The standardized May workbook now carries real per-week pulls, so the
    total_pulled_raw fallback should NOT fire (it sums to the verified total)."""
    from backend.ai.parser import parse_excel

    rows = parse_excel(_MAY_PATH.read_bytes())
    assert rows
    assert not [r for r in rows if r.get("total_pulled_raw")]
    assert (
        sum(
            (r.get("w1p") or 0) + (r.get("w2p") or 0) + (r.get("w3p") or 0)
            for r in rows
        )
        == 543
    )


@pytest.mark.skipif(not _JUNE_PATH.exists(), reason="June workbook not present")
def test_real_june_formula_pulls_do_not_create_raw_pulls():
    """Standardized June has real per-week pulls; Total Pulled Raw stays unused."""
    from backend.ai.parser import parse_excel

    rows = parse_excel(_JUNE_PATH.read_bytes())
    assert rows
    assert not [r for r in rows if r.get("total_pulled_raw")]
    assert (
        sum(
            (r.get("w1p") or 0) + (r.get("w2p") or 0) + (r.get("w3p") or 0)
            for r in rows
        )
        == 625
    )


@pytest.mark.skipif(not _TEMPLATE_PATH.exists(), reason="Template workbook not present")
def test_template_inventory_sheet_parses_without_double_counting_notes():
    from backend.ai.parser import parse_excel

    rows = parse_excel(_TEMPLATE_PATH.read_bytes())
    assert len(rows) >= 200
    assert {r.get("__sheet") for r in rows} == {"Inventory"}
