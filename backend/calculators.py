def item_total(item: dict) -> float:
    on_hand = float(item.get('on_hand') or 0)
    received = sum(float(item.get(f'w{w}_received') or 0) for w in range(1, 5))
    issued = sum(float(item.get(f'w{w}_issued') or 0) for w in range(1, 5))
    price = float(item.get('unit_price') or 0)
    return round(max(0, on_hand + received - issued) * price, 2)


def ending_quantity(item: dict) -> float:
    on_hand = float(item.get('on_hand') or 0)
    received = sum(float(item.get(f'w{w}_received') or 0) for w in range(1, 5))
    issued = sum(float(item.get(f'w{w}_issued') or 0) for w in range(1, 5))
    return max(0.0, on_hand + received - issued)


def week_value(items: list, week: int) -> float:
    return round(sum(float(i.get(f'w{week}_received') or 0) * float(i.get('unit_price') or 0) for i in items), 2)


def grand_total(items: list) -> float:
    return round(sum(item_total(i) for i in items), 2)


def _total_issued(item: dict) -> float:
    return sum(float(item.get(f'w{w}_issued') or 0) for w in range(1, 5))


def _total_received(item: dict) -> float:
    return sum(float(item.get(f'w{w}_received') or 0) for w in range(1, 5))


def _active_weeks(item: dict) -> int:
    return sum(
        1 for w in range(1, 5)
        if float(item.get(f'w{w}_issued') or 0) > 0 or float(item.get(f'w{w}_received') or 0) > 0
    )


def issued_rate(item: dict) -> float:
    """Average weekly units consumed, averaged over weeks with any activity."""
    weeks = _active_weeks(item)
    if weeks == 0:
        return 0.0
    return round(_total_issued(item) / weeks, 3)


def received_rate(item: dict) -> float:
    """Average weekly units received, averaged over weeks with any activity."""
    weeks = _active_weeks(item)
    if weeks == 0:
        return 0.0
    return round(_total_received(item) / weeks, 3)


def weeks_of_supply(item: dict) -> float | None:
    """Weeks of stock remaining at current consumption rate. None if no demand data."""
    rate = issued_rate(item)
    if rate == 0:
        return None
    return round(ending_quantity(item) / rate, 1)


def consumption_cost(item: dict) -> float:
    """Dollar value of units consumed (issued) this month."""
    return round(_total_issued(item) * float(item.get('unit_price') or 0), 2)


def receive_cost(item: dict) -> float:
    """Dollar value of units received this month."""
    return round(_total_received(item) * float(item.get('unit_price') or 0), 2)


def suggested_par(item: dict, safety_weeks: float = 2.0) -> int:
    """Adaptive par level: issued_rate × safety buffer in weeks."""
    return max(0, round(issued_rate(item) * safety_weeks))


def item_metrics(item: dict) -> dict:
    """Full row-level metric set for one item."""
    return {
        'ending_qty': ending_quantity(item),
        'item_total': item_total(item),
        'total_issued': round(_total_issued(item), 3),
        'total_received': round(_total_received(item), 3),
        'issued_rate': issued_rate(item),
        'received_rate': received_rate(item),
        'weeks_of_supply': weeks_of_supply(item),
        'consumption_cost': consumption_cost(item),
        'receive_cost': receive_cost(item),
        'suggested_par': suggested_par(item),
        'unit_price': float(item.get('unit_price') or 0),
        'par_level': float(item.get('par_level') or 0),
        'on_hand': float(item.get('on_hand') or 0),
    }


def category_breakdown(items: list) -> dict:
    cats = {}
    for i in items:
        cat = i.get('category', 'Unknown')
        if cat not in cats:
            cats[cat] = {
                'total': 0.0,
                'count': 0,
                'color': i.get('category_color', '#888888'),
                'received': 0.0,
                'issued': 0.0,
                'consumption_cost': 0.0,
                'receive_cost': 0.0,
            }
        cats[cat]['total'] = round(cats[cat]['total'] + item_total(i), 2)
        cats[cat]['count'] += 1
        cats[cat]['received'] += _total_received(i)
        cats[cat]['issued'] += _total_issued(i)
        cats[cat]['consumption_cost'] = round(cats[cat]['consumption_cost'] + consumption_cost(i), 2)
        cats[cat]['receive_cost'] = round(cats[cat]['receive_cost'] + receive_cost(i), 2)
    return cats


