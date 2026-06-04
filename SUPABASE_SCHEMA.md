# Supabase Schema Requirements

**MJCC API v1.4.0** - Database setup guide

This document defines the Supabase tables and migrations required for the API endpoints.

---

## Table 1: user_profiles

Stores user accounts, roles, and authentication info.

### Schema

```sql
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'staff'
    CHECK (role IN ('admin', 'manager', 'staff')),
  pin VARCHAR(10) DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_user_profiles_username ON user_profiles(username);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_active ON user_profiles(active);
```

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | Auto-generated |
| username | VARCHAR(50) | UNIQUE, NOT NULL | 3-50 chars, unique |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Valid email, unique |
| display_name | VARCHAR(100) | NOT NULL | User's full name |
| last_name | VARCHAR(100) | DEFAULT '' | Optional last name |
| role | VARCHAR(20) | DEFAULT 'staff' | admin/manager/staff |
| pin | VARCHAR(10) | DEFAULT NULL | Staff PIN (numeric) |
| active | BOOLEAN | DEFAULT true | Soft-delete flag |
| created_at | TIMESTAMP TZ | DEFAULT NOW() | Creation timestamp |
| updated_at | TIMESTAMP TZ | DEFAULT NOW() | Last update timestamp |

### Sample Data

```sql
INSERT INTO user_profiles (username, email, display_name, last_name, role, pin, active)
VALUES
  ('admin_user', 'admin@mjcc.local', 'Admin User', 'User', 'admin', NULL, true),
  ('john_staff', 'john@mjcc.local', 'John Doe', 'Doe', 'staff', '1234', true),
  ('jane_manager', 'jane@mjcc.local', 'Jane Smith', 'Smith', 'manager', '5678', true);
```

---

## Table 2: inventory_sync

Stores inventory snapshots with items and metadata.

### Schema

```sql
CREATE TABLE IF NOT EXISTS inventory_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  items JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  
  CONSTRAINT check_items_not_empty CHECK (jsonb_array_length(items) > 0)
);

-- Indexes for performance
CREATE INDEX idx_inventory_sync_created_at ON inventory_sync(created_at DESC);
CREATE INDEX idx_inventory_sync_created_by ON inventory_sync(created_by);
```

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | Auto-generated |
| items | JSONB | NOT NULL | Array of inventory items |
| metadata | JSONB | DEFAULT '{}' | Custom metadata |
| notes | TEXT | DEFAULT '' | Notes about snapshot |
| created_at | TIMESTAMP TZ | DEFAULT NOW() | Creation timestamp |
| created_by | UUID | REFERENCES user_profiles | Creator's user ID |

### Items Schema (JSONB)

Each item in the `items` array must have:

```json
{
  "sku": "SKU001",
  "desc": "Chicken Breasts",
  "onHand": 45,
  "par": 50,
  "category": "Proteins"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| sku | string | Yes | Stock Keeping Unit |
| desc | string | Yes | Item description |
| onHand | integer | Yes | Current quantity (≥0) |
| par | integer | Yes | Par level (≥0) |
| category | string | Yes | Item category |

### Sample Data

```sql
INSERT INTO inventory_sync (items, metadata, notes, created_by)
SELECT 
  jsonb_build_array(
    jsonb_build_object('sku', 'SKU001', 'desc', 'Chicken', 'onHand', 45, 'par', 50, 'category', 'Proteins'),
    jsonb_build_object('sku', 'SKU002', 'desc', 'Oil', 'onHand', 8, 'par', 10, 'category', 'Oils')
  ),
  jsonb_build_object('location', 'Walk-in', 'supplier', 'Main'),
  'Tuesday count',
  id
FROM user_profiles WHERE username = 'admin_user'
LIMIT 1;
```

---

## Table 3: haccp_logs

Stores HACCP temperature compliance logs.

### Schema

```sql
CREATE TABLE IF NOT EXISTS haccp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location VARCHAR(100) NOT NULL,
  temperature NUMERIC(5, 2) NOT NULL
    CHECK (temperature >= -50 AND temperature <= 150),
  unit VARCHAR(1) NOT NULL DEFAULT 'F'
    CHECK (unit IN ('F', 'C')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  checked_by VARCHAR(255) NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_location_timestamp UNIQUE (location, timestamp)
);

