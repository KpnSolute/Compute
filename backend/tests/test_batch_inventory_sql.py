"""Static migration contracts; these do not claim live PostgreSQL execution."""

from pathlib import Path
import re

import pytest


SQL = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20260926190041_batch_inventory_commit_totals.sql"
).read_text()
CODE = re.sub(r"--[^\n]*", "", SQL).lower()
RECOMPUTE, SETTLE = CODE.split(
    "create function public.settle_inventory_values_batch", 1
)


def test_additive_invoker_functions_only():
    assert re.findall(r"create function public\.(\w+)", CODE) == [
        "recompute_week_totals_batch",
        "settle_inventory_values_batch",
    ]
    assert CODE.count("security invoker") == 2
    assert CODE.count("set search_path = public, pg_temp") == 2
    assert not re.search(
        r"\b(definer|loop|execute|disable|drop|alter)\b", CODE.split("revoke all")[0]
    )
    assert "create trigger" not in CODE


def test_item_validation_precedes_single_set_based_upsert():
    guard, write = RECOMPUTE.split("insert into public.monthly_inventory")
    assert "from unnest(p_item_ids)" in guard
    assert "where i.tenant_id = p_tenant_id and i.id = requested.item_id" in guard
    assert "raise exception" in guard
    assert "select distinct item_id" in guard
    assert RECOMPUTE.count("insert into") == 1
    assert RECOMPUTE.count("on conflict") == 1
    assert "on conflict (tenant_id, item_id, month, year)" in write
    assert (
        "t.tenant_id = p_tenant_id and t.month = p_month and t.year = p_year" in guard
    )
    assert (
        "m.tenant_id = p_tenant_id and m.month = p_month and m.year = p_year" in write
    )
    assert "opening_oh = current_row.opening_oh" in write
    assert "current_row.unit_price is null or current_row.unit_price = 0" in write
    assert "then excluded.unit_price else current_row.unit_price end" in write


@pytest.mark.parametrize("week", [1, 2, 3])
@pytest.mark.parametrize(
    "kinds", ["'received', 'adjustment_increase'", "'issued', 'adjustment_decrease'"]
)
def test_all_ledger_types_and_weeks_are_aggregated(week, kinds):
    assert (
        f"sum(t.quantity) filter (where t.week_number = {week} and t.txn_type in ({kinds}))"
        in RECOMPUTE
    )
    assert (
        "left join totals" in RECOMPUTE
    )  # Empty-ledger items still produce zero totals.


def test_settlement_validates_shape_duplicates_and_existing_tenant_period():
    guard, update = SETTLE.split("update public.monthly_inventory as m set")
    assert "jsonb_typeof(p_updates) <> 'array'" in guard
    assert "jsonb_typeof(u.value) <> 'object'" in guard
    assert "jsonb_typeof(u.value -> 'item_id') is distinct from 'string'" in guard
    assert "jsonb_typeof(kv.value) not in ('number', 'null')" in guard
    assert "kv.key not in" in guard
    assert "having count(*) > 1" in guard
    assert "where not exists" in guard
    assert "i.tenant_id = m.tenant_id" in guard
    for part in (guard, update):
        assert (
            "m.tenant_id = p_tenant_id and m.month = p_month and m.year = p_year"
            in part
        )
        assert "m.item_id = (u.value ->> 'item_id')::uuid" in part
    assert "insert into" not in SETTLE
    assert "affected_rows <> jsonb_array_length(p_updates)" in update


@pytest.mark.parametrize(
    "field",
    [
        "opening_unit_cost",
        "opening_value",
        "received_value",
        "pulled_value",
        "ending_value",
    ],
)
def test_sparse_fields_retain_omitted_values(field):
    assert (
        f"{field} = case when u.value ? '{field}' then (u.value ->> '{field}')::numeric else m.{field} end"
        in SETTLE
    )
    assignments = SETTLE.split("update public.monthly_inventory as m set")[1].split(
        "from jsonb_array_elements"
    )[0]
    assert set(re.findall(r"(\w+) = case", assignments)) == {
        "opening_unit_cost",
        "opening_value",
        "received_value",
        "pulled_value",
        "ending_value",
    }


@pytest.mark.parametrize(
    "signature",
    [
        "recompute_week_totals_batch(uuid, uuid[], int, int)",
        "settle_inventory_values_batch(uuid, int, int, jsonb)",
    ],
)
def test_service_role_only_grants(signature):
    assert (
        f"revoke all on function public.{signature} from public, anon, authenticated;"
        in CODE
    )
    assert f"grant execute on function public.{signature} to service_role;" in CODE
    assert CODE.count("grant execute") == 2
