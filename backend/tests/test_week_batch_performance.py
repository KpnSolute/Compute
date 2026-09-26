"""Bounded weekly writes, sparse settlement, and replay-safe pull validation."""

from collections import Counter
from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend import inventory_formulas as fi
from backend.staging import dispatch


class Query:
    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = []
        self.operation = "select"
        self.values = None
        self.maximum = None
        self.bounds = None
        self.sort_key = None

    def order(self, key):
        self.sort_key = key
        return self

    def range(self, start, end):
        self.bounds = (start, end)
        return self

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in values)
        return self

    def ilike(self, key, value):
        self.filters.append(lambda row: str(row.get(key, "")).lower() == value.lower())
        return self

    def limit(self, count):
        self.maximum = count
        return self

    def insert(self, values):
        self.operation, self.values = "insert", values
        return self

    def upsert(self, values, **_kwargs):
        self.operation, self.values = "upsert", values
        return self

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        self.client.calls.append((self.table, self.operation))
        rows = self.client.rows[self.table]
        matches = [row for row in rows if all(f(row) for f in self.filters)]
        if self.operation == "select":
            if self.sort_key is not None:
                matches.sort(key=lambda row: row.get(self.sort_key, ""))
            if self.bounds is not None:
                start, end = self.bounds
                matches = matches[start : end + 1]
            matches = matches[: self.maximum] if self.maximum is not None else matches
            result = deepcopy(matches)
            if self.table == "monthly_inventory":
                for row in result:
                    catalog = next(
                        r
                        for r in self.client.rows["inventory_items"]
                        if r["id"] == row["item_id"]
                    )
                    row["inventory_items"] = {"unit_price": catalog.get("unit_price")}
            return SimpleNamespace(data=result)
        if self.operation == "delete":
            rows[:] = [row for row in rows if row not in matches]
        elif self.operation == "update":
            for row in matches:
                row.update(self.values)
        else:
            values = self.values if isinstance(self.values, list) else [self.values]
            self.client.writes.append((self.table, self.operation, deepcopy(values)))
            for value in values:
                value = deepcopy(value)
                keys = (
                    ("item_id", "month", "year")
                    if self.table == "monthly_inventory"
                    else ("id",)
                )
                existing = next(
                    (r for r in rows if all(r.get(k) == value.get(k) for k in keys)),
                    None,
                )
                if self.operation == "upsert" and existing is not None:
                    existing.update(value)
                else:
                    value.setdefault("id", f"new-{len(rows)}")
                    rows.append(value)
            return SimpleNamespace(data=deepcopy(values))
        return SimpleNamespace(data=[])


class Client:
    def __init__(self, count=300):
        self.calls = []
        self.writes = []
        self.rpc_calls = []
        self.rows = {
            "month_status": [],
            "inventory_categories": [
                {"id": "dry", "name": "Dry"},
                {"id": "new", "name": "New Items"},
            ],
            "inventory_items": [
                {
                    "id": str(i),
                    "sku": f"SKU-{i}",
                    "description": "Item",
                    "unit_price": i + 1,
                    "category_id": "manager-category",
                    "par_level": 7,
                    "unit": "CS",
                }
                for i in range(count)
            ],
            "monthly_inventory": [
                {
                    "item_id": str(i),
                    "month": 8,
                    "year": 2026,
                    "opening_oh": 10,
                    "unit_price": i + 1,
                    "opening_unit_cost": i + 1,
                    "opening_value": 10 * (i + 1),
                    "received_value": 0,
                    "pulled_value": 0,
                    "ending_value": 10 * (i + 1),
                }
                for i in range(count)
            ],
            "inventory_transactions": [],
        }

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        def execute():
            self.calls.append((name, "rpc"))
            self.rpc_calls.append((name, deepcopy(params)))
            if name == "recompute_week_totals_batch":
                for iid in params["p_item_ids"]:
                    row = next(
                        r
                        for r in self.rows["monthly_inventory"]
                        if r["item_id"] == iid
                        and r["month"] == params["p_month"]
                        and r["year"] == params["p_year"]
                    )
                    ledger = [
                        r
                        for r in self.rows["inventory_transactions"]
                        if r["item_id"] == iid
                        and r["month"] == params["p_month"]
                        and r["year"] == params["p_year"]
                    ]
                    for week in range(1, 4):
                        for column, types in [
                            ("received", {"received", "adjustment_increase"}),
                            ("pulled", {"issued", "adjustment_decrease"}),
                        ]:
                            row[f"w{week}_{column}"] = sum(
                                r["quantity"]
                                for r in ledger
                                if r["week_number"] == week and r["txn_type"] in types
                            )
            elif name == "settle_inventory_values_batch":
                for update in params["p_updates"]:
                    row = next(
                        r
                        for r in self.rows["monthly_inventory"]
                        if r["item_id"] == update["item_id"]
                        and r["month"] == params["p_month"]
                        and r["year"] == params["p_year"]
                    )
                    row.update(
                        {
                            key: value
                            for key, value in update.items()
                            if key != "item_id"
                        }
                    )
            else:
                raise AssertionError(name)
            return SimpleNamespace(data=None)

        return SimpleNamespace(execute=execute)


