"""
SKU Review Queue API — manager triage for unknown import SKUs.

GET  /api/sku-review              — list queue (manager+)
POST /api/sku-review/{id}/resolve — resolve a row (new_item / alias_existing / override_existing)
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends, Header
from pydantic import BaseModel
from backend.routes import supabase_service, jwt_validator

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/sku-review', tags=['sku-review'])

ROLE_LEVEL = {'staff': 10, 'assistant': 20, 'manager': 30, 'admin': 40, 'sudo': 50}


async def _get_auth_user(authorization: str = Header('')) -> dict:
    token = authorization.replace('Bearer ', '').strip()
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    if token.startswith('pin_'):
        user_id = token.replace('pin_', '')
        try:
            result = supabase_service.table('user_profiles').select('*').eq('id', user_id).single().execute()
            user = result.data if result.data else None
        except Exception:
            user = None
    else:
        claims = jwt_validator.verify_token(token)
        if not claims:
            raise HTTPException(status_code=401, detail='Invalid or expired token')
        user_id = claims.get('sub')
        if not user_id:
            raise HTTPException(status_code=401, detail='Token missing user ID')
        try:
            result = supabase_service.table('user_profiles').select('*').eq('id', user_id).single().execute()
            user = result.data if result.data else None
        except Exception:
            user = None

    if not user or not user.get('active'):
        raise HTTPException(status_code=401, detail='User not found or inactive')
    return user


def _require_manager(user: dict) -> None:
    lvl = ROLE_LEVEL.get((user.get('role') or '').lower(), 0)
    if lvl < 30:
        raise HTTPException(status_code=403, detail='Manager access required.')


class ResolveBody(BaseModel):
    resolution: str                  # 'new_item' | 'alias_existing' | 'override_existing'
    item_id: Optional[str] = None    # existing item (alias_existing / override_existing)
    new_sku: Optional[str] = None    # canonical SKU for new_item / override_existing
    new_desc: Optional[str] = None   # description for new_item
    new_category: Optional[str] = None  # category name for new_item


@router.get('')
async def list_sku_review(
    status: str = Query('pending'),
    limit: int = Query(100, ge=1, le=500),
    auth_user: dict = Depends(_get_auth_user),
):
    """List SKU review queue rows. Default: pending only. Pass status=all for everything."""
    _require_manager(auth_user)
    try:
        q = supabase_service.table('sku_review_queue').select(
            'id, parsed_sku, parsed_description, vendor_id, source_ref, '
            'qty, unit_price, suggested_item_id, status, resolution, '
            'resolved_item_id, resolved_by, resolved_at, created_at'
        ).order('created_at', desc=True).limit(limit)
        if status != 'all':
            q = q.eq('status', status)
        result = q.execute()
        return result.data or []
    except Exception as e:
        logger.exception('Error listing sku_review_queue')
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.post('/{row_id}/resolve')
async def resolve_sku(
    row_id: str,
    body: ResolveBody,
    auth_user: dict = Depends(_get_auth_user),
):
    """Resolve a sku_review_queue row.

    resolution='new_item':
        Stage creation of a new inventory_items row with the parsed SKU via
        sku_review_resolve. Frontend should commit that staging entry separately.

    resolution='alias_existing':
        The parsed SKU is a vendor alias for item_id. Calls sku_add_alias then
        sku_review_resolve. Future imports of that SKU auto-resolve.

    resolution='override_existing':
        Replace item_id's canonical SKU with the parsed SKU. Checks for conflicts
        (409 if the new SKU already belongs to a different item). Then calls
        sku_review_resolve.
    """
    _require_manager(auth_user)

    if body.resolution not in ('new_item', 'alias_existing', 'override_existing'):
        raise HTTPException(status_code=422, detail="resolution must be 'new_item', 'alias_existing', or 'override_existing'")

    # Load the queue row
    try:
        row_res = supabase_service.table('sku_review_queue').select('*').eq('id', row_id).single().execute()
        row = row_res.data
    except Exception:
        row = None
    if not row:
        raise HTTPException(status_code=404, detail='Queue row not found')
    if row.get('status') != 'pending':
        raise HTTPException(status_code=409, detail=f"Row is already {row.get('status')}")

    parsed_sku = row['parsed_sku']
    resolved_item_id: Optional[str] = None
    now = datetime.now(timezone.utc).isoformat()

    if body.resolution == 'new_item':
        # Mint a new inventory_items row with the parsed SKU.
        sku = (body.new_sku or parsed_sku).strip()
        desc = (body.new_desc or row.get('parsed_description') or sku).strip()

        # Check SKU uniqueness before writing.
        conflict = supabase_service.table('inventory_items').select('id, sku, description').eq('sku', sku).limit(1).execute()
        if conflict.data:
            c = conflict.data[0]
            raise HTTPException(status_code=409, detail={
                'message': f"SKU '{sku}' already exists.",
                'conflict_id': c['id'],
                'conflict_sku': c['sku'],
                'conflict_desc': c['description'],
            })

        # Resolve category
        cat_id = None
        if body.new_category:
            cat_res = supabase_service.table('inventory_categories').select('id').eq('name', body.new_category).limit(1).execute()
            if cat_res.data:
                cat_id = cat_res.data[0]['id']

        try:
            ins = supabase_service.table('inventory_items').insert({
                'sku': sku,
                'description': desc,
                'category_id': cat_id,
                'unit_price': row.get('unit_price') or 0,
                'par_level': 0,
                'unit': 'each',
                'active': True,
            }).execute()
            resolved_item_id = ins.data[0]['id'] if ins.data else None
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'Failed to create item: {str(e)}')

    elif body.resolution == 'alias_existing':
        if not body.item_id:
            raise HTTPException(status_code=422, detail='item_id required for alias_existing')
        # Call the sku_add_alias RPC which writes to item_barcodes and enforces uniqueness.
        try:
            alias_res = supabase_service.rpc('sku_add_alias', {
                'p_item': body.item_id,
                'p_alias': parsed_sku,
                'p_vendor': row.get('vendor_id'),
            }).execute()
            alias_data = alias_res.data or {}
            if isinstance(alias_data, list):
                alias_data = alias_data[0] if alias_data else {}
            if not alias_data.get('ok'):
                raise HTTPException(status_code=409, detail=alias_data.get('error', 'Alias collision'))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'sku_add_alias failed: {str(e)}')
        resolved_item_id = body.item_id

    elif body.resolution == 'override_existing':
        if not body.item_id:
            raise HTTPException(status_code=422, detail='item_id required for override_existing')
        new_sku = (body.new_sku or parsed_sku).strip()

        # Collision check: another item already owns this canonical SKU?
        conflict = supabase_service.table('inventory_items').select('id, sku, description').eq('sku', new_sku).neq('id', body.item_id).limit(1).execute()
        if conflict.data:
            c = conflict.data[0]
            raise HTTPException(status_code=409, detail={
                'message': f"SKU '{new_sku}' is already the canonical SKU of another item.",
                'conflict_id': c['id'],
                'conflict_sku': c['sku'],
                'conflict_desc': c['description'],
            })

        try:
            supabase_service.table('inventory_items').update({
                'sku': new_sku,
                'updated_at': now,
            }).eq('id', body.item_id).execute()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f'SKU override failed: {str(e)}')
        resolved_item_id = body.item_id

    # Mark the queue row resolved via RPC.
    try:
        supabase_service.rpc('sku_review_resolve', {
            'p_id': row_id,
            'p_resolution': body.resolution,
            'p_item': resolved_item_id,
            'p_by': auth_user['id'],
        }).execute()
    except Exception as e:
        logger.warning('sku_review_resolve RPC failed (row may be marked manually): %s', e)
        # Fallback: mark resolved directly
        supabase_service.table('sku_review_queue').update({
            'status': 'resolved',
            'resolution': body.resolution,
            'resolved_item_id': resolved_item_id,
            'resolved_by': auth_user['id'],
            'resolved_at': now,
        }).eq('id', row_id).execute()

    return {
        'ok': True,
        'resolution': body.resolution,
        'resolved_item_id': resolved_item_id,
        'parsed_sku': parsed_sku,
    }
