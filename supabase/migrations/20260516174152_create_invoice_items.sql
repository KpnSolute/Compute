
CREATE TABLE invoice_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sku                 TEXT,
  description         TEXT NOT NULL,
  category            TEXT,
  label               TEXT,
  pack_size           TEXT,
  unit                TEXT DEFAULT 'CS',
  quantity_ordered    NUMERIC(10,2) DEFAULT 0,
  quantity_shipped    NUMERIC(10,2) DEFAULT 0,
  quantity_adjusted   NUMERIC(10,2) DEFAULT 0,
  unit_price          NUMERIC(10,4) DEFAULT 0,
  extended_price      NUMERIC(12,2) DEFAULT 0,
  pricing_unit        TEXT,
  weight              NUMERIC(10,2),
  lot_numbers         TEXT[],
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inv_items_invoice  ON invoice_items(invoice_id);
CREATE INDEX idx_inv_items_sku      ON invoice_items(sku);
CREATE INDEX idx_inv_items_category ON invoice_items(category);
CREATE INDEX idx_inv_items_desc     ON invoice_items USING gin(to_tsvector('english', description));

-- Seed US Foods #2312098 key line items (beverages + cereal + snacks + dairy that match inventory)
INSERT INTO invoice_items (invoice_id, sku, description, category, label, pack_size, unit, quantity_ordered, quantity_shipped, unit_price, extended_price)
SELECT i.id, s.sku, s.description, s.category, s.label, s.pack_size, s.unit,
       s.qty, s.qty, s.unit_price, s.unit_price * s.qty
FROM invoices i,
(VALUES
  ('1004662','CEREAL, OTML RLD QUICK CNSTR','Cereal','QUAKER','12/42 OZ','CS',1,46.61),
  ('1142470','GRITS, CORN WHT QUICK BAG SHLF','Cereal','QUAKER','8/5 LB','CS',2,32.93),
  ('4177739','CEREAL, FRT WHIRL RING BULK','Cereal','HOSPITALTY','4/35 OZ','CS',1,23.50),
  ('5177738','CEREAL, CORN FLK FRTD BULK','Cereal','HOSPITALTY','4/35 OZ','CS',1,23.55),
  ('9422965','CEREAL, GRNLA OAT & HONY +O','Cereal','CASCADIAN','4/44 OZ','CS',2,50.96),
  ('4336202','WATER, SPRG PLST BTL','Beverages','ZEPHYRHILS','48/8 OZ','CS',10,10.86),
  ('6328033','DRINK MIX, ORNG 2 GAL YLD PWDR','Beverages','THIRSTER','12/24 OZ','CS',1,45.32),
  ('3208931','COOKIE, SNDWH OREO CHOC SS','Snacks','OREO','120/2/.78 OZ','CS',2,28.19),
  ('9315094','CHIP, PTATO BBQ SS','Snacks','LAYS','104/1 OZ','CS',2,43.61),
  ('1315134','CHIP, PTATO SOUR CRM & ONION','Snacks','LAYS','104/1 OZ','CS',2,43.61),
  ('3017886','SNACK BAR, GRNLA PNT BUTR SS','Snacks','NATURE VLY','144/.74 OZ','CS',1,35.61),
  ('3340510','CHEESE, AMER SLCD 120 CT TFF','Dairy','GLNVW FRMS','4/5 LB','CS',1,50.57),
  ('2382414','CHEESE, MOZZ PROV 5 BLND PREM','Dairy','ROSELI','4/5 LB','CS',2,54.33),
  ('5022914','CHEESE, CRM PLN SPRED SS PLST','Dairy','GLNVW FRMS','100/1 OZ','CS',2,21.33),
  ('6712970','CHEESE, PARM & IMIT BLND GRTD','Dairy','DELICATZZA','2/5 LB','CS',1,39.13),
  ('7340979','CREAM, WHPG HVY 36% BUTRFT UHT','Dairy','GLNVW FRMS','12/1 QT','CS',1,44.63),
  ('827428','EGG, HARD CKD PLD WHL REF EXP','Dairy','GLNVW FRMS','12/1 DZ','CS',1,28.75),
  ('823005','EGG, SHL X-LG GRD AA WHT LOOS','Dairy','GLNVW FRMS','15 DZ','CS',3,18.04),
  ('762047','MILK, 2% REDUC FAT PSTRD RBST','Dairy','GLNVW FRMS','5 GA','CS',3,33.97),
  ('2739175','SOUR CREAM, CLTD ALL NTRL TUB','Dairy','GLNVW FRMS','4/5 LB','CS',1,26.41)
) AS s(sku,description,category,label,pack_size,unit,qty,unit_price)
WHERE i.invoice_number = '2312098';

-- Seed Multi-Flow #861848 beverages
INSERT INTO invoice_items (invoice_id, sku, description, category, label, unit, quantity_shipped, unit_price, extended_price)
SELECT i.id, s.sku, s.description, 'Beverages', 'MULTI-FLOW', 'CS',
       s.qty, s.unit_price, s.qty * s.unit_price
FROM invoices i,
(VALUES
  ('F00000030','COFFEE GOURMET BLEND REGULAR',1,118.00),
  ('F00000031','COFFEE GOURMET DECAF',1,118.00),
  ('F00072501','MF FRUIT PUNCH DRINK 5+1',4,61.00),
  ('F00321005','MF TEI GREEN TEA W/MANGO',4,47.70),
  ('F00331005','MF TEI UNSWEETENED BLACK',1,34.70),
  ('F00332005','MF TEI SOUTHERN SWEET BL',4,47.70),
  ('F00403005','MF HARVESTSQUEEZE CLASSIC LEMONADE',2,43.70),
  ('F00480038','MF CRANBERRY FUSION 13%',4,55.70),
  ('F00481038','MF ORANGE JUICE FUSION 5',4,78.50),
  ('F00523005','MF NOURISH H2O STRAWBERRY',1,36.70),
  ('F00528005','MF NOURISH H2O BLUEBERRY-PO',1,36.70),
  ('F00928037','MF PASSIONFRUIT ORANGE GUAV',4,55.70)
) AS s(sku,description,qty,unit_price)
WHERE i.invoice_number = '861848';

-- Seed Multi-Flow #864172
INSERT INTO invoice_items (invoice_id, sku, description, category, label, unit, quantity_shipped, unit_price, extended_price)
SELECT i.id, s.sku, s.description, 'Beverages', 'MULTI-FLOW', 'CS',
       s.qty, s.unit_price, s.qty * s.unit_price
FROM invoices i,
(VALUES
  ('F00004037','MF APPLE JUICE 100% 4+1',2,71.70),
  ('F00186037','MF ORANGE SPORT DRINK 3G',2,36.70),
  ('F00416005','MF HARVEST SQUEEZE PINK',2,43.70)
) AS s(sku,description,qty,unit_price)
WHERE i.invoice_number = '864172';

-- Seed Multi-Flow #864236
INSERT INTO invoice_items (invoice_id, sku, description, category, label, unit, quantity_shipped, unit_price, extended_price)
SELECT i.id, 'F00416005', 'MF HARVEST SQUEEZE PINK', 'Beverages', 'MULTI-FLOW', 'CS', 2, 43.70, 87.40
FROM invoices i WHERE i.invoice_number = '864236';
;
