import json
import re
from typing import Any, Dict

from flask import jsonify, request


def validate_json(schema: Dict[str, Any]) -> tuple:
    """
    Validate JSON request data against a schema.

    Returns:
        tuple: (is_valid, validated_data_or_error_response, status_code)
    """
    data = request.get_json(silent=True) or {}
    errors = {}
    validated = {}

    for field, rules in schema.items():
        value = data.get(field)
        required = rules.get('required', False)

        if required and (value is None or value == ''):
            errors[field] = f'{field} is required'
            continue

        if value is None and not required:
            validated[field] = None
            continue

        expected_type = rules.get('type')
        if expected_type:
            type_map = {'str': str, 'int': int, 'float': float, 'bool': bool, 'list': list, 'dict': dict}

            if expected_type in type_map:
                try:
                    if expected_type == 'int' and isinstance(value, str):
                        value = int(value)
                    elif expected_type == 'float' and isinstance(value, str):
                        value = float(value)
                    elif expected_type == 'bool' and isinstance(value, str):
                        value = value.lower() in ('true', '1', 'yes', 'on')
                    elif expected_type == 'list' and isinstance(value, str):
                        value = json.loads(value)
                    elif expected_type == 'dict' and isinstance(value, str):
                        value = json.loads(value)

                    if not isinstance(value, type_map[expected_type]):
                        errors[field] = f'{field} must be of type {expected_type}'
                        continue
                except (ValueError, TypeError, json.JSONDecodeError):
                    errors[field] = f'{field} must be of type {expected_type}'
                    continue

        if isinstance(value, (int, float)):
            if 'min' in rules and value < rules['min']:
                errors[field] = f'{field} must be at least {rules["min"]}'
                continue
            if 'max' in rules and value > rules['max']:
                errors[field] = f'{field} must be at most {rules["max"]}'
                continue

        if isinstance(value, (str, list)):
            if 'min' in rules and len(value) < rules['min']:
                errors[field] = f'{field} must be at least {rules["min"]} characters long'
                continue
            if 'max' in rules and len(value) > rules['max']:
                errors[field] = f'{field} must be at most {rules["max"]} characters long'
                continue

        if 'enum' in rules and value not in rules['enum']:
            errors[field] = f'{field} must be one of: {", ".join(map(str, rules["enum"]))}'
            continue

        if 'pattern' in rules and isinstance(value, str):
            if not re.match(rules['pattern'], value):
                errors[field] = f'{field} does not match required pattern'
                continue

        if 'custom' in rules:
            is_valid, error_msg = rules['custom'](value)
            if not is_valid:
                errors[field] = error_msg
                continue

        validated[field] = value

    if errors:
        return False, jsonify({'errors': errors}), 400

    return True, validated, None


# ── Schemas ───────────────────────────────────────────────────────────

INVENTORY_ITEM_UPDATE_SCHEMA = {
    'field': {
        'type': 'str',
        'required': True,
        'enum': [
            'onHand', 'w1i', 'w2i', 'w3i', 'w4i', 'w1r', 'w2r', 'w3r', 'w4r', 'price', 'par',
            'on_hand', 'w1_issued', 'w2_issued', 'w3_issued', 'w4_issued',
            'w1_received', 'w2_received', 'w3_received', 'w4_received',
            'unit_price', 'par_level',
        ],
    },
    'value': {'required': True},
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

ITEM_CREATE_SCHEMA = {
    'sku': {'type': 'str', 'required': True, 'min': 1, 'max': 50},
    'description': {'type': 'str', 'required': True, 'min': 1, 'max': 200},
    'unit_price': {'type': 'float', 'required': True, 'min': 0},
    'category_id': {'type': 'str', 'required': False},
    'par_level': {'type': 'float', 'required': False},
    'unit': {'type': 'str', 'required': False},
}

INVOICE_PARSE_SCHEMA = {
    'text': {'type': 'str', 'required': True},
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

INVOICE_APPLY_SCHEMA = {
    'matches': {'type': 'list', 'required': True},
    'week_field': {'type': 'str', 'required': True, 'enum': ['w1r', 'w2r', 'w3r', 'w4r']},
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

SAVE_SNAPSHOT_SCHEMA = {
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

ROLLOVER_SCHEMA = {
    'from_month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'from_year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

PENDING_SUBMIT_SCHEMA = {
    'item_id': {'type': 'str', 'required': True},
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
    'week_number': {'type': 'int', 'required': True, 'min': 1, 'max': 4},
    'field': {'type': 'str', 'required': True, 'enum': ['received', 'issued']},
    'action': {'type': 'str', 'required': True, 'enum': ['Pull', 'Enter']},
    'value': {'type': 'float', 'required': True, 'min': 0},
}

PUBLISH_SCHEMA = {
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
}

COMMIT_PUSH_SCHEMA = {
    'message': {'type': 'str', 'required': False},
    'branch': {'type': 'str', 'required': False},
}

BARCODE_EXPORT_SCHEMA = {
    'item_ids': {'type': 'list', 'required': True},
    'format': {'type': 'str', 'required': True, 'enum': ['PDF', 'JPEG']},
    'quantity': {'type': 'int', 'required': False, 'min': 1, 'max': 100},
}

SETTINGS_UPDATE_SCHEMA = {
    'key': {'type': 'str', 'required': True},
    'value': {'required': True},
}

CREATE_VERSION_SCHEMA = {
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
    'label': {'type': 'str', 'required': False},
}
