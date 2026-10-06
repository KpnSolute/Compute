"""Price Review API and the publish gate (observed-price protocol)."""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.routes import inventory, price_review
from backend.routes._deps import _require_manager

MANAGER = {"id": "11111111-1111-1111-1111-111111111111", "role": "manager"}


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters, self.op, self.values, self.maximum = [], "select", None, None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, n):
        self.maximum = n
        return self

    def insert(self, values):
        self.op, self.values = "insert", values
        return self

    def update(self, values):
        self.op, self.values = "update", values
        return self

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        hits = [r for r in rows if all(r.get(k) == v for k, v in self.filters)]
        self.db.calls.append((self.table, self.op))
        if self.op == "insert":
            row = {"id": f"new-{len(rows)}", **deepcopy(self.values)}
            rows.append(row)
            return SimpleNamespace(data=[deepcopy(row)])
        if self.op == "update":
            for r in hits:
                r.update(self.values)
            return SimpleNamespace(data=deepcopy(hits))
        hits = hits[: self.maximum] if self.maximum else hits
        return SimpleNamespace(data=deepcopy(hits))


class DB:
    def __init__(self):
        self.calls, self.rpcs = [], []
        self.rows = {
            "month_status": [],
            "inventory_items": [{"id": "lettuce", "unit_price": 74.41}],
            "price_review_queue": [
                {
                    "id": "row-1",
                    "item_id": "lettuce",
                    "sku": "2326411",
                    "month": 8,
                    "year": 2026,
                    "previous_price": 74.41,
                    "observed_price": 47.20,
                    "status": "pending",
                }
            ],
            "inventory_price_drift": [],
        }

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        self.rpcs.append((name, deepcopy(params)))
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=1))


@pytest.fixture
def db(monkeypatch):
    fake = DB()
    monkeypatch.setattr(price_review, "supabase_service", fake)
    return fake


@pytest.fixture
def api(db):
    app = FastAPI()
    app.include_router(price_review.router)
    app.dependency_overrides[_require_manager] = lambda: MANAGER
    return TestClient(app)


def queue_row(db):
    return db.rows["price_review_queue"][0]


def test_apply_sets_period_and_catalog_price_to_the_invoice(api, db):
    res = api.post("/api/price-review/row-1/resolve", json={"action": "apply"})
    assert res.status_code == 200, res.text
    assert db.rpcs == [
        (
            "apply_observed_prices",
            {
                "p_month": 8,
                "p_year": 2026,
                "p_prices": [{"item_id": "lettuce", "unit_price": 47.20}],
            },
        )
    ]
    assert db.rows["inventory_items"][0]["unit_price"] == 47.20
    row = queue_row(db)
    assert row["status"] == "applied" and row["applied_price"] == 47.20
    assert row["resolved_by"] == MANAGER["id"]
    assert res.json()["month"] == 9  # API months are 1-indexed


def test_apply_accepts_a_manager_override(api, db):
    res = api.post(
        "/api/price-review/row-1/resolve",
        json={"action": "apply", "price": 46.5, "note": "Called US Foods"},
    )
    assert res.status_code == 200, res.text
    assert db.rpcs[0][1]["p_prices"][0]["unit_price"] == 46.5
    assert queue_row(db)["reason"] == "Called US Foods"


def test_keep_changes_no_price(api, db):
    res = api.post("/api/price-review/row-1/resolve", json={"action": "keep"})
    assert res.status_code == 200, res.text
    assert db.rpcs == []
    assert db.rows["inventory_items"][0]["unit_price"] == 74.41
    assert queue_row(db)["status"] == "kept"


def test_a_decided_row_cannot_be_decided_again(api, db):
    queue_row(db)["status"] = "kept"
    res = api.post("/api/price-review/row-1/resolve", json={"action": "apply"})
    assert res.status_code == 409


def test_published_period_is_read_only(api, db):
    db.rows["month_status"].append({"month": 8, "year": 2026, "status": "published"})
    res = api.post("/api/price-review/row-1/resolve", json={"action": "apply"})
    assert res.status_code == 403
    assert db.rpcs == [] and queue_row(db)["status"] == "pending"


