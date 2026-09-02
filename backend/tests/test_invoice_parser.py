from backend.ai.invoice_parser import (
    _normalize_vision_items,
    extract_invoice_vision,
    invoice_items_to_ops,
    parse_invoice_text_pages,
    reconcile_and_adjust,
)


def test_usfoods_augwk2_substitution_row_uses_extended_price_quantity():
    # Exact native-text shape from tmp/Augwk2.pdf page 2.  The nested CS weight
    # lines are deliberately included to prove they remain annotations on the
    # catch-weight product rather than phantom invoice items.
    page = """INVOICE
Page 2 of 5
ACCOUNT NUMBER INVOICE NUMBER INVOICE DATE CUSTOMER NUMBER PURCHASE ORDER # SALES LOCATION SALES REP DATE ORDERED
41736679 490241 08/17/2026 1273721 6081 3135 492 08/13/2026
FREIGHT TERMS ORDER NUMBER PAYMENT TERMS ROUTE NUMBER SPECIAL INSTRUCTIONS
565613 NET 30 DAYS 1133
INVOICE LINE DETAILS
QUANTITY SALES PRODUCT DESCRIPTION LABEL PACK SIZE CODE WEIGHT PRICING UNIT EXTENDED
ORD SHP ADJ UNIT NUMBER UNIT PRICE PRICE
REFRIGERATED
6 6 0 CS 2723641 CHICKEN, 8 PC 14 HD 3-3.25 LB PATUXENT 14/3-3.25#A 303.76 LB $1.6700 $507.28
CS: 1 51.80 lbs
CS: 2 51.80 lbs
CS: 3 51.69 lbs
CS: 4 48.79 lbs
CS: 5 50.29 lbs
CS: 6 49.39 lbs
1 1 0 CS 7416663 PORK, LOIN CC BNLS .25" TRIMD PATUXENT 6/10.5 LBA 67.23 LB $1.6400 $110.26
CS: 1 67.23 lbs
2 1 0 CS 9333014 TOMATO, 6X6 #1 GRD RND GAS CROSS VALY 16 LB CS $29.4100 $29.41
*SUB* 2 0 CS 5690441 TOMATO, 5X6 RND VINE RIPE PACKER 25 LB CS $30.2500 $60.50
3 3 0 CS 7992498 PORK, BSTN BUTT BNLS RAW F2F HORMEL 5/2/7 LBA 227.90 LB $1.9700 $448.96
CS: 1 72.50 lbs
CS: 2 77.40 lbs
CS: 3 78.00 lbs
Page 2 of 5
"""

    parsed = parse_invoice_text_pages([page], "Augwk2-substitution.txt")
    items = parsed["items"]
    by_sku = {item["sku"]: item for item in items}

    assert by_sku["5690441"]["qty_shipped"] == 2
    assert by_sku["5690441"]["qty_ordered"] == 2
    assert by_sku["5690441"]["ext_price"] == 60.50
    assert by_sku["5690441"]["unit_price"] == 30.25
    assert by_sku["9333014"]["qty_shipped"] == 1
    assert len([item for item in items if item["sku"] == "2723641"]) == 1
    assert len([item for item in items if item["sku"] == "7416663"]) == 1
    assert len([item for item in items if item["sku"] == "7992498"]) == 1
    assert len(items) == 5


def test_usfoods_hazard_summary_repeat_does_not_double_count_item():
    page = """INVOICE
Page 11 of 13
ACCOUNT NUMBER INVOICE NUMBER INVOICE DATE CUSTOMER NUMBER PURCHASE ORDER # SALES LOCATION SALES REP DATE ORDERED
41736679 1736605 07/01/2026 1273721 4520 3135 492 06/28/2026
FREIGHT TERMS ORDER NUMBER PAYMENT TERMS ROUTE NUMBER SPECIAL INSTRUCTIONS
482273 NET 30 DAYS 3319
INVOICE LINE DETAILS
QUANTITY SALES PRODUCT DESCRIPTION LABEL PACK SIZE CODE WEIGHT PRICING UNIT EXTENDED
ORD SHP ADJ UNIT NUMBER UNIT PRICE PRICE
DRY
1 1 0 CS 5771977 OIL, PAN COTG CNOLA BASED MONARCH 6/17 OZ CS $29.0400 $29.04
HAZARD MATERIALS SUMMARY
QUANTITY SALES PRODUCT DESCRIPTION LABEL PACK SIZE CODE WEIGHT PRICING UNIT EXTENDED
ORD SHP ADJ UNIT NUMBER UNIT PRICE PRICE
DRY
1 1 0 CS 5771977 OIL, PAN COTG CNOLA BASED MONARCH 6/17 OZ CS $29.0400 $29.04
451-AEROSOL
HAZARDOUS ITEM TOTALS: WEIGHT: 6.40 PIECES: 1 CUBE: 0
PRODUCT TOTAL $29.04
"""

    parsed = parse_invoice_text_pages([page], "usfoods.txt")

    assert parsed["meta"]["invoice_number"] == "1736605"
    assert parsed["meta"]["invoice_date"] == "07/01/2026"
    assert parsed["meta"]["account_number"] == "41736679"
    assert parsed["meta"]["po_number"] == "4520"
    assert parsed["meta"]["route"] == "3319"

    items = parsed["items"]
    assert len(items) == 1
    assert items[0]["sku"] == "5771977"
    assert items[0]["qty_shipped"] == 1
    assert items[0]["ext_price"] == 29.04

    ops = invoice_items_to_ops(items, parsed["meta"], 7, 2026, 1, "received", {})
    assert len(ops) == 1
    assert ops[0]["operation"] == "inventory_week_update"
    assert ops[0]["payload"]["month"] == 7
    assert ops[0]["payload"]["year"] == 2026
    assert ops[0]["payload"]["week"] == 1
    assert ops[0]["payload"]["direction"] == "received"
    assert ops[0]["payload"]["items"][0]["qty"] == 1


