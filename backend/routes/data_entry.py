"""
Data Entry API — AI-powered file ingestion pipeline.
POST /api/data-entry/upload   — parse file → AI extract → stage → return batch preview
GET  /api/data-entry/preview/{batch_id} — row-level diff for a staged batch
GET  /api/data-entry/settings — current AI stack config
PUT  /api/data-entry/settings — update AI stack config
"""

import uuid
import os
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Depends
from pydantic import BaseModel

from backend.routes import jwt_validator
from supabase import create_client
from typing import Optional

from backend.ai import engine as ai_engine
from backend.ai import parser as file_parser
from backend.ai import mapper, context as ctx, diff as diff_engine

router = APIRouter(prefix="/api/data-entry")

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        _svc = create_client(url, key)
    return _svc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _expires() -> str:
    from datetime import timedelta

    return (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()


def _first_admin() -> str:
    r = (
        _client()
        .table("user_profiles")
        .select("id")
        .eq("role", "admin")
        .limit(1)
        .execute()
    )
    if r.data:
        return r.data[0]["id"]
    raise HTTPException(status_code=500, detail="No admin user found.")


# ── helpers ───────────────────────────────────────────────────────────────────


def _stage_entries(
    ops: list[dict], batch_id: str, file_ref: str, submitter: str
) -> list[dict]:
    """Write a list of {operation, full_payload} dicts to staging_entries."""
    rows = []
    for op_item in ops:
        operation = op_item["operation"]
        payload = op_item["payload"]

        # build human-readable summary for old/new value display
        if operation == "inventory_save":
            items = payload.get("items", [])
            summary = f"{len(items)} inventory item(s) — {payload.get('month')}/{payload.get('year')}"
            entity_type = "inventory"
            entity_id = batch_id
            field_name = "bulk_import"
            new_value = f"{len(items)} items"
        elif operation == "event_create":
            summary = f"Event: {payload.get('title', '')} on {payload.get('date', '')}"
            entity_type = "event"
            entity_id = payload.get("title", batch_id)[:64]
            field_name = "event_import"
            new_value = payload.get("title", "")
        elif operation == "haccp_save":
            summary = f"HACCP: {payload.get('location', '')} {payload.get('temperature', '')}°{payload.get('unit', 'F')}"
            entity_type = "compliance"
            entity_id = batch_id
            field_name = "haccp_import"
            new_value = str(payload.get("temperature", ""))
        elif operation == "menu_save":
            summary = (
                f"Menu: {payload.get('day', '')} — {len(payload.get('data', {}))} meals"
            )
            entity_type = "menu"
            entity_id = payload.get("day", batch_id)
            field_name = "menu_import"
            new_value = payload.get("day", "")
        else:
            summary = f"{operation} import"
            entity_type = "ops"
            entity_id = batch_id
            field_name = operation
            new_value = ""

        rows.append(
            {
                "entity_type": entity_type,
                "entity_id": entity_id,
                "field_name": field_name,
                "old_value_text": None,
                "new_value_text": new_value,
                "change_type": "import",
                "metadata": {"summary": summary, "file_ref": file_ref},
                "status": "pending",
                "submitted_by": submitter,
                "source": "ai_data_entry",
                "operation": operation,
                "full_payload": payload,
                "file_ref": file_ref,
                "batch_id": batch_id,
                "expires_at": _expires(),
            }
        )

    if not rows:
        return []

    r = _client().table("staging_entries").insert(rows).execute()
    return r.data or []


def _extract_ops(
    filename: str,
    content: bytes,
    hint: Optional[str],
    month: int,
    year: int,
    ai_config: dict,
) -> list[dict]:
    """Parse file and extract list of {operation, payload} dicts."""
    kind, data = file_parser.detect_and_parse(filename, content)

    rows = data if kind == "rows" else None
    text = data if kind == "text" else None

    operation = mapper.classify_operation(filename, hint, rows, ai_config)

    if operation == "inventory_save":
        if rows is not None:
            # try deterministic mapping first
            categories = ctx.get_categories()
            result = mapper.map_rows_to_inventory(
                rows, categories, month, year, f"Imported from {filename}"
            )
            if result is None:
                # deterministic failed — fall back to AI
                vendors = ctx.get_vendors()
                result = mapper.ai_extract_inventory(
                    rows, categories, vendors, month, year, ai_config
                )
        else:
            categories = ctx.get_categories()
            vendors = ctx.get_vendors()
            result = mapper.ai_extract_inventory(
                text, categories, vendors, month, year, ai_config
            )

        # one staging entry per item for row-level diff granularity
        ops = []
        for item in result.get("items", []):
            ops.append(
                {
                    "operation": "inventory_save",
                    "payload": {
                        "month": result["month"],
                        "year": result["year"],
                        "notes": result.get("notes", ""),
                        "items": [item],
                    },
                }
            )
        return ops

    if operation == "event_create":
        if rows is not None:
            events = mapper.map_rows_to_events(rows)
            if not events:
                events = mapper.ai_extract_events(rows, ai_config)
        else:
            events = mapper.ai_extract_events(text, ai_config)
        return [{"operation": "event_create", "payload": ev} for ev in events]

    # for other operations, send to AI with generic prompt
    if rows is not None:
        from backend.ai.parser import rows_to_text

        text = rows_to_text(rows)

    messages = [
        {
            "role": "system",
            "content": (
                f"You are a data extraction engine for a cafeteria management system. "
                f"Extract data and return a JSON object matching the {operation} operation payload. "
                f"Return ONLY valid JSON."
            ),
        },
        {"role": "user", "content": f"FILE CONTENT:\n{(text or '')[:8000]}"},
    ]
    raw = ai_engine.complete(messages, ai_config)
    payload = ai_engine.extract_json(raw)
    if isinstance(payload, list):
        payload = {"items": payload}
    return [{"operation": operation, "payload": payload}]


# ── auth ───────────────────────────────────────────────────────────────────────


async def _get_auth_user(authorization: str = Header("")) -> dict:
    """Resolve the calling user from a Bearer token (Supabase JWT or pin_ token).

    Mirrors the guard used across the other route modules so the AI data-entry
    endpoints are not anonymously reachable. Uses the service client for the
    user_profiles lookup (anon role has no SELECT policy on user_profiles).
    """
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    svc = _client()

    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
    else:
        claims = jwt_validator.verify_token(token)
        if not claims:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        user_id = claims.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing user ID")

    try:
        result = svc.table("user_profiles").select("*").eq("id", user_id).single().execute()
        user = result.data if result.data else None
    except Exception:
        user = None

    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


# ── routes ────────────────────────────────────────────────────────────────────


@router.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    hint: Optional[str] = Form(None),
    month: int = Form(default=0),
    year: int = Form(default=0),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Upload a file for AI extraction and staging.
    - hint: optional operation type hint (inventory / events / haccp / menu / log)
    - month/year: target period for inventory imports (defaults to current month/year)
    """
    now = datetime.now(timezone.utc)
    if not month:
        month = now.month
    if not year:
        year = now.year

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")

    ai_config = ctx.get_ai_config()

    try:
        ops = _extract_ops(
            file.filename or "upload", content, hint, month, year, ai_config
        )
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Extraction failed: {e}")

    if not ops:
        raise HTTPException(
            status_code=422, detail="No data could be extracted from this file."
        )

    batch_id = str(uuid.uuid4())
    submitter = _first_admin()

    try:
        staged = _stage_entries(ops, batch_id, file.filename or "upload", submitter)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Staging failed: {e}")

    # lightweight summary — full diff available via /preview/{batch_id}
    op_counts: dict[str, int] = {}
    for op in ops:
        op_counts[op["operation"]] = op_counts.get(op["operation"], 0) + 1

    return {
        "batch_id": batch_id,
        "staged_count": len(staged),
        "operations": op_counts,
        "file": file.filename,
        "month": month,
        "year": year,
        "ai_provider": ai_config.get("provider", "groq"),
        "ai_model": ai_config.get("model", ""),
        "staging_ids": [s["entry_id"] for s in staged],
    }


@router.get("/preview/{batch_id}")
async def preview_batch(batch_id: str, auth_user: dict = Depends(_get_auth_user)):
    """
    Row-level diff for all staged entries in a batch.
    Shows exactly which tables and rows will change on commit.
    """
    r = (
        _client()
        .table("staging_entries")
        .select(
            "entry_id,operation,full_payload,entity_type,metadata,status,file_ref,created_at"
        )
        .eq("batch_id", batch_id)
        .execute()
    )
    entries = r.data or []
    if not entries:
        raise HTTPException(
            status_code=404, detail="Batch not found or already committed."
        )

    pending = [e for e in entries if e.get("status") == "pending"]
    if not pending:
        raise HTTPException(
            status_code=410,
            detail="All entries in this batch have already been processed.",
        )

    try:
        diffs = diff_engine.diff_batch(pending)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diff computation failed: {e}")

    total_new = sum(
        sum(1 for row in d.get("rows", []) if row.get("status") == "new") for d in diffs
    )
    total_update = sum(
        sum(1 for row in d.get("rows", []) if row.get("status") == "update")
        for d in diffs
    )

    tables_affected = list({d["table"] for d in diffs})

    return {
        "batch_id": batch_id,
        "staged_count": len(pending),
        "tables_affected": tables_affected,
        "summary": {
            "new_rows": total_new,
            "updated_rows": total_update,
        },
        "staging_ids": [e["entry_id"] for e in pending],
        "diff": diffs,
    }


# ── AI settings ───────────────────────────────────────────────────────────────


class AISettingsBody(BaseModel):
    provider: str
    model: str
    ollama_url: Optional[str] = None


@router.get("/settings")
async def get_settings(auth_user: dict = Depends(_get_auth_user)):
    """Get current AI stack configuration."""
    config = ctx.get_ai_config()
    return {
        "current": config,
        "supported_providers": ai_engine.SUPPORTED_PROVIDERS,
        "groq_models": ai_engine.GROQ_MODELS,
        "ollama_models": ai_engine.OLLAMA_MODELS,
    }


@router.put("/settings")
async def update_settings(body: AISettingsBody, auth_user: dict = Depends(_get_auth_user)):
    """Update AI stack — provider, model, optional Ollama URL."""
    if body.provider not in ai_engine.SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=422,
            detail=f"provider must be one of {ai_engine.SUPPORTED_PROVIDERS}",
        )
    config = {"provider": body.provider, "model": body.model}
    if body.ollama_url:
        config["ollama_url"] = body.ollama_url
    try:
        ctx.save_ai_config(config)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"ok": True, "config": config}
