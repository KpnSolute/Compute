"""Regression test for _diff_inventory_item's value-field false positives.

A dashboard save (Operations.tsx) never sends opening_value/received_value/
pulled_value/ending_value/opening_unit_cost -- those are backend-computed.
The diff previously compared them unconditionally, so "field absent from
payload" was treated as "field becomes null", flagging every item that
already had a real value as changed. On a 291-item month this alone
produced 1000+ bogus commit_changes rows for a single real Par edit.
"""

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _fake_client(item_row, monthly_row):
    sup = MagicMock()

    def table(name):
        t = MagicMock()
        if name == "inventory_items":
            t.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
                item_row
            ]
        elif name == "monthly_inventory":
            chain = (
                t.select.return_value.eq.return_value.eq.return_value.eq.return_value
            )
            chain.limit.return_value.execute.return_value.data = [monthly_row]
        return t

    sup.table.side_effect = table
    return sup


def test_value_fields_absent_from_payload_are_not_flagged_as_changed():
    from backend.ai.diff import _diff_inventory_item

    item_row = {
        "id": "item-1",
        "sku": "F00000031",
        "description": "Gourmet Decaf",
        "unit_price": 118.0,
        "par_level": 0,
        "unit": "Case",
        "inventory_categories": {"name": "Beverages"},
    }
    monthly_row = {
        "opening_oh": 1,
        "opening_unit_cost": 118.0,
        "opening_value": 118.0,
        "received_value": 118.0,
        "pulled_value": 0.0,
        "ending_value": 236.0,
        "w1_received": 0,
        "w2_received": 1,
        "w3_received": 0,
        "w1_pulled": 0,
        "w2_pulled": 0,
        "w3_pulled": 0,
    }
    # Dashboard payload for a Par-only edit -- no value fields, matching what
    # Operations.tsx's handleSave actually sends.
    payload_item = {
        "sku": "F00000031",
        "desc": "Gourmet Decaf",
        "price": 118.0,
        "par": 1,  # the only real change
        "onHand": 1,
        "category": "Beverages",
        "w1r": 0,
        "w2r": 1,
        "w3r": 0,
        "w1p": 0,
        "w2p": 0,
        "w3p": 0,
    }

    with patch(
        "backend.ai.diff._client",
        return_value=_fake_client(item_row, monthly_row),
    ):
        result = _diff_inventory_item(payload_item, month=6, year=2026)

    assert result["changes"] == ["par_level"], (
        f"expected only par_level flagged, got {result['changes']}"
    )


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} diff tests passed")


if __name__ == "__main__":
    _run_standalone()
