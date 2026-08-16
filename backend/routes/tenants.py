"""Workspace discovery for authenticated KpnCompute users."""

from fastapi import APIRouter, Depends

from backend.routes._deps import _get_auth_user

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


@router.get("")
async def list_tenants(auth_user: dict = Depends(_get_auth_user)):
    return {
        "current": auth_user.get("tenant"),
        "workspaces": auth_user.get("workspaces") or [],
    }


@router.get("/current")
async def current_tenant(auth_user: dict = Depends(_get_auth_user)):
    return auth_user.get("tenant")