-- Indexes for performance
CREATE INDEX idx_haccp_logs_timestamp ON haccp_logs(timestamp DESC);
CREATE INDEX idx_haccp_logs_location ON haccp_logs(location);
CREATE INDEX idx_haccp_logs_created_at ON haccp_logs(created_at DESC);
```

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | Auto-generated |
| location | VARCHAR(100) | NOT NULL | e.g., "Walk-in Cooler" |
| temperature | NUMERIC(5,2) | -50 to 150 | Temperature reading |
| unit | VARCHAR(1) | DEFAULT 'F' | F (Fahrenheit) or C (Celsius) |
| timestamp | TIMESTAMP TZ | NOT NULL | Check timestamp (ISO 8601) |
| checked_by | VARCHAR(255) | NOT NULL | Person performing check |
| notes | TEXT | DEFAULT '' | Additional notes |
| created_at | TIMESTAMP TZ | DEFAULT NOW() | Log creation time |

### Sample Data

```sql
INSERT INTO haccp_logs (location, temperature, unit, timestamp, checked_by, notes)
VALUES
  ('Walk-in Cooler', 38.5, 'F', NOW(), 'John Doe', 'Temperature normal'),
  ('Hot Hold', 165.0, 'F', NOW() - INTERVAL '1 hour', 'Jane Smith', 'Holding at safe temp');
```

---

## Table 4: daily_operations_logs

Stores daily operations and compliance logs.

### Schema

```sql
CREATE TABLE IF NOT EXISTS daily_operations_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type VARCHAR(20) NOT NULL
    CHECK (entry_type IN ('inventory', 'prep', 'issue', 'other')),
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  severity VARCHAR(20) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug', 'info', 'warning', 'error')),
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_daily_logs_created_at ON daily_operations_logs(created_at DESC);
CREATE INDEX idx_daily_logs_entry_type ON daily_operations_logs(entry_type);
CREATE INDEX idx_daily_logs_severity ON daily_operations_logs(severity);
CREATE INDEX idx_daily_logs_created_by ON daily_operations_logs(created_by);
```

### Columns

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | Auto-generated |
| entry_type | VARCHAR(20) | inventory/prep/issue/other | Type of entry |
| title | VARCHAR(200) | NOT NULL | Short summary |
| description | TEXT | DEFAULT '' | Detailed description |
| severity | VARCHAR(20) | debug/info/warning/error | Severity level |
| created_by | UUID | REFERENCES user_profiles | Creator's user ID |
| created_at | TIMESTAMP TZ | DEFAULT NOW() | Creation timestamp |

### Sample Data

```sql
INSERT INTO daily_operations_logs (entry_type, title, description, severity, created_by)
SELECT 'issue', 'Freezer malfunction', 'Temp raised to 35F, maintenance called', 'error', id
FROM user_profiles WHERE username = 'admin_user' LIMIT 1;
```

---

## Row Level Security (RLS) Policies

Enable RLS on all tables to enforce authorization at the database level.

### Enable RLS

```sql
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_operations_logs ENABLE ROW LEVEL SECURITY;
```

### user_profiles Policies

```sql
-- Admins can read all users
CREATE POLICY "admin_read_all_users" ON user_profiles
FOR SELECT
USING (
  auth.uid() IN (
    SELECT id FROM user_profiles WHERE role = 'admin' AND active = true
  )
);

-- Users can read themselves
CREATE POLICY "user_read_self" ON user_profiles
FOR SELECT
USING (auth.uid() = id);

-- Only admins can create users
CREATE POLICY "admin_create_users" ON user_profiles
FOR INSERT
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM user_profiles WHERE role = 'admin' AND active = true
  )
);