def test_usfoods_receivable_value_is_product_items_not_tax_or_net_total():
    page = """INVOICE
ACCOUNT NUMBER INVOICE NUMBER INVOICE DATE CUSTOMER NUMBER PURCHASE ORDER # SALES LOCATION SALES REP DATE ORDERED
41736679 1736605 07/01/2026 1273721 4520 3135 492 06/28/2026
FREIGHT TERMS ORDER NUMBER PAYMENT TERMS ROUTE NUMBER SPECIAL INSTRUCTIONS
482273 NET 30 DAYS 3319
INVOICE LINE DETAILS
QUANTITY SALES PRODUCT DESCRIPTION LABEL PACK SIZE CODE WEIGHT PRICING UNIT EXTENDED
ORD SHP ADJ UNIT NUMBER UNIT PRICE PRICE
DRY
2 2 0 CS 1234567 BEAN, BLK CND MONARCH 6/#10 CS $50.0000 $100.00
PRODUCT TOTAL $100.00
FUEL SURCHARGE $5.00
SALES TAX $7.00
NET TOTAL $112.00
TOTAL ITEMS SHIPPED 1
TOTAL PIECES DELIVERED 2
"""

    parsed = parse_invoice_text_pages([page], "usfoods-tax.txt")
    items = parsed["items"]
    recon = parsed["meta"]["reconciliation"]

    assert len(items) == 1
    assert sum(item["ext_price"] for item in items) == 100.00
    assert recon["product_total"] == 100.00
    assert recon["product_cost"] == 100.00
    assert recon["fuel_surcharge"] == 5.00
    assert recon["tax"] == 7.00
    assert recon["net_total"] == 112.00
    assert recon["stated_item_count"] == 1
    assert recon["stated_piece_count"] == 2
    assert recon["quantity_reconciled"] is True

    ops = invoice_items_to_ops(items, parsed["meta"], 7, 2026, 1, "received", {})
    staged_value = sum(
        (op["payload"]["items"][0]["price"] or 0) * op["payload"]["items"][0]["qty"]
        for op in ops
    )
    assert staged_value == 100.00


def test_zero_financial_fields_are_explicitly_preserved_on_reconcile():
    _, meta = reconcile_and_adjust(
        [{"ext_price": 100.00, "unit_price": 100.00, "qty_shipped": 1}],
        {
            "product_total": 100.00,
            "vizient_discount": 0,
            "fuel_surcharge": 0,
            "tax": 0,
            "net_total": 100.00,
        },
    )

    assert meta["vizient_discount"] == 0.0
    assert meta["fuel_surcharge"] == 0.0
    assert meta["tax"] == 0.0


def test_vision_zero_shipped_stays_zero_and_is_not_staged():
    items = _normalize_vision_items(
        [
            {
                "sku": "NOT-SHIPPED",
                "description": "Ordered but unavailable",
                "qty_ordered": 5,
                "qty_shipped": 0,
                "unit_price": 10,
                "ext_price": 0,
            },
            {
                "sku": "DELIVERED",
                "description": "Delivered item",
                "qty_ordered": 2,
                "qty_shipped": 2,
                "unit_price": 10,
                "ext_price": 20,
            },
        ]
    )

    assert items[0]["qty_shipped"] == 0
    assert items[0]["ext_price"] == 0
    ops = invoice_items_to_ops(items, {}, 7, 2026, 2, "received", {})
    assert [op["payload"]["items"][0]["sku"] for op in ops] == ["DELIVERED"]


