"""
Data Access API Endpoints

Provides endpoints for checklist, servsafe, meal periods, incidents,
invoices, inventory categories, dashboard stats, and archives.
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from pydantic import BaseModel
from backend.routes import supabase, jwt_validator

router = APIRouter(prefix='/api', tags=['data'])


async def _get_auth_user(authorization: str = Header('')) -> dict:
    token = authorization.replace('Bearer ', '') if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    if token.startswith('pin_'):
        user_id = token.replace('pin_', '')
        try:
            result = (
                supabase.table('user_profiles')
                .select('*')
                .eq('id', user_id)
                .single()
                .execute()
            )
            user = result.data if result.data else None
        except Exception:
            user = None

        if not user or not user.get('active'):
            raise HTTPException(status_code=401, detail='Invalid session')
        return user

    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')

    user_id = claims.get('sub')
    if not user_id:
        raise HTTPException(status_code=401, detail='Token missing user ID')

    try:
        result = (
            supabase.table('user_profiles')
            .select('*')
            .eq('id', user_id)
            .single()
            .execute()
        )
        user = result.data if result.data else None
    except Exception:
        user = None

    if not user or not user.get('active'):
        raise HTTPException(status_code=401, detail='User not found or inactive')

    return user


# ── Opening Checklist ──────────────────────────────────────────────────────


@router.get('/opening-checklist')
async def get_opening_checklist(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase.table('opening_checklist_items')
            .select('*')
            .eq('is_active', True)
            .order('sort_order')
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ServSafe ───────────────────────────────────────────────────────────────


@router.get('/servsafe')
async def get_servsafe(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase.table('servsafe_certifications')
            .select('*')
            .order('staff_name')
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Meal Periods ──────────────────────────────────────────────────────────


@router.get('/meal-periods')
async def get_meal_periods(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase.table('meal_periods')
            .select('*')
            .order('sort_order')
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Incidents ──────────────────────────────────────────────────────────────


class IncidentCreate(BaseModel):
    incident_type: str
    description: str
    reported_by: str
    notes: str = ''


@router.get('/incidents')
async def get_incidents(
    limit: int = Query(50, ge=1, le=500),
    incident_type: str = Query(None, alias='type'),
    auth_user: dict = Depends(_get_auth_user)
):
    try:
        query = supabase.table('incident_logs').select('*')
        if incident_type:
            query = query.eq('incident_type', incident_type)
        result = query.order('reported_at', desc=True).limit(limit).execute()
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/incidents', status_code=201)
async def create_incident(
    payload: IncidentCreate,
    auth_user: dict = Depends(_get_auth_user)
):
    try:
        now = datetime.utcnow().isoformat()
        result = (
            supabase.table('incident_logs')
            .insert({
                'incident_type': payload.incident_type,
                'description': payload.description,
                'reported_by': payload.reported_by,
                'notes': payload.notes,
                'reported_at': now,
                'created_at': now,
            })
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=500, detail='Failed to create incident')
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Invoices ───────────────────────────────────────────────────────────────


@router.get('/invoices')
async def get_invoices(
    month: int = Query(None),
    year: int = Query(None),
    auth_user: dict = Depends(_get_auth_user)
):
    try:
        query = supabase.table('invoices').select('*')
        if month is not None:
            query = query.eq('month', month)
        if year is not None:
            query = query.eq('year', year)
        result = query.order('created_at', desc=True).execute()
        invoices_data = result.data if result.data else []

        vendor_ids = list({inv.get('vendor_id') for inv in invoices_data if inv.get('vendor_id')})
        vendor_map = {}
        if vendor_ids:
            vendors_result = (
                supabase.table('vendors')
                .select('id,name')
                .in_('id', vendor_ids)
                .execute()
            )
            vendor_map = {v['id']: v['name'] for v in (vendors_result.data or [])}

        return [
            {**inv, 'vendor_name': vendor_map.get(inv.get('vendor_id'))}
            for inv in invoices_data
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/invoices/{id}/items')
async def get_invoice_items(
    id: str,
    auth_user: dict = Depends(_get_auth_user)
):
    try:
        result = (
            supabase.table('invoice_items')
            .select('*')
            .eq('invoice_id', id)
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Inventory Categories ──────────────────────────────────────────────────


@router.get('/inventory-categories')
async def get_inventory_categories(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase.table('inventory_categories')
            .select('*')
            .order('sort_order')
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dashboard Stats ────────────────────────────────────────────────────────


@router.get('/dashboard/stats')
async def get_dashboard_stats(auth_user: dict = Depends(_get_auth_user)):
    try:
        # total_value from live_inventory SUM(sub_total)
        total_value = 0.0
        try:
            tv = supabase.table('live_inventory').select('sub_total').execute()
            if tv.data:
                total_value = sum(
                    float(r.get('sub_total', 0) or 0) for r in tv.data
                )
        except Exception:
            pass
        if not total_value:
            try:
                items = supabase.table('inventory_items').select('id,unit_price').execute()
                if items.data:
                    prices = {i['id']: float(i.get('unit_price', 0) or 0) for i in items.data}
                    mi = supabase.table('monthly_inventory').select('item_id,on_hand').execute()
                    if mi.data:
                        total_value = sum(
                            prices.get(r.get('item_id'), 0) * float(r.get('on_hand', 0) or 0)
                            for r in mi.data
                        )
            except Exception:
                pass

        # total_items from barcodes COUNT where is_active=true
        total_items = 0
        try:
            ti = supabase.table('barcodes').select('id').eq('is_active', True).execute()
            total_items = len(ti.data) if ti.data else 0
        except Exception:
            pass

        # low_stock from live_inventory where on_hand < par_level
        low_stock = 0
        try:
            ls = supabase.table('live_inventory').select('on_hand,par_level').execute()
            if ls.data:
                low_stock = sum(
                    1 for r in ls.data
                    if float(r.get('on_hand', 0) or 0) < float(r.get('par_level', 0) or 0)
                )
        except Exception:
            pass

        # pending_staging from staging_entries COUNT where status='pending'
        pending_staging = 0
        try:
            ps = supabase.table('staging_entries').select('entry_id').eq('status', 'pending').execute()
            pending_staging = len(ps.data) if ps.data else 0
        except Exception:
            pass

        # recent_activity from commits (last 5), enriched with user_profiles
        recent_activity = []
        try:
            cr = supabase.table('commits').select('commit_id,message,author_id,created_at').order('created_at', desc=True).limit(5).execute()
            if cr.data:
                author_ids = list({c['author_id'] for c in cr.data if c.get('author_id')})
                pm = {}
                if author_ids:
                    pr = supabase.table('user_profiles').select('id,display_name,username,role').in_('id', author_ids).execute()
                    pm = {p['id']: p for p in (pr.data or [])}
                for c in cr.data:
                    p = pm.get(c.get('author_id'), {})
                    recent_activity.append({
                        'who': p.get('display_name') or p.get('username') or c.get('author_id'),
                        'role': p.get('role', 'staff'),
                        'what': 'committed',
                        'detail': c.get('message', ''),
                        'when': c.get('created_at'),
                    })
        except Exception:
            pass

        return {
            'total_value': round(total_value, 2),
            'total_items': total_items,
            'low_stock': low_stock,
            'pending_staging': pending_staging,
            'recent_activity': recent_activity,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Archives ───────────────────────────────────────────────────────────────


@router.get('/archives')
async def get_archives(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase.table('monthly_snapshots')
            .select('month,year,grand_total,item_count')
            .order('year', desc=True)
            .order('month', desc=True)
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/archives/{year}/{month}')
async def get_archive_detail(
    year: int,
    month: int,
    auth_user: dict = Depends(_get_auth_user)
):
    try:
        result = (
            supabase.table('monthly_snapshots')
            .select('*')
            .eq('year', year)
            .eq('month', month)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail='Archive not found')
        return result.data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