def payload(count=300, direction="issued", qty=2):
    return {
        "month": 9,
        "year": 2026,
        "week": 2,
        "direction": direction,
        "_batch_staging_ids": [f"stage-{i}" for i in range(count)],
        "items": [
            {
                "sku": f"SKU-{i}",
                "desc": "Changed",
                "qty": qty,
                "price": 999,
                "category": "Dry",
                "_staging_entry_id": f"stage-{i}",
            }
            for i in range(count)
        ],
    }


@pytest.mark.parametrize("direction", ["issued", "received"])
def test_300_week_items_have_bounded_reads_and_writes(monkeypatch, direction):
    client = Client()
    monkeypatch.setattr(dispatch, "supabase_service", client)
    result = dispatch.dispatch_inventory_week(payload(direction=direction))
    assert result["applied"] == 300
    counts = Counter(client.calls)
    assert counts["inventory_items", "select"] == 3
    assert counts["inventory_items", "upsert"] == 3
    assert counts["inventory_items", "update"] == 0
    assert counts["recompute_week_totals_batch", "rpc"] == 3
    assert counts["settle_inventory_values_batch", "rpc"] == 3
    assert counts["monthly_inventory", "update"] == 0
    assert counts["monthly_inventory", "select"] == (7 if direction == "issued" else 4)
    assert counts["inventory_transactions", "select"] == (
        3 if direction == "issued" else 0
    )
    assert counts["inventory_transactions", "delete"] == 3
    for name, args in client.rpc_calls:
        assert args["p_month"] == 8 and args["p_year"] == 2026
        assert (
            len(
                args["p_item_ids"]
                if name == "recompute_week_totals_batch"
                else args["p_updates"]
            )
            == 100
        )
    for i, item in enumerate(client.rows["inventory_items"]):
        assert item["category_id"] == "manager-category"
        assert item["par_level"] == 7 and item["unit"] == "CS"
        assert item["unit_price"] == (i + 1 if direction == "issued" else 999)
    for i, movement in enumerate(client.rows["inventory_transactions"]):
        assert movement["unit_price"] == (i + 1 if direction == "issued" else 999)
    for row in client.rows["monthly_inventory"]:
        assert row["unit_price"] == int(row["item_id"]) + 1
        expected = fi.resolve_row_financials(row)
        assert row["ending_value"] == expected["ending_value"]


def test_replayed_pull_subtracts_only_replaced_period_ledger(monkeypatch):
    client = Client(1)
    client.rows["monthly_inventory"][0]["w2_pulled"] = 8
    client.rows["inventory_transactions"] = [
        {
            "item_id": "0",
            "month": 8,
            "year": 2026,
            "week_number": 2,
            "txn_type": "issued",
            "quantity": 6,
            "staging_entry_id": "stage-0",
        },
        {
            "item_id": "0",
            "month": 8,
            "year": 2026,
            "week_number": 2,
            "txn_type": "adjustment_decrease",
            "quantity": 2,
            "staging_entry_id": "keep",
        },
        {
            "item_id": "0",
            "month": 7,
            "year": 2026,
            "week_number": 2,
            "txn_type": "issued",
            "quantity": 100,
            "staging_entry_id": "keep-other-period",
        },
    ]
    monkeypatch.setattr(dispatch, "supabase_service", client)
    result = dispatch.dispatch_inventory_week(payload(1, qty=6))
    assert result["applied"] == 1
    assert client.rows["monthly_inventory"][0]["w2_pulled"] == 8
    result = dispatch.dispatch_inventory_week(payload(1, qty=6))
    assert result["applied"] == 1
    assert client.rows["monthly_inventory"][0]["w2_pulled"] == 8
    before = deepcopy(client.rows)
    result = dispatch.dispatch_inventory_week(payload(1, qty=9))
    assert result["applied"] == 0 and "exceeds available stock" in result["error"]
    assert client.rows == before


def test_duplicate_skus_aggregate_pulls_and_recompute_once(monkeypatch):
    client = Client(1)
    monkeypatch.setattr(dispatch, "supabase_service", client)
    request = payload(1, qty=4)
    request["items"].append({**request["items"][0], "_staging_entry_id": "second"})
    assert dispatch.dispatch_inventory_week(request)["applied"] == 2
    recompute = [
        args for name, args in client.rpc_calls if name == "recompute_week_totals_batch"
    ]
    assert recompute[0]["p_item_ids"] == ["0"]
    assert client.rows["monthly_inventory"][0]["w2_pulled"] == 8


