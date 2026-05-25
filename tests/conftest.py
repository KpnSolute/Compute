import pytest


@pytest.fixture
def sample_item():
    return {
        'item_id': '123',
        'sku': 'MILK-001',
        'description': 'Milk 1 Gallon',
        'category': 'Dairy',
        'category_color': '#FF6B6B',
        'unit_price': '3.50',
        'on_hand': '50',
        'par_level': '40',
        'w1_received': '10',
        'w2_received': '0',
        'w3_received': '5',
        'w4_received': '0',
        'w1_issued': '20',
        'w2_issued': '15',
        'w3_issued': '10',
        'w4_issued': '5',
    }


@pytest.fixture
def sample_items(sample_item):
    item2 = dict(sample_item)
    item2.update(
        {
            'item_id': '456',
            'sku': 'BREAD-001',
            'description': 'Bread Loaf',
            'category': 'Dry Goods',
            'category_color': '#4ECDC4',
            'unit_price': '2.25',
            'on_hand': '10',
            'par_level': '30',
            'w1_received': '20',
            'w2_received': '0',
            'w3_received': '0',
            'w4_received': '15',
            'w1_issued': '5',
            'w2_issued': '10',
            'w3_issued': '8',
            'w4_issued': '2',
        }
    )
    return [sample_item, item2]
