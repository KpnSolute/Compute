import math


def api_response(data, meta=None):
    return {'data': data, 'error': None, 'meta': meta}


def error_response(message, errors=None, status_code=400):
    return ({'data': None, 'error': message, 'errors': errors}, status_code)


def paginated_response(data, page, per_page, total):
    total_pages = max(1, math.ceil(total / per_page)) if per_page > 0 else 1
    return {
        'data': data,
        'error': None,
        'meta': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'total_pages': total_pages,
            'has_next': page < total_pages,
            'has_prev': page > 1,
        },
    }


def created_response(data):
    return ({'data': data, 'error': None, 'meta': None}, 201)
