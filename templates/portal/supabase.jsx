/* ══════════════════════════════════════════════════════════════
   Supabase service layer — wires the portal to the SAME backend the
   offline dashboard uses. Direct client-side access via Project URL
   + anon key (stored in localStorage, shared with the dashboard).

   Mirrors backend/routes/auth.py exactly:
     • table  : user_profiles (id, username, display_name, last_name, role, pin, active)
     • admin/manager/assistant → supabase.auth.signInWithPassword({email,password})
     • staff  → read profile, compare PIN (bcrypt if "$2…", else plaintext)
     • email  : {username}@mjc-cafeteria.com   (sudo → sudo@mjc.local)
   Inventory pulled from inventory_sync row id=1 → data.liveInventory.
═══════════════════════════════════════════════════════════════ */

/* localStorage keys — identical to the dashboard so config is shared */
const SUPA_URL_KEY = 'mjc_supa_url';
const SUPA_KEY_KEY = 'mjc_supa_key';

function getSupaConfig(){
  try{
    return {
      url: (localStorage.getItem(SUPA_URL_KEY) || '').trim(),
      key: (localStorage.getItem(SUPA_KEY_KEY) || '').trim(),
    };
  }catch(e){ return { url:'', key:'' }; }
}
function saveSupaConfig(url, key){
  try{
    localStorage.setItem(SUPA_URL_KEY, (url||'').trim());
    localStorage.setItem(SUPA_KEY_KEY, (key||'').trim());
  }catch(e){}
  _client = null; // force rebuild
}
function clearSupaConfig(){
  try{ localStorage.removeItem(SUPA_URL_KEY); localStorage.removeItem(SUPA_KEY_KEY); }catch(e){}
  _client = null;
}
function isConnected(){
  const c = getSupaConfig();
  return !!(c.url && c.key);
}

/* memoised client */
let _client = null;
function getSupaClient(){
  if(_client) return _client;
  const { url, key } = getSupaConfig();
  if(!url || !key) return null;
  if(!window.supabase || !window.supabase.createClient){
    throw new Error('Supabase library not loaded.');
  }
  _client = window.supabase.createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kpn_supa_auth' },
  });
  return _client;
}

/* bcrypt (browser build exposes window.dcodeIO.bcrypt and/or window.bcrypt) */
function _bcrypt(){ return window.dcodeIO?.bcrypt || window.bcrypt || null; }
function _checkPin(plain, stored){
  stored = String(stored || '');
  if(stored.startsWith('$2')){
    const bc = _bcrypt();
    if(!bc) throw new Error('Password hashing library not loaded.');
    try{ return bc.compareSync(String(plain), stored); }catch(e){ return false; }
  }
  return String(plain) === stored;
}

function buildEmail(username){
  if(username === 'sudo') return 'sudo@mjc.local';
  return `${username}@mjc-cafeteria.com`;
}

/* ── REAL LOGIN — returns {ok, user} | {ok:false, error} ── */
async function realLogin({ username, type, pin, password }){
  username = (username || '').trim().toLowerCase();
  if(!username) return { ok:false, error:'Username is required.' };

  let db;
  try{ db = getSupaClient(); }
  catch(e){ return { ok:false, error:e.message }; }
  if(!db) return { ok:false, error:'Not connected to Supabase.' };

  // 1. fetch profile
  let profile;
  try{
    const { data, error } = await db
      .from('user_profiles')
      .select('id, username, display_name, last_name, role, pin, active')
      .eq('username', username)
      .single();
    if(error || !data){ return { ok:false, error:'Username not recognised.' }; }
    profile = data;
  }catch(e){
    return { ok:false, error:'Could not reach the directory. Check connection & table access.' };
  }

  if(!profile.active) return { ok:false, error:'Account is disabled.' };

  // 2a. STAFF — PIN compare (mirrors backend)
  if(type === 'staff'){
    if(profile.role !== 'staff')
      return { ok:false, error:'Admin & manager accounts must use the Admin / Manager login.' };
    if(!pin) return { ok:false, error:'PIN is required.' };
    let ok;
    try{ ok = _checkPin(pin, profile.pin); }
    catch(e){ return { ok:false, error:e.message }; }
    if(!ok) return { ok:false, error:'Incorrect PIN. Please try again.' };
    return { ok:true, user:_publicUser(profile) };
  }

  // 2b. ADMIN / MANAGER / ASSISTANT — real Supabase Auth
  if(type === 'admin'){
    if(!['admin','manager','assistant'].includes(profile.role))
      return { ok:false, error:'Staff accounts must use the Staff login.' };
    if(!password) return { ok:false, error:'Password is required.' };
    try{
      const { data, error } = await db.auth.signInWithPassword({
        email: buildEmail(username), password,
      });
      if(error || !data?.session){
        return { ok:false, error:'Incorrect password. Please try again.' };
      }
      return { ok:true, user:{ ..._publicUser(profile), access_token:data.session.access_token } };
    }catch(e){
      return { ok:false, error:'Incorrect password. Please try again.' };
    }
  }

  return { ok:false, error:'Invalid login type.' };
}

function _publicUser(p){
  return {
    id: p.id, username: p.username,
    display_name: p.display_name || '', last_name: p.last_name || '', role: p.role,
  };
}

async function realLogout(){
  try{ const db = getSupaClient(); if(db) await db.auth.signOut(); }catch(e){}
}

/* ── GENERIC LOG STORE — HACCP / compliance forms ──
   Always writes localStorage (works offline, like the dashboard).
   When connected, also upserts into a `haccp_logs` table keyed by id
   (text). Gracefully degrades if that table doesn't exist yet. ── */
