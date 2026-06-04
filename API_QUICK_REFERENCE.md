# API Quick Reference

**MJCC API v1.4.0** - Production-ready endpoints

## Quick Start

```bash
# Backend (port 8000)
cd backend && python main.py

# Test health
curl http://localhost:8000/health
```

## Authentication

All endpoints require `Authorization: Bearer <token>` header.

**Get token:**
```bash
# Admin/Manager (Supabase JWT)
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"access_token":"<supabase_jwt>"}'

# Staff (PIN-based)
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"john","pin":"1234"}'
```

**Verify token:**
```bash
curl http://localhost:8000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

---

## User Management (`/api/users` - Admin Only)

### List Users
```bash
GET /api/users
GET /api/users?active_only=true
```
Response: `{count: 2, users: [...]}`

### Get User
```bash
GET /api/users/{user_id}
```
Response: User object

### Create User
```bash
POST /api/users
Body: {
  "username": "maria_staff",
  "email": "maria@mjcc.local",
  "display_name": "Maria Garcia",
  "role": "staff",
  "pin": "1111"
}
```
Response: `201` Created user

### Update User
```bash
PUT /api/users/{user_id}
Body: {
  "role": "manager",
  "pin": "2222"
}
```
Response: `200` Updated user

### Disable User
```bash
DELETE /api/users/{user_id}
```
Response: `204` No content

---

## Inventory (`/api/inventory` - Any Auth)

### Get Latest
```bash
GET /api/inventory
```

### Get Specific Period
```bash
GET /api/inventory?month=6&year=2026
```

### Save Inventory
```bash
POST /api/inventory
Body: {
  "items": [
    {"sku": "SKU001", "desc": "Chicken", "onHand": 45, "par": 50, "category": "Proteins"},
    {"sku": "SKU002", "desc": "Oil", "onHand": 8, "par": 10, "category": "Oils"}
  ],
  "metadata": {"location": "Walk-in"},
  "notes": "Tuesday count"
}
```
Response: `201` Snapshot created

### Get History
```bash
GET /api/inventory/history?limit=5
```
Response: List of snapshots (latest first)

### Get Reorders
```bash
GET /api/inventory/reorders
```
Response: Items where `onHand < par`, sorted by shortage

---

## Logs (`/api/logs` - Any Auth)

### HACCP Temperature Logs

**Record check:**
```bash
POST /api/logs/haccp
Body: {
  "location": "Walk-in Cooler",
  "temperature": 38.5,
  "unit": "F",
  "timestamp": "2026-06-03T14:00:00Z",
  "checked_by": "John Doe",
  "notes": "Normal"
}
```
Response: `201` Log created

**Get logs:**
```bash
GET /api/logs/haccp
GET /api/logs/haccp?location=Walk-in%20Cooler
GET /api/logs/haccp?limit=20
```
Response: List of HACCP logs

### Daily Operations Logs

**Record entry:**
```bash
POST /api/logs/daily
Body: {
  "entry_type": "issue",
  "title": "Equipment failure",
  "description": "Ice machine broken",
  "severity": "error"
}
```
Response: `201` Log created

**Get logs:**
```bash
GET /api/logs/daily
GET /api/logs/daily?entry_type=issue
GET /api/logs/daily?severity=error
GET /api/logs/daily?limit=20
```
Response: List of daily logs

### Compliance Status
```bash
GET /api/logs/compliance
```
Response: Summary with status, counts, and recent logs

---

## Common Patterns

### Error Responses

```json
{
  "detail": "Error message"
}
```

Status codes:
- `200` - OK
- `201` - Created
- `204` - No content (delete)
- `400` - Bad request
- `401` - Unauthorized (bad/missing token)
- `403` - Forbidden (no permission)
- `404` - Not found
- `500` - Server error

### Pagination

Most list endpoints support `limit` query parameter:
```bash
GET /api/logs/haccp?limit=50  # Max results
```

### Filtering

Endpoints support optional filters:
```bash
GET /api/logs/daily?entry_type=issue&severity=error
GET /api/logs/haccp?location=Walk-in%20Cooler
```

---

## Full Docs

See `ENDPOINTS.md` for:
- Complete endpoint specifications
- Request/response examples
- All query parameters
- Supabase RLS policies
- 20+ curl testing examples

---

## Environment Setup

```bash
# .env file
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
PORT=8000
CORS_ORIGINS=http://localhost:5173
```

---

## Troubleshooting

**401 Unauthorized:**
- Token missing or invalid
- Token expired
- User disabled

**403 Forbidden:**
- User role insufficient
- PIN token used for admin endpoint

**404 Not Found:**
- Resource doesn't exist
- Inventory/logs never recorded

**500 Server Error:**
- Check backend logs
- Verify Supabase connection
- Check .env variables

---

**Last Updated:** 2026-06-03  
**Version:** 1.4.0
