"""Phase 4: the reported comparison must be the comparison actually made.

The line-item reconciliation check has always measured the parsed line-item sum
against the invoice's GOODS total — correct, because `net_total` is the payable
amount (goods minus GPO discount plus fuel and tax) and comparing line items to
it manufactures a variance equal to those adjustments. But the failure message
named `net_total` as the yardstick, which is how the 2026-07-18 audit ended up
reporting a "$101.09 unexplained variance" that was neither unexplained nor a
variance. These tests pin the reference and its label.
"""

from backend.ai.invoice_parser import reconcile_and_adjust


def _items(*ext_prices):
    return [
        {"ext_price": p, "unit_price": p, "qty_shipped": 1, "sku": f"S{i}"}
        for i, p in enumerate(ext_prices)
    ]


def test_reference_is_the_product_total_not_the_payable_net():
    meta = {
        "product_total": "9445.32",
        "net_total": "9344.23",  # goods - vizient 106.09 + fuel 5.00
        "vizient_discount": "106.09",
        "fuel_surcharge": "5.00",
    }
    _adjusted, stats = reconcile_and_adjust(_items(9445.32), meta)

    assert stats["reference_total"] == 9445.32
    assert stats["reference_label"] == "invoice product total"
    assert stats["net_total"] == 9344.23
    # The 101.09 gap is fully explained by the discount and fuel line — it is
    # NOT a line-item drift, so the check passes.
    assert stats["delta"] == 0.0
    assert stats["reconciled"] is True


def test_merchandise_subtotal_is_the_fallback_reference():
    meta = {"subtotal": "500.00", "net_total": "530.00", "tax": "30.00"}
    _adjusted, stats = reconcile_and_adjust(_items(300.0, 200.0), meta)

    assert stats["reference_total"] == 500.00
    assert stats["reference_label"] == "invoice merchandise subtotal"
    assert stats["reconciled"] is True


def test_missing_goods_control_is_reported_not_silently_passed():
    """With no goods total on the document there is nothing to check against.

    The old code compared the line-item sum to itself and always declared
    success. Now the absence is flagged so the UI can say so.
    """
    meta = {"net_total": "418.00"}
    _adjusted, stats = reconcile_and_adjust(_items(100.0, 300.0), meta)

    assert stats["goods_control_present"] is False
    assert stats["reference_label"] == "none (no goods total on invoice)"


def test_real_line_item_drift_is_still_caught():
    meta = {"product_total": "1000.00", "net_total": "1000.00"}
    _adjusted, stats = reconcile_and_adjust(_items(100.0, 100.0), meta)

    assert stats["reference_total"] == 1000.00
    assert stats["delta"] == 800.00
    assert stats["delta_pct"] == 80.0
    assert stats["reconciled"] is False


def test_payable_components_stay_separate_from_product_cost():
    meta = {
        "product_total": "1000.00",
        "vizient_discount": "50.00",
        "fuel_surcharge": "10.00",
        "tax": "7.00",
        "net_total": "967.00",
    }
    _adjusted, stats = reconcile_and_adjust(_items(1000.0), meta)

    assert stats["product_total"] == 1000.00
    assert stats["vizient_discount"] == 50.00
    assert stats["fuel_surcharge"] == 10.00
    assert stats["tax"] == 7.00
    assert stats["net_total"] == 967.00
    # Identity holds: goods - discount + fuel + tax = payable.
    assert round(1000.00 - 50.00 + 10.00 + 7.00, 2) == stats["net_total"]
