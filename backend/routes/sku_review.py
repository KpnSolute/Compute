"""
SKU Review Queue API — manager triage for unknown import SKUs.

GET  /api/sku-review              — list queue (manager+)
POST /api/sku-review/{id}/resolve — resolve a row (new_item / alias_existing / override_existing)

Resolution strategy:
  new_item          — creates item via item_create staging op → commit (commit log + github sync)
  alias_existing    — writes alias directly via sku_add_alias RPC (metadata-only, no inventory change)
  override_existing — renames canonical SKU via item_update staging op → commit
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from backend.routes import supabase_service
from backend.routes._deps import _require_manager
from backend.routes.sourcectrl import _apply_entries

logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/sku-review', tags=['sku-review'])


class ResolveBody(BaseModel):
    resolution: str                    # 'new_item' | 'alias_existing' | 'override_existing'
    item_id: Optional[str] = None      # existing item (alias_existing / override_existing)
    new_sku: Optional[str] = None      # canonical SKU for new_item / override_existing
    new_desc: Optional[str] = None     # description for new_item
    new_category: Optional[str] = None # category name for new_item


@router.get('')
async def list_sku_review(
    status: str = Query('pending'),
    limit: int = Query(100, ge=1, le=500),
    auth_user: dict = Depends(_require_manager),
):
    """List SKU review queue rows. Default: pending only. Pass status=all for everything."""
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


def _insert_staging(auth_user_id: str, operation: str, entity_id: str, payload: dict, queue_id: str, **extra_meta) -> dict:
    """Insert a staging_entries row for immediate commit via _apply_entries."""
    meta = {'queue_id': queue_id, **extra_meta}
    row = {
        'entity_type': 'inventory',
        'entity_id': entity_id,
        'field_name': operation,
        'new_value_text': entity_id,
        'change_type': 'create' if operation == 'item_create' else 'update',
        'metadata': meta,
        'status': 'pending',
        'submitted_by': auth_user_id,
        'source': 'sku_review',
        'operation': operation,
        'full_payload': payload,
    }
    r = supabase_service.table('staging_entries').insert(row).execute()
    if not r.data:
        raise HTTPException(status_code=500, detail='Failed to create staging entry')
    return r.data[0]


@router.post('/{row_id}/resolve')
async def resolve_sku(
    row_id: str,
    body: ResolveBody,
    auth_user: dict = Depends(_require_manager),
):
    """Resolve a sku_review_queue row.

    new_item          → item_create staging op → commit (appears in commit log + github sync)
    alias_existing    → sku_add_alias RPC (metadata alias, no inventory write needed)
    override_existing → item_update staging op with new_sku → commit
    """
    if body.resolution not in ('new_item', 'alias_existing', 'override_existing'):
        raise HTTPException(
            status_code=422,
            detail="resolution must be 'new_item', 'alias_existing', or 'override_existing'",
        )

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

    # ── new_item: create via staging → commit ─────────────────────────────────
    if body.resolution == 'new_item':
        sku = (body.new_sku or parsed_sku).strip()
        desc = (body.new_desc or row.get('parsed_description') or sku).strip()
        category = (body.new_category or '').strip()

        # Pre-flight conflict check so we return a structured 409 (not a 500 from _apply_entries)
        conflict_r = supabase_service.table('inventory_items').select('id,sku,description').eq('sku', sku).limit(1).execute()
        if conflict_r.data:
            c = conflict_r.data[0]
            raise HTTPException(status_code=409, detail={
                'error': 'sku_conflict',
                'message': f"SKU '{sku}' already exists.",
                'conflict_id': c['id'],
                'conflict_sku': c['sku'],
                'conflict_desc': c['description'],
            })

        payload = {
            'sku': sku,
            'description': desc,
            'category': category,
            'unit_price': row.get('unit_price') or 0,
            'par_level': 0,
            'unit': 'each',
            'active': True,
        }
        entry = _insert_staging(auth_user['id'], 'item_create', sku, payload, row_id)
        _apply_entries([entry], author_id=auth_user['id'], message=f'SKU review: new item {sku}', source='sku_review')

        # Read back the created item_id
        new_item_r = supabase_service.table('inventory_items').select('id').eq('sku', sku).limit(1).execute()
        resolved_item_id = new_item_r.data[0]['id'] if new_item_r.data else None

    # ── alias_existing: metadata-only write via RPC (no inventory change) ─────
    elif body.resolution == 'alias_existing':
        if not body.item_id:
            raise HTTPException(status_code=422, detail='item_id required for alias_existing')
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

    # ── override_existing: rename canonical SKU via staging → commit ──────────
    elif body.resolution == 'override_existing':
        if not body.item_id:
            raise HTTPException(status_code=422, detail='item_id required for override_existing')
        new_sku = (body.new_sku or parsed_sku).strip()

        # Fetch the item's current canonical SKU (needed as the identifier for item_update)
        item_r = supabase_service.table('inventory_items').select('id,sku,description').eq('id', body.item_id).limit(1).execute()
        item = (item_r.data or [None])[0]
        if not item:
            raise HTTPException(status_code=404, detail='Item not found')
        current_sku = item['sku']

        # Pre-flight conflict check
        if new_sku != current_sku:
            conflict_r = (
                supabase_service.table('inventory_items')
                .select('id,sku,description')
                .eq('sku', new_sku)
                .neq('id', body.item_id)
                .limit(1)
                .execute()
            )
            if conflict_r.data:
                c = conflict_r.data[0]
                raise HTTPException(status_code=409, detail={
                    'error': 'sku_conflict',
                    'message': f"SKU '{new_sku}' is already the canonical SKU of another item.",
                    'conflict_id': c['id'],
                    'conflict_sku': c['sku'],
                    'conflict_desc': c['description'],
                })

        entry = _insert_staging(
            auth_user['id'], 'item_update', current_sku,
            {'sku': current_sku, 'new_sku': new_sku},
            row_id,
        )
        entry['old_value_text'] = current_sku
        entry['new_value_text'] = new_sku
        entry['field_name'] = 'sku'
        entry['change_type'] = 'update'
        _apply_entries(
            [entry],
            author_id=auth_user['id'],
            message=f'SKU review: rename {current_sku} → {new_sku}',
            source='sku_review',
        )
        resolved_item_id = body.item_id

    # ── mark queue row resolved ────────────────────────────────────────────────
    try:
        supabase_service.rpc('sku_review_resolve', {
            'p_id': row_id,
            'p_resolution': body.resolution,
            'p_item': resolved_item_id,
            'p_by': auth_user['id'],
        }).execute()
    except Exception as e:
        logger.warning('sku_review_resolve RPC failed (marking directly): %s', e)
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
