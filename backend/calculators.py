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
            }
        cats[cat]['total'] = round(cats[cat]['total'] + item_total(i), 2)
        cats[cat]['count'] += 1
        cats[cat]['received'] += sum(float(i.get(f'w{w}_received') or 0) for w in range(1, 5))
        cats[cat]['issued'] += sum(float(i.get(f'w{w}_issued') or 0) for w in range(1, 5))
    return cats


def reorder_alerts(items: list) -> list:
    return [
        {
            'item_id': i.get('item_id'),
            'description': i.get('description'),
            'category': i.get('category'),
            'on_hand': i.get('on_hand', 0),
            'par_level': i.get('par_level', 0),
            'unit_price': i.get('unit_price', 0),
        }
        for i in items
        if float(i.get('on_hand') or 0) < float(i.get('par_level') or 0) and float(i.get('par_level') or 0) > 0
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
