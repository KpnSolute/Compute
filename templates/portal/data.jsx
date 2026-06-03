/* ══════════════════════════════════════════════════════════════
   Mock data + icons. Mirrors the real backend contract:
   - users have {username, display_name, last_name, role, pin/password, active}
   - roles: staff(10) assistant(20) manager(30) admin(40)
   - auth flow: staff -> PIN, admin/manager/assistant -> password
   Exported to window for the other babel scripts.
═══════════════════════════════════════════════════════════════ */
const { useState, useEffect, useRef } = React;

/* ---- Icons (stroke, 24-box) ---- */
const I = {};
const mk = (paths) => (props={}) => React.createElement('svg', {
  viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2,
  strokeLinecap:'round', strokeLinejoin:'round', ...props
}, paths.map((d,i)=>React.createElement('path',{key:i,d})));
const mkRaw = (children) => (props={}) => React.createElement('svg', {
  viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:2,
  strokeLinecap:'round', strokeLinejoin:'round', ...props
}, children);

I.grid      = mk(['M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z']);
I.box       = mkRaw([React.createElement('path',{key:0,d:'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'}),React.createElement('path',{key:1,d:'M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12'})]);
I.calendar  = mkRaw([React.createElement('rect',{key:0,x:3,y:4,width:18,height:18,rx:2}),React.createElement('path',{key:1,d:'M16 2v4M8 2v4M3 10h18'})]);
I.branch    = mkRaw([React.createElement('line',{key:0,x1:6,y1:3,x2:6,y2:15}),React.createElement('circle',{key:1,cx:18,cy:6,r:3}),React.createElement('circle',{key:2,cx:6,cy:18,r:3}),React.createElement('path',{key:3,d:'M18 9a9 9 0 0 1-9 9'})]);
I.archive   = mkRaw([React.createElement('rect',{key:0,x:2,y:4,width:20,height:5,rx:1}),React.createElement('path',{key:1,d:'M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M10 13h4'})]);
I.users     = mkRaw([React.createElement('path',{key:0,d:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'}),React.createElement('circle',{key:1,cx:9,cy:7,r:4}),React.createElement('path',{key:2,d:'M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'})]);
I.settings  = mkRaw([React.createElement('circle',{key:0,cx:12,cy:12,r:3}),React.createElement('path',{key:1,d:'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z'})]);
I.qr        = mk(['M3 3h7v7H3zM14 3h4v4h-4zM18 3h3M21 3v4M3 14h4v4H3zM14 14h3v3h-3zM20 14h1M14 20h7M21 17v4M3 18v3h3']);
I.dollar    = mk(['M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6']);
I.alert     = mkRaw([React.createElement('path',{key:0,d:'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'}),React.createElement('path',{key:1,d:'M12 9v4M12 17h.01'})]);
I.pkg       = I.box;
I.up        = mk(['M18 15l-6-6-6 6']);
I.down      = mk(['M6 9l6 6 6-6']);
I.check     = mk(['M20 6 9 17l-5-5']);
I.checkCircle = mkRaw([React.createElement('path',{key:0,d:'M22 11.08V12a10 10 0 1 1-5.93-9.14'}),React.createElement('path',{key:1,d:'M22 4 12 14.01l-3-3'})]);
I.logout    = mk(['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9']);
I.user      = mkRaw([React.createElement('path',{key:0,d:'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'}),React.createElement('circle',{key:1,cx:12,cy:7,r:4})]);
I.lock      = mkRaw([React.createElement('rect',{key:0,x:3,y:11,width:18,height:11,rx:2}),React.createElement('path',{key:1,d:'M7 11V7a5 5 0 0 1 10 0v4'})]);
I.eye       = mkRaw([React.createElement('path',{key:0,d:'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z'}),React.createElement('circle',{key:1,cx:12,cy:12,r:3})]);
I.eyeOff    = mk(['M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20']);
I.del       = mk(['M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2']);
I.plus      = mk(['M12 5v14M5 12h14']);
I.edit      = mk(['M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z']);
I.search    = mkRaw([React.createElement('circle',{key:0,cx:11,cy:11,r:8}),React.createElement('path',{key:1,d:'m21 21-4.35-4.35'})]);
I.bell      = mk(['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0']);
I.scan      = mk(['M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10']);
I.download  = mk(['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3']);
I.clock     = mkRaw([React.createElement('circle',{key:0,cx:12,cy:12,r:10}),React.createElement('path',{key:1,d:'M12 6v6l4 2'})]);
I.trend     = mk(['M23 6l-9.5 9.5-5-5L1 18M17 6h6v6']);
I.shield    = mk(['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z']);
I.cloud     = mk(['M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z']);
I.x         = mk(['M18 6 6 18M6 6l12 12']);
I.refresh   = mk(['M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15']);
I.database  = mkRaw([React.createElement('ellipse',{key:0,cx:12,cy:5,rx:9,ry:3}),React.createElement('path',{key:1,d:'M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0'})]);
I.menu      = I.calendar;
I.thermo    = mkRaw([React.createElement('path',{key:0,d:'M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z'})]);
I.clipboard = mkRaw([React.createElement('path',{key:0,d:'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'}),React.createElement('rect',{key:1,x:8,y:2,width:8,height:4,rx:1})]);
I.inbox     = mkRaw([React.createElement('path',{key:0,d:'M22 12h-6l-2 3h-4l-2-3H2'}),React.createElement('path',{key:1,d:'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'})]);
I.flame     = mkRaw([React.createElement('path',{key:0,d:'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z'})]);
I.snow      = mk(['M12 2v20M17 5l-5 3-5-3M17 19l-5-3-5 3M2 12h20M5 7l3 5-3 5M19 7l-3 5 3 5']);
I.droplet   = mkRaw([React.createElement('path',{key:0,d:'M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z'})]);
I.save      = mkRaw([React.createElement('path',{key:0,d:'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z'}),React.createElement('path',{key:1,d:'M17 21v-8H7v8M7 3v5h8'})]);
I.printer   = mkRaw([React.createElement('path',{key:0,d:'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'}),React.createElement('rect',{key:1,x:6,y:14,width:12,height:8,rx:1})]);
I.chevL     = mk(['M15 18l-6-6 6-6']);
I.chevR     = mk(['M9 18l6-6-6-6']);
I.coffee    = mkRaw([React.createElement('path',{key:0,d:'M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z'}),React.createElement('path',{key:1,d:'M6 1v3M10 1v3M14 1v3'})]);
I.fileText  = mkRaw([React.createElement('path',{key:0,d:'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'}),React.createElement('path',{key:1,d:'M14 2v6h6M16 13H8M16 17H8M10 9H8'})]);
I.checkSquare = mkRaw([React.createElement('path',{key:0,d:'M9 11l3 3L22 4'}),React.createElement('path',{key:1,d:'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'})]);
I.calCheck  = mkRaw([React.createElement('rect',{key:0,x:3,y:4,width:18,height:18,rx:2}),React.createElement('path',{key:1,d:'M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4'})]);
I.book      = mkRaw([React.createElement('path',{key:0,d:'M4 19.5A2.5 2.5 0 0 1 6.5 17H20'}),React.createElement('path',{key:1,d:'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'})]);
I.award     = mkRaw([React.createElement('circle',{key:0,cx:12,cy:8,r:6}),React.createElement('path',{key:1,d:'M15.477 12.89 17 22l-5-3-5 3 1.523-9.11'})]);

window.I = I;

/* ---- Mock users (passwords/PINs are demo-only) ---- */
const USERS = [
  { id:'u-admin',  username:'amartin', display_name:'Angela',  last_name:'Martin',   role:'admin',     pin:null,   password:'kpn2026', active:true },
  { id:'u-mgr',    username:'dcortez', display_name:'Daniel',  last_name:'Cortez',   role:'manager',   pin:null,   password:'kpn2026', active:true },
  { id:'u-asst',   username:'lprice',  display_name:'Lena',    last_name:'Price',    role:'assistant', pin:null,   password:'kpn2026', active:true },
  { id:'u-staff',  username:'rkhan',   display_name:'Rasheed', last_name:'Khan',     role:'staff',     pin:'4729', password:null,      active:true },
  { id:'u-staff2', username:'mlopez',  display_name:'Maria',   last_name:'Lopez',    role:'staff',     pin:'1080', password:null,      active:true },
  { id:'u-asst2',  username:'tobrien', display_name:'Tara',    last_name:"O'Brien",  role:'assistant', pin:null,   password:'kpn2026', active:false },
];
const ROLE_LEVEL = { staff:10, assistant:20, manager:30, admin:40 };
const ROLE_LABEL = { staff:'Staff', assistant:'Assistant', manager:'Manager', admin:'Administrator' };

/* mock /api/auth/login */
function mockLogin({ username, type, pin, password }){
  username = (username||'').trim().toLowerCase();
  if(!username) return { ok:false, status:400, error:'Username is required.' };
  const u = USERS.find(x=>x.username===username);
  if(!u) return { ok:false, status:401, error:'Username not recognised.' };
  if(!u.active) return { ok:false, status:403, error:'Account is disabled.' };
  if(type==='staff'){
    if(u.role!=='staff') return { ok:false, status:401, error:'Admin & manager accounts must use the Admin / Manager login.' };
    if(!pin) return { ok:false, status:400, error:'PIN is required.' };
    if(pin!==u.pin) return { ok:false, status:401, error:'Incorrect PIN. Please try again.' };
  } else if(type==='admin'){
    if(!['admin','manager','assistant'].includes(u.role)) return { ok:false, status:401, error:'Staff accounts must use the Staff login.' };
    if(!password) return { ok:false, status:400, error:'Password is required.' };
    if(password!==u.password) return { ok:false, status:401, error:'Incorrect password. Please try again.' };
  } else return { ok:false, status:400, error:'Invalid login type.' };
  return { ok:true, user:{ id:u.id, username:u.username, display_name:u.display_name, last_name:u.last_name, role:u.role } };
}

/* ---- Period ---- */
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ---- Demo inventory (grouped like the offline dashboard's dynamic
   spreadsheet) — used when not connected to Supabase. Item shape mirrors
   the dashboard: {id,sku,desc,price,onHand,par,w1i..w4i,w1r..w4r}. ---- */
let _did = 0;
const di = (sku,desc,price,onHand,par,w1r=0,w2r=0,w3r=0,w4r=0,w1i=0,w2i=0,w3i=0,w4i=0)=>
  ({ id:'d'+(++_did), sku, desc, price, onHand, par, w1i, w2i, w3i, w4i, w1r, w2r, w3r, w4r });
const DEMO_INV = {
  Dairy: [
    di('899807','BUTTER, UNSLTD SOLID AA GRD',83.68,0,2,2,0,0,0,0,1,0,0),
    di('3340510','CHEESE, AMER SLCD 120 CT TFF',50.57,2,2,1,1,0,0,0,1,0,0),
    di('1332642','CHEESE, CHEDR MILD SHRD BAG',51.24,0,2,2,1,0,0,0,1,0,0),
    di('823005','EGG, SHL X-LG GRD AA WHT LOOS',18.37,0,2,3,2,0,0,0,2,0,0),
    di('762047','MILK, 2% REDUC FAT PSTRD RBST',35.36,0,2,3,2,0,0,0,3,0,0),
    di('7340979','CREAM, WHPG HVY 36% BUTRFT UHT',49.04,0,2,1,1,0,0,0,0,0,0),
  ],
  'Protein & Meat': [
    di('7640667','SANDWICH, PBJ WG IW',42.10,3,2,1,0,0,0,0,1,0,0),
    di('8873029','FISH, COD FLLT BRD OVN RDY',61.24,1,2,2,1,0,0,1,0,0,0),
    di('5519021','CHICKEN, BRST FILET BRD WG',58.90,2,3,2,2,0,0,1,1,0,0),
    di('4420118','BEEF, PATTY 80/20 4OZ FRZ',72.45,1,2,1,1,0,0,0,1,0,0),
  ],
  'Produce & Fresh': [
    di('3310221','LETTUCE, ROMAINE HEART 6CT',24.80,2,3,2,2,0,0,1,1,0,0),
    di('3310557','TOMATO, ROMA BULK 25LB',31.10,1,2,1,1,0,0,1,0,0,0),
    di('3310990','APPLE, FUJI 88CT FRESH',38.20,3,3,1,2,0,0,1,1,0,0),
  ],
  'Dry Goods': [
    di('2210884','RICE, LONG GRAIN ENR 25LB',22.40,4,3,1,1,0,0,1,1,0,0),
    di('2211002','PASTA, PENNE ROTINI 20LB',19.75,2,2,1,1,0,0,1,0,0,0),
    di('2211345','FLOUR, ALL PURPOSE 50LB',16.30,3,2,0,1,0,0,1,0,0,0),
  ],
  'Frozen Foods': [
    di('6610223','VEGETABLE, MIXED BLEND 30LB',28.60,2,2,1,1,0,0,1,0,0,0),
    di('6610778','POTATO, CRINKLE CUT FRY 30LB',26.15,1,2,2,1,0,0,1,1,0,0),
  ],
  Beverages: [
    di('4410332','JUICE, ORANGE 96OZ CTN',18.90,2,2,1,1,0,0,1,0,0,0),
    di('4410876','MILK, CHOC 2% 48/8OZ',24.94,1,2,2,2,0,0,2,0,0,0),
  ],
  Supplies: [
    di('4311649','MITT, OVN 15IN PYRTX BLK',14.34,0,0,0,1,0,0,0,0,0,0),
    di('9723966','THERMOMETER, ALRGN CMPCT FLDNG',16.56,0,0,0,2,0,0,0,0,0,0),
    di('9331034','TONG, SCLPD 9.5IN S/S HD',5.83,0,0,0,3,0,0,0,0,0,0),
  ],
};

/* ---- Compliance reference data (from MJCC HACCP forms) ---- */
const COOKING_TEMPS = [
  { temp:'165°F (74°C)', hold:'15 sec', foods:'Poultry (solid & ground); stuffed foods; dishes with previously cooked PHF ingredients.' },
  { temp:'155°F (68°C)', hold:'15 sec', foods:'Ground meats (beef, pork, veal, lamb, fish); pork steaks & chops; injected meats; game; shell eggs for hot holding.' },
  { temp:'155°F (68°C)', hold:'22 sec', foods:'Pork roasts.' },
  { temp:'145°F (63°C)', hold:'15 sec', foods:'Beef, veal, lamb steaks & chops; seafood; shell eggs for immediate service; pasteurized egg dishes.' },
  { temp:'145°F (63°C)', hold:'4 min',  foods:'Beef, veal and lamb roasts.' },
  { temp:'140°F (60°C)', hold:'15 sec', foods:'Commercially processed, ready-to-eat food heated for first time, to be hot-held for service.' },
  { temp:'135°F (57°C)', hold:'45 min', foods:'Roast beef (record internal temperature).' },
];
const TASTE_CODES = [
  { code:'A', label:'Excellent', tint:'#15803D', bg:'#F0FDF4' },
  { code:'B', label:'Acceptable — recipe review needed', tint:'#CA8A04', bg:'#FEFCE8' },
  { code:'C', label:'Corrective action required', tint:'#D97706', bg:'#FEF3C7' },
  { code:'D', label:'Rejected — product may not be served', tint:'#DC2626', bg:'#FEF2F2' },
];
const INSPECTION_Q = [
  'Rate the quality and taste of food (freshness / nutritional value)',
  'Serving portions offered (availability of seconds / serving temp.)',
  'Variety of food offered (minimum of two main entrées at each meal)',
  'Presentation and appearance of food (eye appeal)',
  'Availability / appearance / variety of soup and salad bar offering',
  'Availability of salt, pepper and napkins',
  'Availability of condiments (ketchup, mustard, mayonnaise, butter, etc.)',
  'Availability of clean glasses, cups, dishes, silverware',
  'Availability of fresh fruit',
  'Availability of beverages (milk / juice / soda)',
  'Availability of breads, rolls, etc.',
  'Cleanliness and appearance of Food Services staff',
  'Friendliness and courtesy shown by Food Services staff',
  'Rate the level of student satisfaction and response to the meal',
  'Rate the overall cleanliness and appearance of the dining hall',
];
const FOODREQ_FIELDS = [
  { k:'originator', label:"Originator's Name", type:'text', col:6 },
  { k:'date',       label:'Date', type:'date', col:3 },
  { k:'dept',       label:'Department', type:'text', col:6 },
  { k:'ext',        label:'Center Extension #', type:'text', col:3 },
  { k:'eventDate',  label:'Date of Event', type:'date', col:4 },
  { k:'eventTime',  label:'Time', type:'time', col:4 },
  { k:'students',   label:'# of Students', type:'number', col:2 },
  { k:'staff',      label:'# of Staff', type:'number', col:2 },
  { k:'location',   label:'Location of Event (include Room #)', type:'text', col:8 },
  { k:'theme',      label:'Event Theme or Purpose', type:'text', col:4 },
  { k:'food',       label:'Type & Amount of Food Requested', type:'textarea', col:12 },
  { k:'drinks',     label:'Type & Amount of Drinks Requested', type:'textarea', col:6 },
  { k:'other',      label:'Other Items Requested', type:'textarea', col:6 },
];
const MEAL_COLS = ['Breakfast','Lunch','Dinner'];

/* ---- Navigation (role-gated by minimum level) ---- */
const NAV = [
  { group:'Overview', items:[
    { key:'dashboard',  label:'Dashboard',         icon:'grid',        min:10 },
  ]},
  { group:'Data Entry', items:[
    { key:'inventory',  label:'Inventory',         icon:'box',         min:10 },
    { key:'moninv',     label:'Monthly Inventory', icon:'fileText',    min:20 },
    { key:'mballot',    label:'Meal Log',          icon:'users',       min:10 },
    { key:'foodreq',    label:'Food Request',      icon:'inbox',       min:10 },
    { key:'barcodes',   label:'Barcodes & Scan',   icon:'qr',          min:10 },
  ]},
  { group:'Logs', items:[
    { key:'haccp',      label:'HACCP & Logs',      icon:'thermo',      min:10 },
    { key:'dailyops',   label:'Daily Operations',  icon:'checkSquare', min:10 },
    { key:'inspection', label:'Inspection Sheet',  icon:'clipboard',   min:20 },
    { key:'snackbar',   label:'Snack Bar',         icon:'coffee',      min:10 },
  ]},
  { group:'Calendar', items:[
    { key:'events',     label:'Events & Programs', icon:'calCheck',    min:10 },
    { key:'menu',       label:'28-Day Menu',       icon:'book',        min:20 },
  ]},
  { group:'Records', items:[
    { key:'sourcectrl', label:'Source Control',    icon:'branch',      min:10, badge:'pending' },
    { key:'reports',    label:'Reports',           icon:'download',    min:30 },
    { key:'archives',   label:'Archives',          icon:'archive',     min:20 },
  ]},
  { group:'Administration', items:[
    { key:'users',      label:'Users & Access',    icon:'users',       min:40 },
    { key:'settings',   label:'Settings',          icon:'settings',    min:40 },
  ]},
];

/* ---- Dashboard mock figures ---- */
const STATS = [
  { key:'value', label:'Inventory On-Hand Value', val:'$18,420', icon:'dollar', tint:'#1E73E8', bg:'#EFF5FE', delta:'+5.4%', dir:'up', sub:'vs. last period' },
  { key:'items', label:'Active Line Items',       val:'214',     icon:'box',    tint:'#1B3A6B', bg:'#EEF2F8', delta:'+9',    dir:'up', sub:'tracked this period' },
  { key:'low',   label:'Below Par Level',         val:'31',      icon:'alert',  tint:'#D97706', bg:'#FEF3C7', delta:'-6',    dir:'dn', sub:'flagged for reorder' },
  { key:'pend',  label:'Received This Week',       val:'$4,180',  icon:'download', tint:'#059669', bg:'#F0FDF4', delta:'Week 2', dir:'eq', sub:'' },
];
const CATEGORIES = [
  { name:'Protein & Meat',  color:'#B91C1C', val:'$5,840', pct:84 },
  { name:'Dairy',           color:'#0D9488', val:'$3,920', pct:57 },
  { name:'Produce & Fresh', color:'#15803D', val:'$2,610', pct:38 },
  { name:'Dry Goods',       color:'#92400E', val:'$2,180', pct:31 },
  { name:'Frozen Foods',    color:'#0369A1', val:'$1,760', pct:25 },
  { name:'Beverages',       color:'#2563EB', val:'$1,310', pct:19 },
];
const ACTIVITY = [
  { who:'Daniel Cortez', role:'manager',   what:'committed', detail:'Week 2 received counts — Protein & Meat', hash:'a3f91c', when:'12 min ago', icon:'branch', tint:'#6D28D9', bg:'#EDE9FE' },
  { who:'Rasheed Khan',  role:'staff',     what:'submitted', detail:'On-hand update awaiting review', hash:null, when:'48 min ago', icon:'clock', tint:'#D97706', bg:'#FEF3C7' },
  { who:'Lena Price',    role:'assistant', what:'applied invoice', detail:'SYSCO #88421 — 14 items matched', hash:'b7e220', when:'2 hrs ago', icon:'download', tint:'#1E73E8', bg:'#EFF5FE' },
  { who:'Angela Martin', role:'admin',     what:'published', detail:'April 2026 snapshot archived', hash:'5c1d04', when:'Yesterday', icon:'archive', tint:'#059669', bg:'#F0FDF4' },
  { who:'Maria Lopez',   role:'staff',     what:'scanned', detail:'23 items via barcode session', hash:null, when:'Yesterday', icon:'scan', tint:'#0E7490', bg:'#CFFAFE' },
];
const INVENTORY_SAMPLE = [
  { sku:'899807',  desc:'BUTTER, UNSLTD SOLID AA GRD',     cat:'Dairy',           price:83.68, onHand:0,  par:2, unit:'cs', status:'low' },
  { sku:'3340510', desc:'CHEESE, AMER SLCD 120 CT TFF',    cat:'Dairy',           price:50.57, onHand:2,  par:2, unit:'cs', status:'ok' },
  { sku:'823005',  desc:'EGG, SHL X-LG GRD AA WHT LOOS',   cat:'Dairy',           price:18.37, onHand:0,  par:2, unit:'cs', status:'low' },
  { sku:'762047',  desc:'MILK, 2% REDUC FAT PSTRD RBST',   cat:'Dairy',           price:35.36, onHand:0,  par:2, unit:'cs', status:'low' },
  { sku:'7640667', desc:'SANDWICH, PBJ WG IW',             cat:'Protein & Meat',  price:42.10, onHand:3,  par:2, unit:'cs', status:'ok' },
  { sku:'8873029', desc:'FISH, COD FLLT BRD OVN RDY',      cat:'Protein & Meat',  price:61.24, onHand:1,  par:2, unit:'cs', status:'low' },
  { sku:'4311649', desc:'MITT, OVN 15IN PYRTX BLK',        cat:'Supplies',        price:14.34, onHand:0,  par:0, unit:'ea', status:'ok' },
  { sku:'9723966', desc:'THERMOMETER, ALRGN CMPCT FLDNG',  cat:'Supplies',        price:16.56, onHand:0,  par:0, unit:'ea', status:'ok' },
];

Object.assign(window, {
  USERS, ROLE_LEVEL, ROLE_LABEL, mockLogin, MONTHS, NAV, STATS, CATEGORIES, ACTIVITY, INVENTORY_SAMPLE,
  COOKING_TEMPS, TASTE_CODES, INSPECTION_Q, FOODREQ_FIELDS, MEAL_COLS,
});
// NOTE: DEMO_INV / DEMO_HISTORY / demoInvFor come from inventory_data.js
// (the real May-2026 invoice build). Do not export the placeholder here.
