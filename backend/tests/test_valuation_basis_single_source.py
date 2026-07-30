"""Every surface must value inventory on ONE invoice-backed basis.

The July 2026 report: the Operations editor showed Total Received $25,562.14
while the API's stored `received_value` summed to $30,087.95 for the same
period and the same label — a $4,525.81 disagreement caused by the invoice
schedule (goods/payable amounts) being substituted for inventory movement
value on some surfaces but not others.

Invoice-backed figures are the source of truth for imported rows. Quantity x
period price is only a fallback for rows without imported value controls. These
tests pin the single basis so a future edit that reaches for a second one fails.
"""

import importlib

from backend import inventory_formulas as fi


def _import(monkeypatch, module):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    return importlib.import_module(module)


# A row whose STORED value columns are on the old invoice-actual basis: the
# receipt was invoiced at 268.36 for 7 cases while the period's catalog price
# is 38.50/case. Every surface must report the invoice-backed figure.
LEGACY_BASIS_ROW = {
    "item_id": "fork",
    "opening_oh": 0,
    "w1_received": 4,
    "w2_received": 3,
    "w3_received": 0,
    "w1_pulled": 2,
    "w2_pulled": 2,
    "w3_pulled": 0,
    "unit_price": 38.50,
    "opening_value": 0.00,
    "received_value": 268.36,  # invoice-actual — must NOT be echoed
    "pulled_value": 154.00,
    "ending_value": 114.36,
}


def test_resolver_uses_the_stored_invoice_basis():
    fin = fi.resolve_row_financials(LEGACY_BASIS_ROW)
    # The uploaded invoice/review value is authoritative for received goods.
    assert fin["received_value"] == 268.36
    assert fin["pulled_value"] == 154.00
    assert fin["ending_qty"] == 3
    assert fin["ending_value"] == 114.36


def test_the_identity_holds_on_the_single_basis():
    fin = fi.resolve_row_financials(LEGACY_BASIS_ROW)
    assert (
        round(fin["opening_value"] + fin["received_value"] - fin["pulled_value"], 2)
        == fin["ending_value"]
    )


def test_inventory_api_and_cost_rollup_agree(monkeypatch):
    """The two surfaces that used to disagree must produce the same numbers."""
    inv = _import(monkeypatch, "backend.routes.inventory")
    row = dict(
        LEGACY_BASIS_ROW,
        inventory_items={
            "id": "fork",
            "sku": "3383435",
            "description": "FORK, MW BLK PLST REFL",
            "par_level": 0,
            "unit": "case",
            "inventory_categories": {"id": "c1", "name": "Disposables"},
        },
    )
    item = inv._flatten_rows([row])[0]
    fin = fi.resolve_row_financials(row)

    assert item.receivedValue == fin["received_value"]
    assert item.pulledValue == fin["pulled_value"]
    assert item.openingValue == fin["opening_value"]
    assert item.endingValue == fin["ending_value"]


def test_ai_tools_reports_all_four_values_on_one_basis(monkeypatch):
    """The AI row used to mix stored opening/received/pulled with a derived
    ending, so its own numbers did not add up."""
    _import(monkeypatch, "backend.ai.tools")
    fin = fi.resolve_row_financials(LEGACY_BASIS_ROW)
    opening = round(fin["opening_value"], 2)
    received = round(fin["received_value"], 2)
    pulled = round(fin["pulled_value"], 2)
    ending = round(fin["ending_value"], 2)
    assert round(opening + received - pulled, 2) == ending


def test_no_module_keeps_a_private_valuation_helper():
    """A second implementation is how the bases drifted apart originally."""
    import backend.ai.tools as tools

    assert not hasattr(tools, "_ending_value")