@pytest.mark.parametrize(
    "body",
    [
        {"action": "delete"},
        {"action": "apply", "price": 0},
        {"action": "apply", "price": -3},
    ],
)
def test_invalid_resolutions_are_rejected(api, db, body):
    assert api.post("/api/price-review/row-1/resolve", json=body).status_code == 422
    assert db.rpcs == []


def drift_row(**overrides):
    return {
        "item_id": "lettuce",
        "sku": "2326411",
        "description": "LETTUCE, ICBRG FRESH REF BOX",
        "month": 8,
        "year": 2026,
        "inventory_price": 74.41,
        "observed_price": 47.20,
        "invoice_number": "1770890",
        "week_number": 3,
        "change_pct": -0.3657,
        "review_pending": False,
        "difference_accepted": False,
        **overrides,
    }


def test_drift_apply_records_a_decision_row(api, db):
    db.rows["inventory_price_drift"].append(drift_row())
    res = api.post(
        "/api/price-review/drift/resolve",
        json={"action": "apply", "item_id": "lettuce", "month": 9, "year": 2026},
    )
    assert res.status_code == 200, res.text
    assert db.rpcs[0][1]["p_prices"] == [{"item_id": "lettuce", "unit_price": 47.20}]
    decision = db.rows["price_review_queue"][-1]
    assert decision["status"] == "applied" and decision["applied_price"] == 47.20
    assert (
        decision["previous_price"] == 74.41 and decision["invoice_number"] == "1770890"
    )


def test_drift_with_a_pending_review_must_use_that_review(api, db):
    db.rows["inventory_price_drift"].append(drift_row(review_pending=True))
    res = api.post(
        "/api/price-review/drift/resolve",
        json={"action": "apply", "item_id": "lettuce", "month": 9, "year": 2026},
    )
    assert res.status_code == 409 and db.rpcs == []


def test_open_issues_count_pending_and_unaccepted_drift(db):
    db.rows["inventory_price_drift"] += [
        drift_row(),
        drift_row(item_id="cup", review_pending=True),
        drift_row(item_id="cream", difference_accepted=True),
    ]
    assert price_review.open_price_issues(8, 2026) == {
        "pending_reviews": 1,
        "unresolved_drift": 1,
    }


# ── publish gate ─────────────────────────────────────────────────────────────


def publish(monkeypatch, issues):
    calls = []
    monkeypatch.setattr(inventory, "open_price_issues", lambda m, y: issues)
    monkeypatch.setattr(
        inventory,
        "supabase_service",
        SimpleNamespace(
            rpc=lambda name, params: SimpleNamespace(
                execute=lambda: calls.append((name, params))
            )
        ),
    )
    body = inventory.WeekStatusRequest(month=9, year=2026, week=3, status="published")
    return calls, body


def test_publish_is_blocked_by_open_price_issues(monkeypatch):
    calls, body = publish(monkeypatch, {"pending_reviews": 1, "unresolved_drift": 3})
    with pytest.raises(HTTPException) as err:
        inventory.set_week_status(body, auth_user=MANAGER)
    assert err.value.status_code == 409
    assert "1 price review(s) pending" in err.value.detail
    assert calls == []


def test_publish_proceeds_when_prices_are_clean(monkeypatch):
    calls, body = publish(monkeypatch, {"pending_reviews": 0, "unresolved_drift": 0})
    assert inventory.set_week_status(body, auth_user=MANAGER)["status"] == "published"
    assert calls[0][0] == "set_week_status"


def test_locking_a_week_does_not_check_prices(monkeypatch):
    def fail(*_a):
        raise AssertionError("price check must only run on publish")

    calls, _ = publish(monkeypatch, {})
    monkeypatch.setattr(inventory, "open_price_issues", fail)
    body = inventory.WeekStatusRequest(month=9, year=2026, week=3, status="locked")
    assert inventory.set_week_status(body, auth_user=MANAGER)["status"] == "locked"
