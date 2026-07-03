from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.routes.users import (
    _enforce_user_update_scope,
    _normalize_username,
    _require_staff_username_standard,
    _self_profile_update_data,
)


def _request(**fields):
    return SimpleNamespace(model_fields_set=set(fields), **fields)


def test_staff_self_profile_can_update_phone():
    data = _self_profile_update_data(
        _request(phone="305-555-0100"),
        {"role": "staff"},
    )

    assert data == {"phone": "305-555-0100"}


def test_staff_self_profile_cannot_update_identity_fields():
    with pytest.raises(HTTPException) as exc:
        _self_profile_update_data(
            _request(display_name="New Name", phone="305-555-0100"),
            {"role": "staff"},
        )

    assert exc.value.status_code == 403


def test_staff_self_profile_cannot_set_avatar_url_directly():
    with pytest.raises(HTTPException) as exc:
        _self_profile_update_data(
            _request(avatar_url="https://example.com/avatar.png"),
            {"role": "staff"},
        )

    assert exc.value.status_code == 403


def test_elevated_self_profile_can_update_identity_fields():
    data = _self_profile_update_data(
        _request(
            display_name="Manager", last_name="One", job_title="Lead", phone="305"
        ),
        {"role": "manager"},
    )

    assert data == {
        "display_name": "Manager",
        "last_name": "One",
        "job_title": "Lead",
        "phone": "305",
    }


def test_staff_username_standard_allows_lastname_firstname():
    _require_staff_username_standard("brissetts.pearline", "Brissetts", "Pearline")


def test_staff_username_standard_rejects_nonstandard_name():
    with pytest.raises(HTTPException) as exc:
        _require_staff_username_standard("pearline", "Brissetts", "Pearline")

    assert exc.value.status_code == 400


def test_username_normalization_allows_dot_format():
    assert _normalize_username(" Brissetts.Pearline ") == "brissetts.pearline"


def test_manager_can_update_staff_credentials():
    req = _request(new_username="brissetts.pearline", new_password="password123")

    actor_is_sudo = _enforce_user_update_scope(
        req,
        {"id": "staff-1", "role": "staff"},
        {"id": "manager-1", "role": "manager"},
    )

    assert actor_is_sudo is False


def test_manager_cannot_update_non_staff_user():
    with pytest.raises(HTTPException) as exc:
        _enforce_user_update_scope(
            _request(new_password="password123"),
            {"id": "manager-2", "role": "manager"},
            {"id": "manager-1", "role": "manager"},
        )

    assert exc.value.status_code == 403


def test_manager_self_update_allows_password_only():
    actor_is_sudo = _enforce_user_update_scope(
        _request(new_password="password123"),
        {"id": "manager-1", "role": "manager"},
        {"id": "manager-1", "role": "manager"},
    )

    assert actor_is_sudo is False


def test_manager_self_update_rejects_username_change():
    with pytest.raises(HTTPException) as exc:
        _enforce_user_update_scope(
            _request(new_username="grant.roshaun"),
            {"id": "manager-1", "role": "manager"},
            {"id": "manager-1", "role": "manager"},
        )

    assert exc.value.status_code == 403
