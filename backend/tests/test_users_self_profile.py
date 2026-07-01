from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.routes.users import _self_profile_update_data


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