def reorder_alerts(items: list) -> list:
    return [
        {
            'item_id': i.get('item_id'),
            'description': i.get('description'),
            'category': i.get('category'),
            'ending_qty': ending_quantity(i),
            'par_level': i.get('par_level', 0),
            'weeks_of_supply': weeks_of_supply(i),
            'unit_price': i.get('unit_price', 0),
        }
        for i in items
        if ending_quantity(i) < float(i.get('par_level') or 0) and float(i.get('par_level') or 0) > 0
    ]


def dashboard_summary(items: list, prior_month_total: float = 0.0) -> dict:
    return {
        'grand_total': grand_total(items),
        'starting_total': round(prior_month_total, 2),
        'wk1_total': week_value(items, 1),
        'wk2_total': week_value(items, 2),
        'wk3_total': week_value(items, 3),
        'wk4_total': week_value(items, 4),
        'total_items': len(items),
        'total_consumption_cost': round(sum(consumption_cost(i) for i in items), 2),
        'total_receive_cost': round(sum(receive_cost(i) for i in items), 2),
        'reorder_count': len(reorder_alerts(items)),
        'category_breakdown': category_breakdown(items),
        'reorder_alerts': reorder_alerts(items),
    }


def rollover(items: list) -> list:
    rolled = []
    for i in items:
        new = dict(i)
        new['on_hand'] = ending_quantity(i)
        for w in range(1, 5):
            new[f'w{w}_received'] = 0
            new[f'w{w}_issued'] = 0
        rolled.append(new)
    return rolled


def adaptive_screening(
    current_items: list,
    prior_items: list,
    demand_threshold_pct: float = 25.0,
    low_supply_weeks: float = 2.0,
) -> dict:
    """
    Adaptive Screening report for Adaptive Screening system.
    Compares current month against prior month and flags items needing attention.

    Triggers:
    - below_par: ending_qty < par_level (fixed — was comparing on_hand)
    - demand_spike: issued_rate rose > demand_threshold_pct vs prior month
    - demand_drop: issued_rate fell > demand_threshold_pct vs prior month
    - price_change: unit_price changed from prior month
    - low_supply: weeks_of_supply < low_supply_weeks
    """
    prior_map = {i.get('item_id'): i for i in prior_items}

    flags = []
    counts = {'below_par': 0, 'demand_changes': 0, 'price_changes': 0, 'low_supply': 0}

    for item in current_items:
        item_id = item.get('item_id')
        cur = item_metrics(item)
        prior = prior_map.get(item_id)
        pri = item_metrics(prior) if prior else None

        reasons = []
        deltas = {}

        if cur['par_level'] > 0 and cur['ending_qty'] < cur['par_level']:
            reasons.append('below_par')
            counts['below_par'] += 1

        if pri and pri['issued_rate'] > 0:
            pct = ((cur['issued_rate'] - pri['issued_rate']) / pri['issued_rate']) * 100
            deltas['demand_change_pct'] = round(pct, 1)
            if abs(pct) > demand_threshold_pct:
                reasons.append('demand_spike' if pct > 0 else 'demand_drop')
                counts['demand_changes'] += 1

        if pri:
            price_delta = cur['unit_price'] - pri['unit_price']
            if abs(price_delta) > 0.001:
                deltas['price_change'] = round(price_delta, 4)
                if pri['unit_price'] > 0:
                    deltas['price_change_pct'] = round((price_delta / pri['unit_price']) * 100, 2)
                reasons.append('price_change')
                counts['price_changes'] += 1

        wos = cur['weeks_of_supply']
        if wos is not None and wos < low_supply_weeks:
            reasons.append('low_supply')
            counts['low_supply'] += 1

        if reasons:
            flags.append({
                'item_id': item_id,
                'barcode': item.get('barcode_id') or item.get('barcode'),
                'description': item.get('description'),
                'category': item.get('category'),
                'reasons': reasons,
                'current': cur,
                'prior': pri,
                'deltas': deltas,
            })

    flags.sort(key=lambda x: len(x['reasons']), reverse=True)

    return {
        'summary': {
            'total_items': len(current_items),
            'flagged_items': len(flags),
            **counts,
        },
        'flags': flags,
    }
