import pytest

from backend.routes.data_entry import _resolve_invoice_vendor_id


def test_invoice_vendor_resolution_is_exact_but_ignores_legal_suffix():
    rows = [
        {"id": "us-foods", "name": "US Foods, Inc."},
        {"id": "multi-flow", "name": "Multi-Flow Industries"},
    ]

    assert _resolve_invoice_vendor_id("US Foods", rows) == "us-foods"
    assert _resolve_invoice_vendor_id("Multi-Flow Industries", rows) == "multi-flow"


def test_invoice_vendor_resolution_fails_closed_for_unknown_or_ambiguous_names():
    with pytest.raises(RuntimeError, match="unknown"):
        _resolve_invoice_vendor_id("US Food", [{"id": "known", "name": "US Foods"}])

    with pytest.raises(RuntimeError, match="ambiguous"):
        _resolve_invoice_vendor_id(
            "US Foods",
            [
                {"id": "one", "name": "US Foods"},
                {"id": "two", "name": "US Foods, Inc."},
            ],
        )
