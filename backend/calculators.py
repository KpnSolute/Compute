from decimal import Decimal, ROUND_HALF_UP


def calc_item_totals(item: dict) -> dict:
    """Calculate weekly totals and grand total for a single item."""
    unit_price = Decimal(str(item.get('unit_price') or 0))

    totals = {}
    grand_total_units = Decimal('0')

    for week in range(1, 5):
        received = Decimal(str(item.get(f'w{week}_received') or 0))
        issued = Decimal(str(item.get(f'w{week}_issued') or 0))
        net = received - issued
        totals[f'w{week}_net'] = float(net)
        totals[f'w{week}_received_cost'] = float((received * unit_price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
        totals[f'w{week}_issued_cost'] = float((issued * unit_price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
        grand_total_units += net

    total_received = sum(
        Decimal(str(item.get(f'w{w}_received') or 0)) for w in range(1, 5)
    )
    total_issued = sum(
        Decimal(str(item.get(f'w{w}_issued') or 0)) for w in range(1, 5)
    )

    totals['total_received'] = float(total_received)
    totals['total_issued'] = float(total_issued)
    totals['total_received_cost'] = float((total_received * unit_price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    totals['total_issued_cost'] = float((total_issued * unit_price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
    totals['grand_total'] = float((grand_total_units * unit_price).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))

    return totals


def calc_summary(items: list) -> dict:
    """Aggregate summary across all items."""
    grand_total = Decimal('0')
    total_received_cost = Decimal('0')
    total_issued_cost = Decimal('0')
    reorder_alerts = []

    for item in items:
        unit_price = Decimal(str(item.get('unit_price') or 0))

        total_received = sum(Decimal(str(item.get(f'w{w}_received') or 0)) for w in range(1, 5))
        total_issued = sum(Decimal(str(item.get(f'w{w}_issued') or 0)) for w in range(1, 5))
        net = total_received - total_issued

        total_received_cost += total_received * unit_price
        total_issued_cost += total_issued * unit_price
        grand_total += net * unit_price

        on_hand = Decimal(str(item.get('on_hand') or 0))
        par_level = Decimal(str(item.get('par_level') or 0))
        if par_level > 0 and on_hand < par_level:
            reorder_alerts.append({
                'item_id': item.get('item_id'),
                'sku': item.get('sku'),
                'description': item.get('description'),
                'on_hand': float(on_hand),
                'par_level': float(par_level),
                'shortage': float(par_level - on_hand),
            })

    return {
        'grand_total': float(grand_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
        'total_received_cost': float(total_received_cost.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
        'total_issued_cost': float(total_issued_cost.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)),
        'item_count': len(items),
        'reorder_alerts': reorder_alerts,
        'reorder_count': len(reorder_alerts),
    }