function _logKey(key){ return 'mjc_log_'+key; }
function loadLog(key, fallback){
  try{
    const raw = localStorage.getItem(_logKey(key));
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return fallback;
}
function saveLogLocal(key, data){
  try{ localStorage.setItem(_logKey(key), JSON.stringify(data)); }catch(e){}
}
async function saveLog(key, data, syncedBy){
  saveLogLocal(key, data);
  const db = getSupaClient();
  if(!db) return { ok:true, where:'local' };
  try{
    const { error } = await db.from('haccp_logs').upsert(
      { id:key, data, updated_by:syncedBy||'portal', updated_at:new Date().toISOString() },
      { onConflict:'id' });
    if(error) return { ok:true, where:'local', note:error.message };
    return { ok:true, where:'supabase' };
  }catch(e){ return { ok:true, where:'local', note:e.message }; }
}
async function fetchLog(key){
  const db = getSupaClient();
  if(db){
    try{
      const { data, error } = await db.from('haccp_logs').select('data, updated_by, updated_at').eq('id', key).single();
      if(!error && data){ saveLogLocal(key, data.data); return { ok:true, data:data.data, updatedBy:data.updated_by, updatedAt:data.updated_at, where:'supabase' }; }
    }catch(e){}
  }
  return { ok:true, data:loadLog(key, null), where:'local' };
}

/* ── INVENTORY — pull inventory_sync row 1 ── */
async function fetchInventory(){
  const db = getSupaClient();
  if(!db) return { ok:false, error:'Not connected.' };
  try{
    const { data, error } = await db
      .from('inventory_sync')
      .select('data, synced_by, synced_at')
      .eq('id', 1)
      .single();
    if(error) return { ok:false, error:error.message };
    const inv = data?.data?.liveInventory || null;
    return { ok:true, inv, syncedBy:data?.synced_by, syncedAt:data?.synced_at,
             liveMonth:data?.data?.liveMonth || null };
  }catch(e){ return { ok:false, error:e.message }; }
}

/* ── PUSH — write the whole inventory back to inventory_sync row 1 ── */
async function pushInventory(inv, syncedBy){
  const db = getSupaClient();
  if(!db) return { ok:false, error:'Not connected.' };
  try{
    const row = {
      id: 1,
      data: { version:2, exportedAt:new Date().toISOString(),
              liveMonth:{ month:4, year:2026 }, liveInventory:inv, snapshots:{} },
      synced_by: syncedBy || 'portal',
      synced_at: new Date().toISOString(),
    };
    const { error } = await db.from('inventory_sync').upsert(row, { onConflict:'id' });
    if(error) return { ok:false, error:error.message };
    return { ok:true };
  }catch(e){ return { ok:false, error:e.message }; }
}

/* ── USERS — pull user_profiles ── */
async function fetchProfiles(){
  const db = getSupaClient();
  if(!db) return { ok:false, error:'Not connected.' };
  try{
    const { data, error } = await db
      .from('user_profiles')
      .select('id, username, display_name, last_name, role, active')
      .order('username');
    if(error) return { ok:false, error:error.message };
    return { ok:true, users:data || [] };
  }catch(e){ return { ok:false, error:e.message }; }
}

/* ── INVENTORY MATH (mirrors dashboard) ── */
const CCOLOR = {
  Dairy:'#0D9488', Cereal:'#B45309', Beverages:'#2563EB', Snacks:'#7C3AED',
  'Dry Goods':'#92400E', 'Produce & Fresh':'#15803D', 'Protein & Meat':'#B91C1C',
  'Frozen Foods':'#0369A1', Supplies:'#6B7280', Bread:'#CA8A04', Condiments:'#DB2777',
};
function catColor(c){ return CCOLOR[c] || '#1E73E8'; }
function iTotal(it){
  const rcv=(it.w1r||0)+(it.w2r||0)+(it.w3r||0)+(it.w4r||0);
  const iss=(it.w1i||0)+(it.w2i||0)+(it.w3i||0)+(it.w4i||0);
  return Math.max(0,(it.onHand||0)+rcv-iss)*(it.price||0);
}
function invToList(inv){
  // inv = { category: [items] }  →  flat [{...item, cat}]
  const out=[];
  Object.keys(inv||{}).forEach(cat=>{ (inv[cat]||[]).forEach(it=>out.push({ ...it, cat })); });
  return out;
}
function grandTotal(inv){ return invToList(inv).reduce((s,i)=>s+iTotal(i),0); }
function catTotals(inv){
  return Object.keys(inv||{}).map(cat=>({
    name:cat, color:catColor(cat),
    val:(inv[cat]||[]).reduce((s,i)=>s+iTotal(i),0),
    count:(inv[cat]||[]).length,
  })).sort((a,b)=>b.val-a.val);
}
function reorders(inv){ return invToList(inv).filter(i=>(i.onHand||0)<(i.par||0)&&(i.par||0)>0); }
function fmtMoney(n){
  if(n>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if(n>=1e3) return '$'+(n/1e3).toFixed(1)+'K';
  return '$'+(n||0).toFixed(2);
}
function fmtMoneyFull(n){ return '$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

Object.assign(window, {
  getSupaConfig, saveSupaConfig, clearSupaConfig, isConnected, getSupaClient,
  realLogin, realLogout, fetchInventory, fetchProfiles, pushInventory,
  loadLog, saveLog, fetchLog, saveLogLocal,
  CCOLOR, catColor, iTotal, invToList, grandTotal, catTotals, reorders, fmtMoney, fmtMoneyFull,
});
