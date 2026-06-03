/* ══════════════════════════════════════════════════════════════
   SOP reference data — drives the new portal modules:
   Cycle Menu · Events & Programs · Daily Operations · Snack Bar.
   Plain JS (no JSX). Loaded before the babel component scripts.
═══════════════════════════════════════════════════════════════ */

/* ── 28-Day Cycle Menu (week template, Miami JCC) ── */
const CYCLE_MENU = {
  Mon: {
    Breakfast: [{qty:80,item:'Boiled Egg',desc:'Well-done boiled egg'},{qty:50,item:'Bacon',desc:'Pork bacon'},{qty:50,item:'Breakfast Sausage',desc:'Pork link'},{qty:60,item:'White Toast'},{qty:60,item:'Wheat Toast'},{qty:60,item:'Breakfast Potatoes'},{qty:60,item:'French Toast'},{qty:60,item:'Pastry / Scone'},{qty:60,item:'Bagels'},{qty:60,item:'Biscuit'}],
    Lunch: [{qty:55,item:'Herb Pork Chop',desc:'Pork chop w/ herb cream sauce'},{qty:60,item:'Korean Chicken',desc:'Oven-roasted, Korean BBQ sauce'},{qty:10,item:'Vegetarian option'}],
    Dinner: [{qty:80,item:'Lemon Garlic Tilapia',desc:'Pan-fried w/ lemon garlic sauce'},{qty:80,item:'Curry Chicken',desc:'West Indian stew chicken w/ curry'},{qty:10,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Banana','Potato Chips','Apple','Orange']
  },
  Tue: {
    Breakfast: [{qty:160,item:'Scrambled Egg',desc:'Well-done scramble'},{qty:50,item:'Bacon'},{qty:50,item:'Breakfast Sausage'},{qty:60,item:'White Toast'},{qty:60,item:'Wheat Toast'},{qty:60,item:'Breakfast Potatoes'},{qty:60,item:'French Toast'},{qty:60,item:'Pastry / Scone'},{qty:60,item:'Bagels'},{qty:60,item:'Biscuit'}],
    Lunch: [{qty:80,item:'Chef Special Lunch'},{qty:10,item:'Vegetarian option'}],
    Dinner: [{qty:80,item:'Chef Special Dinner'},{qty:10,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Banana','Potato Chips']
  },
  Wed: {
    Breakfast: [{qty:160,item:'Cheese Scramble',desc:'Well-done cheese scramble'},{qty:50,item:'Bacon'},{qty:50,item:'Breakfast Sausage'},{qty:60,item:'White Toast'},{qty:60,item:'Wheat Toast'},{qty:60,item:'Breakfast Potatoes'},{qty:60,item:'French Toast'},{qty:60,item:'Pastry / Scone'},{qty:60,item:'Bagels'},{qty:60,item:'Biscuit'}],
    Lunch: [{qty:80,item:'Brown Stew Chicken',desc:'Stew chicken w/ brown gravy'},{qty:80,item:'Shrimp Alfredo',desc:'Pasta w/ shrimp in creamy sauce'},{qty:60,item:'Vegetarian',desc:'Vegetables in tomato sauce'}],
    Dinner: [{qty:80,item:'Chicken Parmesan',desc:'Chicken breast, marinara, mozzarella'},{qty:80,item:'Fried Cod',desc:'Beer-battered cod'},{qty:60,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Apple','Chips']
  },
  Thu: {
    Breakfast: [{qty:160,item:'Egg Casserole',desc:'Well-done egg casserole'},{qty:50,item:'Bacon'},{qty:50,item:'Breakfast Sausage'},{qty:60,item:'White Toast'},{qty:60,item:'Wheat Toast'},{qty:60,item:'Breakfast Potatoes'},{qty:60,item:'French Toast'},{qty:60,item:'Pastry / Scone'},{qty:60,item:'Bagels'},{qty:60,item:'Biscuit'}],
    Lunch: [{qty:80,item:'Memphis BBQ Ribs',desc:'BBQ pork ribs'},{qty:80,item:'Sausage & Peppers',desc:'Bratwurst w/ peppers'},{qty:60,item:'Veggie Burger',desc:'Veggie protein patty'}],
    Dinner: [{qty:80,item:'Crusted Cod',desc:'Baked crusted cod fish'},{qty:80,item:'Chicken Marsala',desc:'Pan-fried chicken w/ Marsala sauce'},{qty:60,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Banana','Chips']
  },
  Fri: {
    Breakfast: [{qty:160,item:'Boiled Egg'},{qty:50,item:'Bacon'},{qty:50,item:'Breakfast Sausage'},{qty:60,item:'White Toast'},{qty:60,item:'Wheat Toast'},{qty:60,item:'Breakfast Potatoes'},{qty:60,item:'French Toast'},{qty:60,item:'Pastry / Scone'},{qty:60,item:'Bagels'},{qty:60,item:'Biscuit'}],
    Lunch: [{qty:80,item:'Chicken Burrito Bowl',desc:'Chicken strips on rice w/ toppings'},{qty:80,item:'Fish Sandwich',desc:'Fried fish w/ tartar sauce'},{qty:60,item:'Beef Taco',desc:'Ground beef on soft shell'},{qty:10,item:'Vegetarian Burrito Bowl'}],
    Dinner: [{qty:80,item:'Tuscan Chicken',desc:'Pan-fried chicken w/ creamy sauce'},{qty:80,item:'Tuna Casserole',desc:'Pasta in cheese tuna sauce'},{qty:60,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Apple','Orange','Chips']
  },
  Sat: {
    Brunch: [{qty:80,item:'Bagel Sandwich',desc:'Bagel, egg and cheese'},{qty:60,item:'Chef Special'},{qty:60,item:'Scrambled Egg'},{qty:60,item:'Bacon'},{qty:60,item:'Breakfast Sausage'}],
    Dinner: [{qty:80,item:'Saturday Chef Special Dinner'},{qty:10,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Banana','Chips']
  },
  Sun: {
    Brunch: [{qty:80,item:'Sunday Brunch Special'},{qty:10,item:'Vegetarian option'}],
    Dinner: [{qty:80,item:'Sunday Chef Special Dinner'},{qty:10,item:'Vegetarian option'}],
    Snack: ['Granola Bar','Apple','Banana']
  }
};
const MENU_SIDES = {
  Mon:{Lunch:['Herb Roasted Potato','Chef Veggies','Steamed Jasmine Rice','Pasta Ala Vodka','Garden Salad — Ranch','Garden Salad — LF Italian','Special Salad'],Dinner:['Garlic Mash','Chef Vegetable','Fried Plantains','Brown Rice','Garden Salad — Ranch','Garden Salad — LF Italian']},
  Wed:{Lunch:['Pigeon Peas Rice','Chef Vegetable','Herb Butter Pasta','Sweet Potato Wedges','Garden Salad — Ranch'],Dinner:['Spaghetti Noodle','Chef Veggies','Hush Puppies','Brown Rice']},
  Thu:{Lunch:['Sweet Potato Mash','Chef Veggies','Fresh Tomato Pasta','Spanish Rice','Garden Salad — Ranch'],Dinner:['Pesto Cream Pasta','Chef Vegetable','Sweet Potato Hash','Brown Rice']},
  Fri:{Lunch:['Chef Veggies','Corn Kernel','Black Beans','Steamed Rice','Garden Salad — Ranch'],Dinner:['Potato Medley','Chef Veggies','Rolls','Herb Rice']}
};
const DOW_FULL = { Mon:'Monday', Tue:'Tuesday', Wed:'Wednesday', Thu:'Thursday', Fri:'Friday', Sat:'Saturday', Sun:'Sunday' };
const DOW_KEYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

/* ── Event categories (institutional palette) ── */
const CAT_META = {
  cultural: { label:'Cultural / Diversity Meal', color:'#6D28D9', bg:'#EDE9FE', dot:'#7C3AED' },
  special:  { label:'Special Event',             color:'#1660C8', bg:'#EFF5FE', dot:'#1E73E8' },
  training: { label:'Staff Training / ServSafe', color:'#166534', bg:'#F0FDF4', dot:'#059669' },
  heals:    { label:'HEALs Program',             color:'#9A3412', bg:'#FFF7ED', dot:'#EA580C' },
  other:    { label:'Other',                     color:'#475569', bg:'#F1F5F9', dot:'#64748B' },
};

const EVENTS = [
  // ── Cultural / Diversity meals — 12-month calendar ──
  {id:1, cat:'cultural', title:'Asian Heritage Dinner', date:'2026-01-29', theme:'Asian Heritage', desc:'Vegetable fried rice, beef or tofu stir-fry, spring rolls, egg drop soup, fortune cookies, jasmine tea. Lanterns & chopstick place settings. Coordinate with the Diversity / Multi-Cultural Awareness Committee.', suggestedMenu:'Fried Rice · Beef/Tofu Stir-Fry · Spring Rolls · Egg Drop Soup · Fortune Cookies · Jasmine Tea', status:'planned'},
  {id:2, cat:'cultural', title:'Black History Month Celebration Meal', date:'2026-02-26', theme:'Black History Month', desc:'Fried chicken, collard greens, mac & cheese, cornbread, sweet potato pie, lemonade. Recognize student & staff achievements. Historical figures display in the dining hall.', suggestedMenu:'Fried Chicken · Collard Greens · Mac & Cheese · Cornbread · Sweet Potato Pie · Lemonade', status:'planned'},
  {id:3, cat:'cultural', title:'Mardi Gras Celebration Dinner', date:'2026-03-26', theme:'Mardi Gras', desc:'Shrimp étouffée, red beans & rice, jambalaya, beignets, king cake, jazz playlist. Purple, gold & green decorations; beads and festive settings.', suggestedMenu:'Shrimp Étouffée · Red Beans & Rice · Jambalaya · Cornbread · Beignets · King Cake', status:'planned'},
  {id:4, cat:'cultural', title:'Earth Day Green & Clean Meal', date:'2026-04-30', theme:'Earth Day', desc:'Plant-forward menu highlighting sustainable, seasonal produce. Roasted vegetable grain bowl, salad bar feature, lentil soup, fruit smoothies, whole grain rolls.', suggestedMenu:'Roasted Vegetable Grain Bowl · Lentil Soup · Garden Salad Feature · Whole Grain Rolls · Seasonal Fruit · Infused Water', status:'planned'},
  {id:5, cat:'cultural', title:'Haitian Flag Day Dinner', date:'2026-05-28', theme:'Haitian Flag Day', desc:'Celebrate Haitian Flag Day (May 18). Griot, rice & peas (diri ak pwa), pikliz, plantains (banan peze), soup joumou. Red & blue decorations; Haitian flag displayed.', suggestedMenu:'Griot · Diri ak Pwa · Banan Peze · Pikliz · Soup Joumou · Haitian Rum Cake', status:'planned'},
  {id:6, cat:'cultural', title:'Middle Eastern Cuisine Night', date:'2026-06-25', theme:'Middle Eastern', desc:'Chicken shawarma, falafel, hummus & pita, tabbouleh, basmati rice, baklava, mint tea. Maps & cultural facts displayed. Vegetarian options prominently featured.', suggestedMenu:'Chicken Shawarma · Falafel · Hummus & Pita · Tabbouleh · Basmati Rice · Baklava · Mint Tea', status:'planned'},
  {id:7, cat:'cultural', title:'4th of July Independence Day BBQ', date:'2026-07-30', theme:'4th of July', desc:'American cookout. Burgers, hot dogs, BBQ ribs, corn on the cob, coleslaw, baked beans, watermelon, apple pie. Per SOP: holiday = two meals + healthy snacks.', suggestedMenu:'Burgers & Hot Dogs · BBQ Ribs · Corn on the Cob · Coleslaw · Baked Beans · Watermelon · Apple Pie', status:'planned'},
  {id:8, cat:'cultural', title:'Taste of Chicago Dinner', date:'2026-08-27', theme:'Taste of Chicago', desc:'Inspired by the Chicago food festival. Deep dish pizza, Chicago hot dogs, Italian beef, cheese fries, Italian lemon ice. Skyline decorations.', suggestedMenu:'Deep Dish Pizza · Chicago-Style Hot Dogs · Italian Beef · Cheese Fries · Italian Lemon Ice · Chicago Mix Popcorn', status:'planned'},
  {id:9, cat:'cultural', title:'Taste of the Islands Dinner', date:'2026-09-24', theme:'Taste of the Islands', desc:'Caribbean flavors. Jerk chicken, curry goat, oxtail stew, rice & peas, fried plantains, festival, sorrel drink, coconut cake. Steel drum playlist.', suggestedMenu:'Jerk Chicken · Curry Goat · Rice & Peas · Fried Plantains · Festival · Sorrel Drink · Coconut Cake', status:'planned'},
  {id:10, cat:'cultural', title:'Hispanic Heritage Month Dinner', date:'2026-10-29', theme:'Hispanic Heritage', desc:'Hispanic Heritage Month (Sept 15 – Oct 15). Pernil, arroz con gandules, tostones, ceviche, tres leches cake, horchata. Flags of Hispanic nations displayed.', suggestedMenu:'Pernil · Arroz con Gandules · Tostones · Black Beans · Ceviche · Tres Leches Cake · Horchata', status:'planned'},
  {id:11, cat:'cultural', title:'Thanksgiving Special Dinner', date:'2026-11-26', theme:'Thanksgiving', desc:'Traditional feast. Roast turkey, cornbread stuffing, mashed potatoes & gravy, candied yams, green bean casserole, cranberry sauce, pumpkin & apple pie. Gratitude wall.', suggestedMenu:'Roast Turkey · Cornbread Stuffing · Mashed Potatoes · Candied Yams · Green Bean Casserole · Cranberry Sauce · Pumpkin Pie', status:'planned'},
  {id:12, cat:'cultural', title:'Holiday Season Celebration Dinner', date:'2026-12-31', theme:'Holiday Season', desc:'End-of-year celebration. Glazed ham, beef tenderloin, mac & cheese, sweet potato casserole, dinner rolls, cookie assortment, eggnog, hot cocoa.', suggestedMenu:'Glazed Ham · Beef Tenderloin · Mac & Cheese · Sweet Potato Casserole · Dinner Rolls · Cookie Assortment · Eggnog', status:'planned'},

  // ── Special events ──
  {id:20, cat:'special', title:'Community Relations Luncheon', date:'2026-05-14', desc:'Quarterly luncheon for community partners and stakeholders. Meal tickets waived by DOL Regional Office. Submit Food Request Form FA510.01c at least 10 days prior.', status:'planned'},
  {id:21, cat:'special', title:'SGA Food Services Committee Meeting', date:'2026-05-07', desc:'Monthly SGA Food Services Committee meeting. Food Services Manager / Supervisor must attend. Record & maintain minutes.', status:'planned'},
  {id:22, cat:'special', title:'SGA Food Services Committee Meeting', date:'2026-06-04', desc:'Monthly SGA Food Services Committee meeting.', status:'planned'},
  {id:24, cat:'special', title:'Graduation Celebration Dinner', date:'2026-06-25', desc:'Special dinner for graduating students and families. Submit Food Request Form FA510.01c at least 10 days prior.', status:'planned'},
  {id:25, cat:'special', title:'Off-Center Activity — Sack Lunches', date:'2026-05-22', desc:'Submit Food Request Form at least 2 working days in advance. Include student names, destination, and return time.', status:'planned'},
  {id:27, cat:'special', title:'4th of July Holiday BBQ', date:'2026-07-04', desc:'Actual Independence Day holiday cookout. Per SOP: holiday = two meals + healthy snacks. Red, white & blue decorations.', status:'planned'},

  // ── Staff training / ServSafe ──
  {id:30, cat:'training', title:'ServSafe Manager Recertification', date:'2026-07-15', desc:'Food Services Manager / Supervisor must be ServSafe Proctor certified. Coordinate with HR to track expiration dates.', status:'planned'},
  {id:31, cat:'training', title:'New Staff ServSafe 90-Day Deadline', date:'2026-06-01', desc:'All food services staff must be ServSafe certified within 90 days of employment per company SOP.', status:'planned'},
  {id:32, cat:'training', title:'HACCP Annual Procedures Review', date:'2026-05-28', desc:'Annual review of all HACCP critical control points, daily temperature logs, and corrective action procedures.', status:'planned'},
  {id:33, cat:'training', title:'Food Safety & Sanitation Training', date:'2026-08-10', desc:'Annual refresher on local, state, and federal sanitation codes. All food service staff required.', status:'planned'},
  {id:35, cat:'training', title:'Quarterly Safety Inspection', date:'2026-06-15', desc:'Safety & Security Manager inspects kitchen, dining hall, culinary arts classroom, and snack bar. Results filed with Food Services Manager, Admin Director and Center Director.', status:'planned'},

  // ── HEALs program ──
  {id:40, cat:'heals', title:'HEALs Committee Meeting', date:'2026-05-21', desc:'Monthly meeting: Health & Wellness Mgr, Food Services Mgr, Recreation Supervisor, TEAP Specialist, Social Development Director, student reps.', status:'planned'},
  {id:44, cat:'heals', title:'HEALs Committee Meeting & No-Soda Day', date:'2026-04-16', desc:'Monthly HEALs committee meeting (3rd Thursday). No-soda day. Plan Earth Day meal coordination (Apr 30) and spring wellness activities.', status:'planned'},
  {id:45, cat:'heals', title:'HEALs Committee Meeting', date:'2026-06-18', desc:'Monthly HEALs committee meeting.', status:'planned'},
  {id:46, cat:'heals', title:'Nutrition Education Workshop', date:'2026-06-09', desc:'Student nutrition session — MyPlate guidelines, reading food labels, healthy snack choices.', status:'planned'},
  {id:47, cat:'heals', title:'Active Lifestyle Day', date:'2026-06-20', desc:'Collaborative event with Recreation Dept: healthy outdoor meal, fitness activities, wellness info tables.', status:'planned'},
  {id:49, cat:'heals', title:'Farm-to-Table Feature Week', date:'2026-09-08', desc:'Week-long focus on fresh, locally-sourced produce. Menus feature seasonal vegetables and whole grains.', status:'planned'},
];

/* ServSafe staff certification tracker */
const SERVSAFE_STAFF = [
  {name:'Food Services Manager / Supervisor', cert:'ServSafe Manager', expiry:'2026-08-15', proctor:true},
  {name:'Assistant Manager',                  cert:'ServSafe Food Handler', expiry:'2026-11-30', proctor:false},
  {name:'Cook 1',                             cert:'ServSafe Food Handler', expiry:'2027-02-10', proctor:false},
  {name:'Cook 2',                             cert:'ServSafe Food Handler', expiry:'2026-06-01', proctor:false},
  {name:'Assistant Cook',                     cert:'ServSafe Food Handler', expiry:'2026-12-20', proctor:false},
  {name:'Food Services Assistant 1',          cert:'ServSafe Food Handler', expiry:'2027-01-05', proctor:false},
  {name:'WBL Student (Culinary)',             cert:'Pending (90-day deadline)', expiry:'', proctor:false},
];

/* ── Daily Operations defaults ── */
const OPENING_CHECKLIST = [
  'Walk-in cooler temp check (≤41°F)',
  'Freezer temp check (≤0°F)',
  'Sanitizer solution prepared & tested',
  'Staff sign-in confirmed',
  'Food broken out (48-hr thaw)',
  'Dining hall sanitized',
  'Salad bar set up & stocked',
  'ServSafe postings current',
];
const MEAL_SCHEDULE = [
  {meal:'Breakfast',  hours:'6:30 – 7:45 AM',     monitor:'Social Dev. Shift Mgr',   open:6,  close:8},
  {meal:'Lunch',      hours:'11:00 AM – 1:00 PM', monitor:'Safety & Security Mgr',   open:11, close:13},
  {meal:'Dinner',     hours:'4:30 – 6:00 PM',     monitor:'Social Dev. Shift Mgr',   open:16, close:18},
  {meal:'Eve. Snack', hours:'8:00 – 9:00 PM',     monitor:'Social Dev. Staff',       open:20, close:21},
];
const INCIDENT_TYPES = [
  'Dining hall behavior issue','Missing meal ticket','Food quality complaint',
  'Temperature violation','Unauthorized kitchen access','Other',
];

/* ── Snack Bar reference (SOP) ── */
const SNACK_HOURS = [
  {day:'Monday – Friday', lunch:'11:15 AM – 12:20 PM', eve:'Mon 5–7 PM · Tue–Thu 5–9:30 PM · Fri 5–11:30 PM'},
  {day:'Saturday',        lunch:'—',                   eve:'1:00 – 11:30 PM'},
  {day:'Sunday',          lunch:'—',                   eve:'1:00 – 9:30 PM'},
  {day:'Holidays',        lunch:'Center Director\u2019s decision', eve:''},
];
const MEAL_RATES = [
  {meal:'Breakfast', rate:'$2.50'},
  {meal:'Brunch (weekends & holidays)', rate:'$2.50'},
  {meal:'Lunch', rate:'$2.50'},
  {meal:'Dinner', rate:'$2.50'},
];

/* Diner classification (old log parity) — Monitors & Comp guests eat free */
const MEAL_TYPES = [
  { key:'Staff',   label:'Staff',      paid:true },
  { key:'Visitor', label:'Visitor',    paid:true },
  { key:'Monitor', label:'Monitor',    paid:false },
  { key:'Comp',    label:'Comp guest', paid:false },
];

Object.assign(window, {
  CYCLE_MENU, MENU_SIDES, DOW_FULL, DOW_KEYS,
  CAT_META, EVENTS, SERVSAFE_STAFF,
  OPENING_CHECKLIST, MEAL_SCHEDULE, INCIDENT_TYPES,
  SNACK_HOURS, MEAL_RATES, MEAL_TYPES,
});

/* ── Source Control — staging pipeline + commit history ──
   Mirrors the repo role model: staff submissions go to staging for
   manager/admin review; assistant+ auto-commit. After every commit the
   app syncs inventory snapshots to the MJCC-Portal/mjcc data store. */
const STAGED_CHANGES = [
  { id:'st1', author:'Rasheed Khan', username:'rkhan', role:'staff', type:'On-hand update',
    summary:'Adjusted on-hand counts — Protein & Meat (Week 2)', items:6, submittedAt:'2026-05-21T09:14:00', status:'pending' },
  { id:'st2', author:'Maria Lopez', username:'mlopez', role:'staff', type:'Barcode scan session',
    summary:'Scanned 23 items into Dairy & Beverages', items:23, submittedAt:'2026-05-21T08:02:00', status:'pending' },
  { id:'st3', author:'Rasheed Khan', username:'rkhan', role:'staff', type:'New item',
    summary:'Added THERMOMETER, ALRGN CMPCT FLDNG to Supplies', items:1, submittedAt:'2026-05-20T16:41:00', status:'pending' },
];
const COMMITS = [
  { hash:'a3f91c', author:'Daniel Cortez', role:'manager', message:'Week 2 received counts — Protein & Meat', files:14, add:128, del:12, when:'2026-05-21T07:55:00', synced:true },
  { hash:'b7e220', author:'Lena Price', role:'assistant', message:'Applied invoice SYSCO #88421 — 14 items matched', files:14, add:96, del:4, when:'2026-05-20T15:22:00', synced:true },
  { hash:'5c1d04', author:'Angela Martin', role:'admin', message:'Published April 2026 snapshot to archive', files:186, add:0, del:0, when:'2026-05-01T10:08:00', synced:true },
  { hash:'9e4a77', author:'Daniel Cortez', role:'manager', message:'Reconciled monthly inventory closing — May', files:42, add:54, del:18, when:'2026-04-30T18:30:00', synced:true },
  { hash:'2b81f0', author:'Lena Price', role:'assistant', message:'Updated par levels across Frozen Foods', files:9, add:9, del:9, when:'2026-04-28T11:47:00', synced:true },
];
const SUBMIT_TYPES = ['On-hand update','Received counts','New item','Par-level change','Barcode scan session','Menu change'];

/* Vendor invoices for the period (backend: GET /invoices?period=) */
const MONTHLY_INVOICES = [
  { id:'iv1', vendor:'SYSCO South Florida', number:'88421',    date:'2026-05-06', items:14, total:3184.22 },
  { id:'iv2', vendor:'US Foods',            number:'AA-50912', date:'2026-05-13', items:9,  total:1842.90 },
  { id:'iv3', vendor:'Cheney Brothers',     number:'CB-7741',  date:'2026-05-20', items:6,  total:996.40 },
];

Object.assign(window, { STAGED_CHANGES, COMMITS, SUBMIT_TYPES, MONTHLY_INVOICES });
