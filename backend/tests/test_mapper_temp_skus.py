from backend.ai.mapper import map_rows_to_inventory


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
