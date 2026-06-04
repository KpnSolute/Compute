"""
Inventory Management API Endpoints

Provides endpoints for inventory snapshots, history, and reorder management.

Endpoints:
- GET /api/inventory - Get latest inventory snapshot
- POST /api/inventory - Save inventory snapshot
- GET /api/inventory/history - Get past snapshots
- GET /api/inventory/reorders - Get low-stock items
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from pydantic import BaseModel, Field
from backend.routes import supabase, jwt_validator

router = APIRouter(prefix='/api/inventory', tags=['inventory'])


class InventoryItem(BaseModel):
    """Individual inventory item."""
    sku: str
    desc: str
    onHand: int = Field(..., ge=0)
    par: int = Field(..., ge=0)
    category: str


class InventorySnapshot(BaseModel):
    """Inventory snapshot payload."""
    items: list[InventoryItem]
    metadata: dict = Field(default_factory=dict)
    notes: str = ''


class InventoryResponse(BaseModel):
    """Response model for inventory snapshot."""
    id: str
    items: list[InventoryItem]
    metadata: dict
    notes: str
    created_at: str
    created_by: str


class LowStockItem(BaseModel):
    """Low stock item in reorder response."""
    sku: str
    desc: str
    category: str
    onHand: int
    par: int
    short: int


async def _get_auth_user(authorization: str = Header('')) -> dict:
    """
    Extract authenticated user from Bearer token.

    Supports both Supabase JWT and PIN-based tokens.

    Raises:
        401: Missing or invalid token
    """
    token = authorization.replace('Bearer ', '') if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    # Handle PIN-based tokens
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

    # Handle Supabase JWT tokens
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


@router.get('', response_model=InventoryResponse)
async def get_inventory(
    month: int = Query(None),
    year: int = Query(None),
    auth_user: dict = Depends(_get_auth_user)
):
    """
    Get latest inventory snapshot or specific period.

    Requires: Valid authentication token

    Query Parameters:
    - month: Month (1-12) for specific period
    - year: Year (YYYY) for specific period
    - If both provided, returns snapshot for that month; else returns latest

    Returns:
        Latest or specified inventory snapshot

    Raises:
        401: Missing or invalid auth
        404: No inventory found
        500: Database error
    """
    try:
        if month is not None and year is not None:
            # Validate month range
            if month < 1 or month > 12:
                raise HTTPException(status_code=400, detail='Month must be 1-12')

            period_id = f'{year}-{month:02d}'
            result = (
                supabase.table('inventory_sync')
                .select('*')
                .eq('period', period_id)
                .single()
                .execute()
            )
        else:
            # Get latest snapshot
            result = (
                supabase.table('inventory_sync')
                .select('*')
                .order('created_at', desc=True)
                .limit(1)
                .execute()
            )

        if not result.data:
            raise HTTPException(status_code=404, detail='Inventory not found')

        snapshot = result.data[0] if isinstance(result.data, list) else result.data
        return InventoryResponse(**snapshot)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Database error: {str(e)}'
        )


@router.post('', response_model=InventoryResponse, status_code=201)
async def save_inventory(
    payload: InventorySnapshot,
    auth_user: dict = Depends(_get_auth_user)
):
    """
    Save a new inventory snapshot.

    Requires: Valid authentication token (manager or admin recommended)

    Request Body:
    - items: List of inventory items with sku, desc, onHand, par, category
    - metadata: Optional metadata dict
    - notes: Optional notes about this snapshot

    Returns:
        Created inventory snapshot

    Raises:
        400: Invalid input
        401: Missing or invalid auth
        500: Database error
    """
    # Validate items not empty
    if not payload.items:
        raise HTTPException(status_code=400, detail='Items list cannot be empty')

    # Validate each item
    for item in payload.items:
        if item.onHand < 0 or item.par < 0:
            raise HTTPException(
                status_code=400,
                detail='onHand and par must be non-negative'
            )

    try:
        now = datetime.utcnow().isoformat()
        result = (
            supabase.table('inventory_sync')
            .insert({
                'items': [item.dict() for item in payload.items],
                'metadata': payload.metadata,
                'notes': payload.notes,
                'created_at': now,
                'created_by': auth_user.get('id'),
            })
            .execute()
        )

        snapshot = result.data[0] if result.data else None
        if not snapshot:
            raise HTTPException(status_code=500, detail='Failed to save inventory')

        return InventoryResponse(**snapshot)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Database error: {str(e)}'
        )


@router.get('/history', response_model=list[InventoryResponse])
async def get_inventory_history(
    limit: int = Query(10, ge=1, le=100),
    auth_user: dict = Depends(_get_auth_user)
):
    """
    Get historical inventory snapshots.

    Requires: Valid authentication token

    Query Parameters:
    - limit: Maximum snapshots to return (1-100, default 10)

    Returns:
        List of inventory snapshots ordered by date descending

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        result = (
            supabase.table('inventory_sync')
            .select('*')
            .order('created_at', desc=True)
            .limit(limit)
            .execute()
        )

        snapshots = result.data if result.data else []
        return [InventoryResponse(**s) for s in snapshots]

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Database error: {str(e)}'
        )


@router.get('/reorders', response_model=list[LowStockItem])
async def get_reorders(
    auth_user: dict = Depends(_get_auth_user)
):
    """
    Get low-stock items requiring reorder.

    Requires: Valid authentication token

    Returns items where onHand < par, sorted by shortage.

    Returns:
        List of low-stock items

    Raises:
        401: Missing or invalid auth
        404: No inventory found
        500: Database error
    """
    try:
        # Get latest inventory
        result = (
            supabase.table('inventory_sync')
            .select('*')
            .order('created_at', desc=True)
            .limit(1)
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail='No inventory found')

        snapshot = result.data[0] if isinstance(result.data, list) else result.data
        items = snapshot.get('items', [])

        low_items = []
        for item in items:
            on_hand = item.get('onHand', 0)
            par = item.get('par', 0)
            if on_hand < par:
                low_items.append(LowStockItem(
                    sku=item.get('sku'),
                    desc=item.get('desc'),
                    category=item.get('category'),
                    onHand=on_hand,
                    par=par,
                    short=par - on_hand
                ))

        # Sort by shortage descending
        low_items.sort(key=lambda x: x.short, reverse=True)
        return low_items

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f'Database error: {str(e)}'
        )
