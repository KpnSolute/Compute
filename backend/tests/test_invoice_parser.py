from backend.ai.invoice_parser import invoice_items_to_ops, parse_invoice_text_pages


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