-- Only admins can update users
CREATE POLICY "admin_update_users" ON user_profiles
FOR UPDATE
USING (
  auth.uid() IN (
    SELECT id FROM user_profiles WHERE role = 'admin' AND active = true
  )
);
```

### inventory_sync Policies

```sql
-- All authenticated users can read
CREATE POLICY "auth_read_inventory" ON inventory_sync
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Managers and admins can create
CREATE POLICY "manager_create_inventory" ON inventory_sync
FOR INSERT
WITH CHECK (
  auth.uid() IN (
    SELECT id FROM user_profiles 
    WHERE (role = 'manager' OR role = 'admin') AND active = true
  )
);
```

### haccp_logs Policies

```sql
-- All authenticated users can read and write
CREATE POLICY "auth_read_haccp" ON haccp_logs
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_create_haccp" ON haccp_logs
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
```

### daily_operations_logs Policies

```sql
-- All authenticated users can read and write
CREATE POLICY "auth_read_daily_logs" ON daily_operations_logs
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_create_daily_logs" ON daily_operations_logs
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);
```

---

## Migration Script

Run this script in Supabase SQL Editor to set up all tables:

```sql
-- Drop existing tables (if needed)
-- DROP TABLE IF EXISTS daily_operations_logs CASCADE;
-- DROP TABLE IF EXISTS haccp_logs CASCADE;
-- DROP TABLE IF EXISTS inventory_sync CASCADE;
-- DROP TABLE IF EXISTS user_profiles CASCADE;

-- Create user_profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) DEFAULT '',
  role VARCHAR(20) NOT NULL DEFAULT 'staff'
    CHECK (role IN ('admin', 'manager', 'staff')),
  pin VARCHAR(10) DEFAULT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_profiles_username ON user_profiles(username);
CREATE INDEX idx_user_profiles_email ON user_profiles(email);
CREATE INDEX idx_user_profiles_role ON user_profiles(role);
CREATE INDEX idx_user_profiles_active ON user_profiles(active);

-- Create inventory_sync
CREATE TABLE IF NOT EXISTS inventory_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  items JSONB NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES user_profiles(id)
);

CREATE INDEX idx_inventory_sync_created_at ON inventory_sync(created_at DESC);
CREATE INDEX idx_inventory_sync_created_by ON inventory_sync(created_by);

-- Create haccp_logs
CREATE TABLE IF NOT EXISTS haccp_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location VARCHAR(100) NOT NULL,
  temperature NUMERIC(5, 2) NOT NULL
    CHECK (temperature >= -50 AND temperature <= 150),
  unit VARCHAR(1) NOT NULL DEFAULT 'F'
    CHECK (unit IN ('F', 'C')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  checked_by VARCHAR(255) NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_haccp_logs_timestamp ON haccp_logs(timestamp DESC);
CREATE INDEX idx_haccp_logs_location ON haccp_logs(location);
CREATE INDEX idx_haccp_logs_created_at ON haccp_logs(created_at DESC);

-- Create daily_operations_logs
CREATE TABLE IF NOT EXISTS daily_operations_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type VARCHAR(20) NOT NULL
    CHECK (entry_type IN ('inventory', 'prep', 'issue', 'other')),
  title VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  severity VARCHAR(20) NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug', 'info', 'warning', 'error')),
  created_by UUID NOT NULL REFERENCES user_profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_daily_logs_created_at ON daily_operations_logs(created_at DESC);
CREATE INDEX idx_daily_logs_entry_type ON daily_operations_logs(entry_type);
CREATE INDEX idx_daily_logs_severity ON daily_operations_logs(severity);
CREATE INDEX idx_daily_logs_created_by ON daily_operations_logs(created_by);

-- Enable RLS
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_operations_logs ENABLE ROW LEVEL SECURITY;

-- Grant public access (adjust based on auth requirements)
GRANT ALL ON public.user_profiles TO authenticated;
GRANT ALL ON public.inventory_sync TO authenticated;
GRANT ALL ON public.haccp_logs TO authenticated;
GRANT ALL ON public.daily_operations_logs TO authenticated;
```

---

## Verification

After running migrations, verify tables exist:

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output:
- `daily_operations_logs`
- `haccp_logs`
- `inventory_sync`
- `user_profiles`

---

## Notes

1. **UUID Generation**: All IDs use `gen_random_uuid()` for security
2. **Timestamps**: All use `TIMESTAMP WITH TIME ZONE` for global consistency
3. **Foreign Keys**: `created_by` references `user_profiles(id)` with CASCADE deletes
4. **Constraints**: CHECK constraints enforce valid values at database level
5. **Indexes**: All frequently filtered/sorted columns are indexed
6. **RLS**: All tables have RLS enabled; define policies per your auth schema
7. **Backups**: Always backup before running migrations in production

---

**Last Updated:** 2026-06-03  
**Version:** 1.4.0
