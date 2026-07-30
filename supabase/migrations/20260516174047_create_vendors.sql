
CREATE TABLE vendors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  vendor_code    TEXT,
  address        TEXT,
  city           TEXT,
  state          TEXT,
  zip            TEXT,
  phone          TEXT,
  email          TEXT,
  account_number TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Seed known vendors from invoices
INSERT INTO vendors (name, vendor_code, address, city, state, zip, phone, account_number) VALUES
  ('US Foods, Inc.',          'USFOODS',    'P.O. Box 281838',          'Atlanta',         'GA', '30384', '800-275-5723', '41736679'),
  ('Multi-Flow Industries',   'MULTIFLOW',  '1434 County Line Road',    'Huntingdon Valley','PA','19006', '215-322-1800', 'MF207260'),
  ('Adams & Associates',      'ADAMS',      '6151 Lakeside Dr, Ste 1000','Reno',           'NV', '89511', '000-000-0000', NULL);
;
