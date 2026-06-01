from backend.calculators import calc_item_totals, calc_summary


def test_calc_item_totals(sample_item):
    totals = calc_item_totals(sample_item)
    assert 'grand_total' in totals
    assert 'total_received' in totals
    assert 'total_issued' in totals
    assert totals['total_received'] == 15.0  # 10+0+5+0
    assert totals['total_issued'] == 50.0    # 20+15+10+5


def test_calc_summary_reorder_alert(sample_items):
    # sample_item has on_hand=50, par_level=40 — no alert
    # item2 has on_hand=10, par_level=30 — alert
    result = calc_summary(sample_items)
    assert result['item_count'] == 2
    assert isinstance(result['grand_total'], float)
    assert result['reorder_count'] == 1
    assert result['reorder_alerts'][0]['sku'] == 'BREAD-001'


def test_calc_summary_empty():
    result = calc_summary([])
    assert result['grand_total'] == 0.0
    assert result['item_count'] == 0
    assert result['reorder_count'] == 0