def test_missing_vendor_sku_uses_temp_placeholder_for_new_item_review():
    ops = invoice_items_to_ops(
        [
            {
                "sku": "",
                "description": "CHICKEN PATTY BREADED",
                "qty_shipped": 2,
                "unit_price": 18.50,
                "ext_price": 37.00,
            }
        ],
        {},
        7,
        2026,
        2,
        "received",
        {},
    )

    item = ops[0]["payload"]["items"][0]
    assert item["sku"] == "TEMP_000"
    assert item["desc"] == "CHICKEN PATTY BREADED"
    assert ops[0]["payload"]["review_new"] is True


def test_usfoods_delivery_recap_controls_items_and_pieces():
    # A real US Foods DELIVERY SUMMARY TOTALS row's "TOTAL ITEMS SHIPPED"
    # counts every printed line — including a $0.00/qty_shipped=0 backorder
    # line (confirmed against a live 195-line invoice with exactly one such
    # line: the recap said 195, matching the full printed line count, not
    # the 194 lines with quantity > 0). item_count must therefore count ALL
    # parsed lines; piece_count sums actual shipped quantity (0 contributes
    # nothing either way, so item B here still nets to 5 pieces).
    items = [
        {"sku": "A", "qty_shipped": 3, "ext_price": 30, "unit_price": 10},
        {"sku": "B", "qty_shipped": 0, "ext_price": 0, "unit_price": 10},
        {"sku": "C", "qty_shipped": 2, "ext_price": 20, "unit_price": 10},
    ]
    _, matched = reconcile_and_adjust(
        items,
        {
            "product_total": 50,
            "total_items_shipped": 3,
            "total_pieces_delivered": 5,
        },
    )
    _, mismatched = reconcile_and_adjust(
        items,
        {
            "product_total": 50,
            "total_items_shipped": 4,
            "total_pieces_delivered": 6,
        },
    )

    assert matched["item_count"] == 3
    assert matched["piece_count"] == 5
    assert matched["quantity_controls_present"] is True
    assert matched["quantity_reconciled"] is True
    assert mismatched["quantity_reconciled"] is False


def test_usfoods_september_recap_excludes_zero_shipped_backorders():
    items = [
        {"sku": f"S{i}", "qty_shipped": 2, "ext_price": 10, "unit_price": 5}
        for i in range(151)
    ]
    items.extend(
        [
            {"sku": "5177738", "qty_shipped": 0, "ext_price": 0, "unit_price": 0},
            {"sku": "2723278", "qty_shipped": 0, "ext_price": 0, "unit_price": 0},
        ]
    )
    _, stats = reconcile_and_adjust(
        items,
        {
            "product_total": 1510,
            "total_items_shipped": 151,
            "total_pieces_delivered": 302,
        },
    )

    assert stats["item_count"] == 151
    assert stats["piece_count"] == 302
    assert stats["quantity_reconciled"] is True


def test_vision_normalization_repairs_substitution_and_zero_price_quantities():
    normalized = _normalize_vision_items(
        [
            {
                "sku": "SUB-ITEM",
                "unit": "CS",
                "qty_shipped": 0,
                "unit_price": 30.25,
                "ext_price": 60.50,
            },
            {
                "sku": "BACKORDER",
                "unit": "CS",
                "qty_shipped": 1,
                "unit_price": 0,
                "ext_price": 0,
            },
            {
                "sku": "CATCH-WEIGHT",
                "unit": "LB",
                "qty_shipped": 10,
                "unit_price": 1.67,
                "ext_price": 844.55,
            },
        ]
    )

    assert normalized[0]["qty_shipped"] == 2
    assert normalized[1]["qty_shipped"] == 0
    assert normalized[2]["qty_shipped"] == 10


def test_vision_split_recap_and_summary_pages_keep_product_total(monkeypatch):
    def fake_page(_image, _cfg, *, page_num, called_by):
        if page_num <= 8:
            return {
                "items": [
                    {
                        "sku": f"S{page_num}",
                        "qty_shipped": 1,
                        "unit": "CS",
                        "unit_price": 10,
                        "ext_price": 10,
                    }
                ]
            }
        if page_num == 9:
            return {
                "items": [],
                "is_recap_page": True,
                "product_total": 17787.09,
                "total_items_shipped": 151,
                "total_pieces_delivered": 382,
                "product_total_source": "none",
            }
        return {
            "items": [],
            "is_recap_page": False,
            "product_total": 18039.65,
            "product_total_source": "invoice_summary",
        }

    monkeypatch.setattr("backend.ai.invoice_parser._extract_vision_page", fake_page)
    monkeypatch.setattr(
        "backend.ai.invoice_parser._extract_recap_totals", lambda *args, **kwargs: None
    )

    parsed = extract_invoice_vision([b"page"] * 10, {}, {}, called_by="test")

    assert float(parsed["meta"]["product_total"]) == 18039.65
    assert parsed["meta"]["total_items_shipped"] == 151
    assert parsed["meta"]["total_pieces_delivered"] == 382


