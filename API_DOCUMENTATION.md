# MJCC Inventory Management API Documentation

## Overview
This document describes the REST API endpoints for the Miami Job Corps Cafeteria Inventory Management System.

## Base URL
```
/api/inventory
```

## Authentication
All endpoints require authentication via Bearer token in the Authorization header:
```
Authorization: Bearer <access_token>
```

## Error Responses
All endpoints return JSON error responses with the following format:
```json
{
  "error": "Error message"
}
```

HTTP status codes:
- 400: Bad Request (validation errors)
- 401: Not Authenticated
- 403: Insufficient Permissions
- 500: Internal Server Error

## Endpoints

### Get Inventory Summary
Retrieve summary statistics for a given month and year.

**GET** `/summary`

#### Query Parameters
| Parameter | Type   | Required | Description           |
|-----------|--------|----------|-----------------------|
| month     | int    | Yes      | Month (0-11)          |
| year      | int    | Yes      | Year (e.g., 2026)     |

#### Response
```json
{
  "grand_total": 1234.56,
  "starting_total": 1000.00,
  "wk1_total": 300.00,
  "wk2_total": 300.00,
  "wk3_total": 300.00,
  "wk4_total": 300.00,
  "total_items": 50,
  "reorder_count": 5,
  "category_breakdown": { ... },
  "reorder_alerts": [ ... ]
}
```

### Get Inventory Items
Retrieve inventory items for a given month and year with optional filtering and pagination.

**GET** `/items`

#### Query Parameters
| Parameter  | Type   | Required | Description                     |
|------------|--------|----------|---------------------------------|
| month      | int    | Yes      | Month (0-11)                    |
| year       | int    | Yes      | Year (e.g., 2026)               |
| category   | string | No       | Filter by category name         |
| page       | int    | No       | Page number (default: 1)        |
| per_page   | int    | No       | Items per page (default: 50, max: 100) |

#### Response
```json
{
  "items": [ ... ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total_count": 123,
    "total_pages": 3,
    "has_next": true,
    "has_prev": false
  }
}
```

### Update Inventory Item
Update a specific field for an inventory item.

**PATCH** `/items/<item_id>`

#### Request Body
```json
{
  "field": "on_hand",
  "value": 150,
  "month": 5,
  "year": 2026
}
```

#### Valid Fields
- on_hand, w1_issued, w2_issued, w3_issued, w4_issued
- w1_received, w2_received, w3_received, w4_received
- unit_price, par_level

#### Response
```json
{
  "item_total": 750.00,
  "ending_qty": 150
}
```

### Save Monthly Snapshot
Save the current inventory state as a monthly snapshot.

**POST** `/save-snapshot`

#### Request Body
```json
{
  "month": 5,
  "year": 2026
}
```

#### Response
```json
{
  "month": 5,
  "year": 2026,
  "grand_total": 1234.56,
  "starting_total": 1000.00,
  "wk1_total": 300.00,
  "wk2_total": 300.00,
  "wk3_total": 300.00,
  "wk4_total": 300.00,
  "saved_by": null
}
```

### Rollover Month
Roll over inventory to the next month, setting received/issued quantities to zero.

**POST** `/rollover`

#### Request Body
```json
{
  "from_month": 5,
  "from_year": 2026
}
```

#### Response
```json
{
  "next_month": 6,
  "next_year": 2026,
  "starting_total": 1234.56
}
```

### Get Monthly History
Retrieve historical monthly snapshots.

**GET** `/history`

#### Response
```json
[
  {
    "month": 5,
    "year": 2026,
    "grand_total": 1234.56,
    "starting_total": 1000.00,
    "wk1_total": 300.00,
    "wk2_total": 300.00,
    "wk3_total": 300.00,
    "wk4_total": 300.00,
    "saved_by": null
  }
]
```

### Get Categories with Item Counts
Retrieve all categories with their item counts.

**GET** `/categories`

#### Response
```json
[
  {
    "id": 1,
    "name": "Dairy",
    "display_name": "Dairy Products",
    "color": "#FF6B6B",
    "inventory_items": {
      "count": 12
    }
  }
]
```

### Parse Invoice Text/Image
Parse invoice text or image to match items with the catalog.

**POST** `/parse-invoice`

#### Request Body
```json
{
  "text": "INVOICE TEXT HERE",
  "month": 5,
  "year": 2026
}
```
OR
```json
{
  "image": "base64_encoded_image_data",
  "month": 5,
  "year": 2026
}
```

#### Response
```json
{
  "matches": [
    {
      "itemId": "123",
      "matchedDesc": "Milk 1 Gallon",
      "qty": 10,
      "unitPrice": 3.50
    }
  ]
}
```

### Apply Invoice Matches
Apply parsed invoice matches to inventory.

**POST** `/apply-invoice`

#### Request Body
```json
{
  "matches": [
    {
      "itemId": "123",
      "qty": 10
    }
  ],
  "week_field": "w1r",
  "month": 5,
  "year": 2026
}
```

#### Response
```json
{
  "applied": [
    {
      "item_id": "123",
      "qty": 10,
      "field": "w1_received"
    }
  ],
  "skipped": []
}
```

## Rate Limiting
API requests are rate limited to prevent abuse:
- Default: 100 requests per hour per IP address
- Limits can be configured via environment variables

## Security Features
- HTTPS recommended for production
- Secure HTTP headers (X-Content-Type-Options, X-Frame-Options, etc.)
- CORS restrictions in production
- Input validation on all endpoints
- Role-based access control (admin/manager/staff)

## Deployment
The API is designed to be deployed using:
- Gunicorn WSGI server
- Docker containerization
- Environment-based configuration