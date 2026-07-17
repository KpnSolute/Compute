from backend.ai.invoice_parser import (
    _normalize_vision_items,
    invoice_items_to_ops,
    parse_invoice_text_pages,
    reconcile_and_adjust,
)


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
    items = [
        {"sku": "A", "qty_shipped": 3, "ext_price": 30, "unit_price": 10},
        {"sku": "B", "qty_shipped": 0, "ext_price": 0, "unit_price": 10},
        {"sku": "C", "qty_shipped": 2, "ext_price": 20, "unit_price": 10},
    ]
    _, matched = reconcile_and_adjust(
        items,
        {
            "product_total": 50,
            "total_items_shipped": 2,
            "total_pieces_delivered": 5,
        },
    )
    _, mismatched = reconcile_and_adjust(
        items,
        {
            "product_total": 50,
            "total_items_shipped": 3,
            "total_pieces_delivered": 6,
        },
    )

    assert matched["item_count"] == 2
    assert matched["piece_count"] == 5
    assert matched["quantity_controls_present"] is True
    assert matched["quantity_reconciled"] is True
    assert mismatched["quantity_reconciled"] is False
