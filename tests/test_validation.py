import json

import pytest
from flask import Flask

from backend.validation import validate_json


@pytest.fixture
def app():
    return Flask(__name__)


def test_validate_json_no_data(app):
    with app.test_request_context(content_type='application/json', data='{}'):
        schema = {
            'name': {'type': 'str', 'required': True},
        }
        is_valid, data, status = validate_json(schema)
        assert not is_valid
        assert status == 400


def test_validate_json_valid_data(app):
    with app.test_request_context(content_type='application/json', data=json.dumps({'name': 'test', 'age': 25})):
        schema = {
            'name': {'type': 'str', 'required': True},
            'age': {'type': 'int', 'required': True, 'min': 0, 'max': 150},
        }
        is_valid, data, status = validate_json(schema)
        assert is_valid
        assert data['name'] == 'test'
        assert data['age'] == 25


def test_validate_json_type_coercion(app):
    with app.test_request_context(content_type='application/json', data=json.dumps({'age': '25'})):
        schema = {
            'age': {'type': 'int', 'required': True},
        }
        is_valid, data, status = validate_json(schema)
        assert is_valid
        assert data['age'] == 25


def test_validate_json_enum(app):
    with app.test_request_context(content_type='application/json', data=json.dumps({'role': 'admin'})):
        schema = {
            'role': {'type': 'str', 'required': True, 'enum': ['admin', 'manager', 'staff']},
        }
        is_valid, data, status = validate_json(schema)
        assert is_valid
        assert data['role'] == 'admin'


def test_validate_json_enum_invalid(app):
    with app.test_request_context(content_type='application/json', data=json.dumps({'role': 'superadmin'})):
        schema = {
            'role': {'type': 'str', 'required': True, 'enum': ['admin', 'manager', 'staff']},
        }
        is_valid, data, status = validate_json(schema)
        assert not is_valid