def test_vision_does_not_drop_pages_after_two_empty_results(monkeypatch):
    def fake_page(_image, _cfg, *, page_num, called_by):
        if page_num in (2, 3):
            return {"items": []}
        if page_num == 5:
            return {
                "items": [],
                "is_recap_page": True,
                "total_items_shipped": 2,
                "total_pieces_delivered": 2,
            }
        return {
            "items": [
                {
                    "sku": f"S{page_num}",
                    "qty_shipped": 1,
                    "unit": "CS",
                    "unit_price": 10,
                    "ext_price": 10,
                }
            ]
        }

    monkeypatch.setattr("backend.ai.invoice_parser._extract_vision_page", fake_page)
    monkeypatch.setattr(
        "backend.ai.invoice_parser._extract_recap_totals", lambda *args, **kwargs: None
    )

    parsed = extract_invoice_vision([b"page"] * 5, {}, {}, called_by="test")

    assert [item["sku"] for item in parsed["items"]] == ["S1", "S4"]
    assert parsed["meta"]["total_items_shipped"] == 2
    assert parsed["meta"]["total_pieces_delivered"] == 2


def test_vision_page_trace_distinguishes_items_empty_and_failed_pages(monkeypatch):
    def fake_page(_image, _cfg, *, page_num, called_by):
        if page_num == 2:
            return {"items": []}
        if page_num == 3:
            raise RuntimeError("provider timeout")
        return {
            "items": [
                {
                    "sku": "S1",
                    "qty_shipped": 2,
                    "unit": "CS",
                    "unit_price": 10,
                    "ext_price": 20,
                }
            ]
        }

    monkeypatch.setattr("backend.ai.invoice_parser._extract_vision_page", fake_page)
    monkeypatch.setattr(
        "backend.ai.invoice_parser._extract_recap_totals", lambda *args, **kwargs: None
    )

    parsed = extract_invoice_vision([b"page"] * 3, {}, {}, called_by="test")

    assert parsed["pages_failed"] == 1
    assert parsed["page_trace"] == [
        {
            "page": 1,
            "status": "items",
            "is_recap_page": False,
            "raw_item_count": 1,
            "raw_piece_count": 2,
            "normalized_item_count": 1,
            "normalized_piece_count": 2,
        },
        {
            "page": 2,
            "status": "empty",
            "is_recap_page": False,
            "raw_item_count": 0,
            "raw_piece_count": 0,
        },
        {
            "page": 3,
            "status": "failed",
            "error_type": "RuntimeError",
            "raw_item_count": 0,
            "raw_piece_count": 0,
        },
    ]


def test_usfoods_delivery_summary_totals_split_across_page_boundary():
    # Regression for a live 422 (invoice_quantity_controls_missing) on a real
    # 13-page US Foods invoice: the STORAGE LOCATION RECAP table's per-location
    # rows print on one page while its "DELIVERY SUMMARY TOTALS" grand-total
    # row prints on the NEXT page (own header block repeated first), and
    # pdfplumber wraps the table's 3-word column headers ("TOTAL ITEMS
    # SHIPPED", "TOTAL PIECES DELIVERED") across two lines — so those labels
    # never appear as one contiguous phrase anywhere in the extracted text.
    # The recap numbers must still be recovered from the grand-total data row.
    page_11 = """INVOICE
Page 11 of 13
STORAGE LOCATION RECAP(N)
STORAGE LOCATION TOTAL PIECES TOTAL PIECES TOTAL PIECES TOTAL PIECES TOTAL ITEMS TOTAL WEIGHT TOTAL EXTENDED
ORDERED SHIPPED ADJUSTED DELIVERED SHIPPED SHIPPED PRICE
DRY 218 217 2 215 98 4,049.03 $8,269.19
REFRIGERATED 94 91 0 91 33 2,816.28 $6,416.46
FROZEN 151 151 0 151 64 2,421.55 $7,824.92
Page 11 of 13
"""
    page_12 = """INVOICE
Page 12 of 13
DELIVERY SUMMARY TOTALS 463 459 2 457 195 9,286.86 $22,510.57
INVOICE SUMMARY
Product Total $22,510.57
VIZIENT-.65% AVG DROP INCENTIV -$146.32 CR
VIZIENT-.75% VOLUME INCENTIVE -$168.83 CR
FUEL SURCHARGE $3.00
Page 12 of 13
"""

    parsed = parse_invoice_text_pages([page_11, page_12], "split-recap.txt")
    recon = parsed["meta"]["reconciliation"]

    assert recon["stated_item_count"] == 195
    assert recon["stated_piece_count"] == 457
    assert recon["product_total"] == 22510.57
    assert recon["quantity_controls_present"] is True