def test_sparse_unique_corrections_are_one_rpc_and_deduplicate_ids():
    client = Client(3)
    for row in client.rows["monthly_inventory"]:
        row["ending_value"] = -1
    expected = [
        {"item_id": row["item_id"], **fi.value_invariant_updates(row)}
        for row in client.rows["monthly_inventory"]
    ]
    assert (
        dispatch._enforce_value_invariants(client, 8, 2026, ["0", "1", "2", "0"]) == 3
    )
    assert client.rpc_calls == [
        (
            "settle_inventory_values_batch",
            {"p_month": 8, "p_year": 2026, "p_updates": expected},
        )
    ]
    for update in expected:
        assert set(update) == {"item_id", "ending_value"}
    assert dispatch._enforce_value_invariants(client, 8, 2026, ["0", "1", "2"]) == 0
    assert len(client.rpc_calls) == 1


def test_rollover_batches_positive_closing_and_retains_explicit_openings():
    client = Client(302)
    for row in client.rows["monthly_inventory"]:
        row["month"], row["year"] = 11, 2025
        row["ending_value"] = -999  # Stale audit value must not be carried.
    client.rows["monthly_inventory"][-1]["opening_oh"] = 0
    assert dispatch._rollover_opening_balances(client, 0, 2026, {"0"}) == 300
    writes = [
        values
        for table, op, values in client.writes
        if table == "monthly_inventory" and op == "upsert"
    ]
    assert [len(rows) for rows in writes] == [100, 100, 100]
    for row in [row for rows in writes for row in rows]:
        assert row["month"] == 0 and row["year"] == 2026
        assert row["item_id"] not in {"0", "301"}
        assert row["opening_oh"] == 10
        assert row["opening_value"] == 10 * (int(row["item_id"]) + 1)
        assert row["ending_value"] == row["opening_value"]
    assert dispatch._rollover_opening_balances(client, 0, 2026) == 0


def test_missing_backend_price_rejects_before_pending_catalog_writes(monkeypatch):
    client = Client(1)
    client.rows["inventory_items"][0]["unit_price"] = None
    before = deepcopy(client.rows)
    monkeypatch.setattr(dispatch, "supabase_service", client)
    result = dispatch.dispatch_inventory_week(payload(1))
    assert result["applied"] == 0 and "No backend price" in result["error"]
    assert client.rows == before and client.writes == []


def test_replay_reads_all_ledger_pages_before_overpull_validation(monkeypatch):
    client = Client(1)
    row = client.rows["monthly_inventory"][0]
    row["opening_oh"] = 1100
    row["w2_pulled"] = 1100
    client.rows["inventory_transactions"] = [
        {
            "txn_id": f"{i:04}",
            "item_id": "0",
            "month": 8,
            "year": 2026,
            "week_number": 2,
            "txn_type": "issued",
            "quantity": 1,
            "staging_entry_id": "stage-0",
        }
        for i in range(1100)
    ]
    monkeypatch.setattr(dispatch, "supabase_service", client)
    assert dispatch.dispatch_inventory_week(payload(1, qty=1100))["applied"] == 1
    assert Counter(client.calls)["inventory_transactions", "select"] == 2
    assert len(client.rows["inventory_transactions"]) == 1
    assert row["w2_pulled"] == 1100


def test_zero_catalog_and_monthly_prices_remain_zero(monkeypatch):
    client = Client(1)
    client.rows["inventory_items"][0]["unit_price"] = 0
    row = client.rows["monthly_inventory"][0]
    row.update(unit_price=0, opening_unit_cost=0, opening_value=0, ending_value=0)
    monkeypatch.setattr(dispatch, "supabase_service", client)
    assert dispatch.dispatch_inventory_week(payload(1))["applied"] == 1
    assert client.rows["inventory_transactions"][0]["unit_price"] == 0
    assert row["unit_price"] == 0 and row["ending_value"] == 0


def test_monthly_missing_price_fallback_preserves_sparse_quantities():
    client = Client(1)
    row = client.rows["monthly_inventory"][0]
    row.update(unit_price=None, opening_value=0, ending_value=0)
    before = deepcopy(row)
    assert dispatch._enforce_value_invariants(client, 8, 2026, ["0"]) == 1
    update = client.rpc_calls[0][1]["p_updates"][0]
    assert update == {"item_id": "0", "opening_value": 10, "ending_value": 10}
    assert row["unit_price"] is None
    assert row["opening_oh"] == before["opening_oh"]


def test_failed_settlement_reports_no_success_or_per_item_fallback():
    client = Client(1)
    client.rows["monthly_inventory"][0]["ending_value"] = -1

    def failing_rpc(name, args):
        assert name == "settle_inventory_values_batch"
        assert len(args["p_updates"]) == 1

        def execute():
            raise RuntimeError("RPC unavailable")

        return SimpleNamespace(execute=execute)

    client.rpc = failing_rpc
    assert dispatch._enforce_value_invariants(client, 8, 2026, ["0"]) == 0
    assert client.rows["monthly_inventory"][0]["ending_value"] == -1
    assert Counter(client.calls)["monthly_inventory", "update"] == 0
