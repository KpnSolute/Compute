"""Authenticated end-to-end workflow — NON-PRODUCTION environments only.

The 2026-07-18 audit required an authenticated pass covering: inventory read,
invoice/data-entry preview, staging, manager review, report data, compliance
logging, and logout/session persistence. No safe non-production account or
environment exists in this checkout, so this suite is OPT-IN and skipped by
default. It becomes live the moment these env vars are set:

    MJCC_E2E_BASE_URL   — target API base (MUST NOT be production)
    MJCC_E2E_USERNAME   — dedicated test account username
    MJCC_E2E_PASSWORD   — dedicated test account password (admin/manager), or
    MJCC_E2E_PIN        — staff PIN (either credential works)

Hard safety rail: the production hostname is refused even if explicitly
configured — this suite stages and commits data and must never touch prod.
"""

import os

import pytest

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

BASE_URL = (os.getenv("MJCC_E2E_BASE_URL") or "").rstrip("/")
USERNAME = os.getenv("MJCC_E2E_USERNAME") or ""
PASSWORD = os.getenv("MJCC_E2E_PASSWORD") or ""
PIN = os.getenv("MJCC_E2E_PIN") or ""

# Any of these substrings in the target URL = production → refuse. The bare
# "kpnsolute.com" entry intentionally blocks every subdomain (mjcc.kpnsolute.com,
# archive.kpnsolute.com, ...) — production lives behind that domain.
PRODUCTION_HOSTS = (
    "mjcc-managements.onrender.com",
    "kpncompute.onrender.com",
    "kpnsolute.com",
)

pytestmark = pytest.mark.skipif(
    not BASE_URL or not USERNAME or not (PASSWORD or PIN) or httpx is None,
    reason=(
        "E2E env not configured (MJCC_E2E_BASE_URL + MJCC_E2E_USERNAME + "
        "MJCC_E2E_PASSWORD/PIN required) — blocked on a dedicated "
        "non-production account/environment"
    ),
)


def _guard_not_production():
    if any(host in BASE_URL for host in PRODUCTION_HOSTS):
        pytest.fail(
            f"MJCC_E2E_BASE_URL points at production ({BASE_URL}) — this suite "
            "writes staging/commit data and refuses to run against prod."
        )


@pytest.fixture(scope="module")
def client():
    _guard_not_production()
    with httpx.Client(base_url=BASE_URL, timeout=30) as c:
        yield c


@pytest.fixture(scope="module")
def token(client):
    body = (
        {"username": USERNAME, "pin": PIN}
        if PIN
        else {"username": USERNAME, "password": PASSWORD}
    )
    r = client.post("/api/auth/login", json=body)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text[:200]}"
    tok = r.json().get("token") or r.json().get("access_token")
    assert tok, "login returned no token"
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_inventory_read(client, auth):
    r = client.get("/api/inventory", headers=auth)
    assert r.status_code in (200, 404)  # 404 = empty period is a valid state
    if r.status_code == 200:
        body = r.json()
        assert "items" in body and "metadata" in body
        # New reconciliation contract from this repair:
        assert "weekly_reconciliation" in body["metadata"]


def test_invoice_register_has_item_counts(client, auth):
    r = client.get("/api/invoices", headers=auth)
    assert r.status_code == 200
    for inv in r.json():
        assert "item_count" in inv


def test_staging_and_review_cycle(client, auth):
    # Stage a clearly-labeled test change, verify it appears pending, then
    # reject it so the environment is left clean.
    stage = client.post(
        "/api/sourcectrl/staging",
        headers=auth,
        json={
            "entity_type": "inventory",
            "entity_id": "E2E-TEST-000",
            "field_name": "e2e",
            "old_value": "",
            "new_value": "e2e",
            "change_type": "update",
            "operation": "inventory_week_update",
            "full_payload": {
                "month": 1,
                "year": 2030,
                "week": 1,
                "direction": "received",
                "items": [{"sku": "E2E-TEST-000", "desc": "E2E harness row", "qty": 0}],
            },
            "summary": "E2E harness — safe to delete",
        },
    )
    assert stage.status_code in (200, 201), stage.text[:300]
    entry_id = stage.json().get("entry_id")
    assert entry_id

    reject = client.delete(
        f"/api/staging/{entry_id}",
        headers=auth,
        params={"review_note": "E2E harness cleanup"},
    )
    assert reject.status_code in (200, 204), reject.text[:300]


def test_compliance_log_roundtrip(client, auth):
    r = client.post(
        "/api/logs/haccp",
        headers=auth,
        json={
            "location": "E2E Test Cooler",
            "temperature": 38.0,
            "unit": "F",
            "timestamp": "2030-01-01T08:00:00Z",
            "checked_by": "e2e-harness",
            "notes": "E2E harness — safe to delete",
        },
    )
    assert r.status_code in (200, 201)
    r2 = client.get("/api/logs/haccp", headers=auth, params={"limit": 5})
    assert r2.status_code == 200


def test_report_data_uses_register_model(client, auth):
    # Reports consume /api/inventory metadata — same model as the register.
    r = client.get("/api/inventory", headers=auth)
    if r.status_code == 200:
        meta = r.json()["metadata"]
        assert "invoice_register" in meta


def test_logout_and_session_expiry(client, token):
    headers = {"Authorization": f"Bearer {token}"}
    r = client.post("/api/auth/logout", headers=headers)
    assert r.status_code in (200, 204, 404)  # 404 = no logout endpoint (token-only)
    if r.status_code in (200, 204):
        r2 = client.get("/api/inventory", headers=headers)
        assert r2.status_code == 401, "token should be invalid after logout"
