import logging

from backend.ai.mapper import map_rows_to_inventory


def test_duplicate_sku_in_one_file_logs_warning(caplog):
    """dispatch_inventory_save dedups by (item_id, month, year) and keeps the
    last row for a repeated SKU, silently dropping the earlier row's
    quantity/price. The mapper must at least log it so it's traceable."""
    rows = [
        {
            "Category": "Dry Goods",
            "SKU": "DRY-001",
            "Description": "Rice",
            "Opening OH": 10,
            "Unit Price": 1.5,
        },
        {
            "Category": "Dry Goods",
            "SKU": "DRY-001",
            "Description": "Rice (2nd row)",
            "Opening OH": 3,
            "Unit Price": 6.0,
        },
    ]

    with caplog.at_level(logging.WARNING, logger="mjcc.mapper"):
        result = map_rows_to_inventory(rows, {"Dry Goods": 1}, month=4, year=2026)

    assert len(result["items"]) == 2, "both rows are kept; dispatch dedups later"
    assert any("DRY-001" in r.message for r in caplog.records), (
        f"expected a duplicate-SKU warning, got: {[r.message for r in caplog.records]}"
    )


def test_blank_sku_rows_get_incremental_unique_review_skus():
    rows = [
        {
            "Category": "Dairy",
            "SKU": "",
            "Description": "Butter PC",
            "Opening OH": 12,
            "Unit Price": 1.25,
        },
        {
            "Category": "Dairy",
            "SKU": "",
            "Description": "Cheese Slice",
            "Opening OH": 4,
            "Unit Price": 2.50,
        },
    ]

    first = map_rows_to_inventory(rows, {"Dairy": 1}, month=4, year=2026)
    second = map_rows_to_inventory(rows, {"Dairy": 1}, month=4, year=2026)

    first_skus = [item["sku"] for item in first["items"]]
    assert first_skus == [item["sku"] for item in second["items"]]
    assert first_skus[0] != first_skus[1]
    assert first_skus[0].startswith("MJC-0001")
    assert first_skus[1].startswith("MJC-0002")
    assert all(len(sku) == 14 for sku in first_skus)
