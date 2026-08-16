import pytest
from fastapi import HTTPException

from backend.routes.workspace_console import RESERVED_SLUGS, _slug, _tenant


def test_workspace_slug_rejects_reserved_product_routes():
    assert "api" in RESERVED_SLUGS
    with pytest.raises(HTTPException) as exc:
        _slug("Login", workspace=True)
    assert exc.value.status_code == 409


def test_workspace_slug_normalizes_customer_route():
    assert _slug("  North-Star  ", workspace=True) == "north-star"


def test_workspace_context_must_match_authenticated_tenant():
    auth_user = {"tenant": {"id": "tenant-a", "slug": "acme", "name": "Acme"}}
    assert _tenant(auth_user, "acme")["id"] == "tenant-a"
    with pytest.raises(HTTPException) as exc:
        _tenant(auth_user, "other")
    assert exc.value.status_code == 403
