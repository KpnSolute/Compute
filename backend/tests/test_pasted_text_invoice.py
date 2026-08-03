"""Pasted plain-text invoices route through the deterministic invoice pipeline.

A .txt paste (e.g. a Multi-Flow invoice copied from email) must be detected as
`invoice_items` — the same structured shape as a PDF/vision invoice — so it gets
the reconciliation gate, fee separation, and staging flow for free. Validated
against a real Multi-Flow invoice (#898561): 10 product lines, fuel surcharge
FE997 excluded, item total $1,652.70 + $5 fuel = $1,657.70 printed total.
"""

from backend.ai import parser
from backend.ai.invoice_parser import _extract_meta, invoice_items_to_ops

MULTIFLOW_TEXT = """\
  DATE: 07/14/2026
  Multi-Flow Industries
  Invoice# :     898561
  PO#      : 004905
  ----------------------------------------------
   Qty  PQ     Item#      Description
                              Price       Total
  ----------------------------------------------
     1    0 FE997      Fuel Surcharge
                               $5.00      $5.00
     4    0 F00004037  MF Apple Juice 100% 4+1
                              $71.70    $286.80
     4    0 F00072501  MF Fruit Punch Drink 5+1
                              $61.00    $244.00
     2    0 F00186037  MF Orange Sport Drink 3g
                              $36.70     $73.40
     4    0 F00321005  MF Tei Green Tea w/Mango
                              $47.70    $190.80
     1    0 F00416005  MF Harvest Squeeze Pink
                              $43.70     $43.70
     4    0 F00480038  MF Cranberry Fusion 13%
                              $55.70    $222.80
     4    0 F00481038  MF Orange Juice Fusion 5
                              $78.50    $314.00
     2    0 F00523005  MF NourisH2O Strawberry-
                              $36.70     $73.40
     1    0 F00528005  MF nourisH2OBlueberry-Po
                              $36.70     $36.70
     3    0 F00928037  Passionfruit Orange Guav
                              $55.70    $167.10
  ----------------------------------------------
                           Sub Total: $1,657.70
                               Total: $1,657.70
"""


def test_txt_paste_is_detected_as_invoice_items():
    kind, data = parser.detect_and_parse(
        "pasted-invoice.txt", MULTIFLOW_TEXT.encode("utf-8")
    )
    assert kind == "invoice_items"
    assert data["meta"].get("invoice_number") == "898561"
    # Vendor line is indented (as in a real pasted email), not flush to column
    # 0 — the vendor_name regex must tolerate leading whitespace or the
    # backend rejects the whole upload with "Invoice vendor is unknown".
    assert data["meta"].get("vendor_name") == "Multi-Flow Industries"


def test_us_foods_vendor_is_found_in_remit_to_address_row():
    pages = [
        "BILL TO SHIP TO REMIT TO\n"
        "ADAMS & ASSOCIATES MIAMI JOB CORP CAFETERIA US Foods, Inc.\n"
        "6151 LAKESIDE DR 3050 NW 183RD ST P.O. BOX 281838"
    ]

    meta = _extract_meta(pages)

    assert meta["vendor_name"] == "US Foods"


def test_txt_paste_extracts_all_lines_and_skips_fuel_surcharge():
    _, data = parser.detect_and_parse(
        "pasted-invoice.txt", MULTIFLOW_TEXT.encode("utf-8")
    )
    items = data["items"]
    skus = {i.get("sku") for i in items}
    assert len(items) == 10  # fuel surcharge FE997 excluded
    assert "FE997" not in skus
    assert "F00072501" in skus
    by_sku = {i["sku"]: i for i in items}
    assert int(by_sku["F00004037"]["qty_shipped"]) == 4
    assert float(by_sku["F00072501"]["unit_price"]) == 61.0
    # Product lines total (fuel kept separate) reconciles to the printed math.
    line_total = sum(float(i.get("ext_price") or 0) for i in items)
    assert abs(line_total - 1652.70) < 0.01


def test_txt_paste_keeps_product_value_separate_from_invoice_extras():
    _, data = parser.detect_and_parse(
        "pasted-invoice.txt", MULTIFLOW_TEXT.encode("utf-8")
    )

    recon = data["meta"]["reconciliation"]
    assert recon["product_cost"] == 1652.70
    assert recon["fuel_surcharge"] == 5.00
    assert recon["tax"] == 0.00
    assert recon["net_total"] == 1657.70

    # Inventory receives product lines only; the surcharge remains an
    # invoice/cost-manager extra and must never become a received item value.
    ops = invoice_items_to_ops(data["items"], data["meta"], 7, 2026, 2, "received", {})
    staged_product_value = sum(
        (op["payload"]["items"][0]["price"] or 0) * op["payload"]["items"][0]["qty"]
        for op in ops
    )
    assert staged_product_value == 1652.70


def test_non_invoice_txt_falls_back_to_text():
    kind, data = parser.detect_and_parse(
        "notes.txt", b"just some random notes, not an invoice at all"
    )
    assert kind == "text"
    assert isinstance(data, str)
