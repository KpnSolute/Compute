from backend.calculators import (
    category_breakdown,
    dashboard_summary,
    ending_quantity,
    grand_total,
    item_total,
    reorder_alerts,
    rollover,
    week_value,
)


def test_item_total(sample_item):
    on_hand = 50
    received = 10 + 0 + 5 + 0
    issued = 20 + 15 + 10 + 5
    expected = round(max(0, on_hand + received - issued) * 3.50, 2)
    assert item_total(sample_item) == expected


def test_item_total_zero_on_hand():
    item = {'on_hand': '0', 'w1_received': '0', 'w1_issued': '0',
            'w2_received': '0', 'w2_issued': '0',
            'w3_received': '0', 'w3_issued': '0',
            'w4_received': '0', 'w4_issued': '0', 'unit_price': '5.00'}
    assert item_total(item) == 0.0


def test_ending_quantity(sample_item):
    result = ending_quantity(sample_item)
    assert result == 15.0


def test_ending_quantity_never_negative():
    item = {'on_hand': '5', 'w1_received': '0', 'w1_issued': '20',
            'w2_received': '0', 'w2_issued': '0',
            'w3_received': '0', 'w3_issued': '0',
            'w4_received': '0', 'w4_issued': '0', 'unit_price': '1'}
    assert ending_quantity(item) == 0.0


def test_week_value(sample_items):
    assert week_value(sample_items, 1) == round(10 * 3.50 + 20 * 2.25, 2)
    assert week_value(sample_items, 2) == 0.0
    assert week_value(sample_items, 3) == round(5 * 3.50, 2)


def test_grand_total(sample_items):
    t1 = item_total(sample_items[0])
    t2 = item_total(sample_items[1])
    assert grand_total(sample_items) == round(t1 + t2, 2)


def test_category_breakdown(sample_items):
    cats = category_breakdown(sample_items)
    assert 'Dairy' in cats
    assert 'Dry Goods' in cats
    assert cats['Dairy']['count'] == 1
    assert cats['Dry Goods']['count'] == 1


def test_reorder_alerts(sample_items):
    alerts = reorder_alerts(sample_items)
    ids = [a['item_id'] for a in alerts]
    assert '456' in ids  # on_hand=10 < par_level=30
    assert '123' not in ids  # on_hand=50 >= par_level=40


def test_reorder_alerts_ignores_zero_par():
    items = [{'on_hand': '0', 'par_level': '0', 'item_id': '789',
              'description': '', 'category': '', 'unit_price': '0'}]
    assert reorder_alerts(items) == []


def test_dashboard_summary(sample_items):
    summary = dashboard_summary(sample_items, prior_month_total=1000.0)
    assert summary['starting_total'] == 1000.0
    assert summary['total_items'] == 2
    assert summary['reorder_count'] == 1
    assert 'category_breakdown' in summary
    assert 'reorder_alerts' in summary


def test_rollover(sample_items):
    rolled = rollover(sample_items)
    for r in rolled:
        assert r['w1_received'] == 0
        assert r['w2_issued'] == 0
        assert r['w3_received'] == 0
        assert r['w4_issued'] == 0


def test_rollover_preserves_ending_qty(sample_items):
    rolled = rollover(sample_items)
    assert rolled[0]['on_hand'] == ending_quantity(sample_items[0])
