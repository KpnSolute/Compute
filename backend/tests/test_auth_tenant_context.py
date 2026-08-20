import pytest
from fastapi import HTTPException

from backend.routes.auth import _require_resolved_tenant_id


def test_login_tenant_id_must_match_resolved_membership():
    identity = {
        "tenant": {
            "id": "tenant-mjcc",
            "slug": "mjcc",
        }
    }
    _require_resolved_tenant_id(identity, "")
    _require_resolved_tenant_id(identity, "tenant-mjcc")

    with pytest.raises(HTTPException, match="Immutable tenant context mismatch") as exc:
        _require_resolved_tenant_id(identity, "tenant-other")
    assert exc.value.status_code == 403


def test_login_tenant_id_fails_closed_without_resolved_tenant():
    with pytest.raises(HTTPException, match="Immutable tenant context mismatch") as exc:
        _require_resolved_tenant_id({}, "tenant-mjcc")
    assert exc.value.status_code == 403
