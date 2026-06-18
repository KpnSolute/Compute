"""
Data Entry API — AI-powered file ingestion pipeline.
POST /api/data-entry/upload   — parse file → AI extract → stage → return batch preview
GET  /api/data-entry/preview/{batch_id} — row-level diff for a staged batch
GET  /api/data-entry/settings — current AI stack config
PUT  /api/data-entry/settings — update AI stack config
"""

import logging
import time
import uuid
import os
from datetime import datetime, timezone
from typing import Any, Optional
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Depends
from pydantic import BaseModel
from backend.routes import jwt_validator
from supabase import create_client
from backend.ai import engine as ai_engine
from backend.ai import invoice_parser
from backend.ai import parser as file_parser
from backend.ai import mapper, context as ctx, diff as diff_engine

log = logging.getLogger("mjcc.data_entry")

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
        elif operation == "inventory_week_update":
            items = payload.get("items", [])
            summary = (
                f"{len(items)} item(s) → W{payload.get('week')} "
                f"{payload.get('direction', 'received')}"
            )
            entity_type = "inventory"
            entity_id = batch_id
            field_name = "weekly_invoice"
            new_value = f"W{payload.get('week')} {payload.get('direction')}"
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
    week: int = 0,
    direction: str = "received",
    tools_cfg: dict | None = None,
    called_by: str | None = None,
) -> tuple[list[dict], dict]:
    """Parse file and return (ops, invoice_meta).

    invoice_meta is the raw parsed meta dict for invoice PDFs/images
    (contains 'reconciliation', 'invoice_number', etc.).  It is {} for
    non-invoice files.  Callers MUST use this dict rather than re-parsing
    the file — re-parsing on a 512MB host causes OOM spikes.
    """
    kind, data = file_parser.detect_and_parse(filename, content)

    # Deterministic invoice parser short-circuit: no AI needed for structured invoices.
    if kind == "invoice_items":
        parsed = data  # {'meta': {...}, 'items': [...]}
        meta = parsed.get("meta", {})
        categories = ctx.get_categories()
        ops = invoice_parser.invoice_items_to_ops(
            parsed["items"],
            meta,
            month,
            year,
            week,
            direction,
            categories,
        )
        return ops, meta

    # Image bundles (ZIP-of-images, single images that OCR couldn't parse) — try vision, then OCR
    if kind == "invoice_images":
        img_data = data  # {'images': [bytes, ...], 'meta': {...}}
        images = img_data.get("images", [])
        img_meta = img_data.get("meta", {})
        provider = ai_config.get("provider", "")
        model = ai_config.get("model", "")

        if ai_engine.is_vision_capable(provider, model, ai_config):
            try:
                parsed = invoice_parser.extract_invoice_vision(
                    images, img_meta, ai_config, called_by=called_by
                )
                if parsed.get("items"):
                    meta = parsed.get("meta", {})
                    categories = ctx.get_categories()
                    ops = invoice_parser.invoice_items_to_ops(
                        parsed["items"],
                        meta,
                        month,
                        year,
                        week,
                        direction,
                        categories,
                    )
                    return ops, meta
            except Exception:
                pass  # fall through to OCR degradation

        # OCR degradation: run each image through the OCR cascade
        for img_bytes in images[:10]:
            try:
                ocr_parsed = invoice_parser.parse_invoice_bytes_image(
                    img_bytes, "image.jpg"
                )
                if ocr_parsed.get("items"):
                    meta = ocr_parsed.get("meta", {})
                    categories = ctx.get_categories()
                    ops = invoice_parser.invoice_items_to_ops(
                        ocr_parsed["items"],
                        meta,
                        month,
                        year,
                        week,
                        direction,
                        categories,
                    )
                    return ops, meta
            except Exception:
                pass

        # Both paths failed — raise a helpful, actionable message
        if not ai_engine.is_vision_capable(provider, model, ai_config):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"This file contains images but the configured model '{model}' does not support vision. "
                    "Select a vision-capable model (e.g. Llama 4, Claude, GPT-4o, Pixtral) "
                    "in Data Entry → AI stack settings."
                ),
            )
        raise HTTPException(
            status_code=422,
            detail="Could not extract data from this image file — vision extraction and OCR both failed.",
        )

    rows = data if kind == "rows" else None
    text = data if kind == "text" else None

    operation = mapper.classify_operation(filename, hint, rows, ai_config)

    # Enforce tool toggles — reject before any AI call if the tool is disabled
    from backend.ai.context import OPERATION_TO_TOOL

    tool_key = OPERATION_TO_TOOL.get(operation)
    if tool_key and tools_cfg is not None and not tools_cfg.get(tool_key, True):
        raise HTTPException(
            status_code=403,
            detail=f"AI tool '{tool_key}' is disabled by the administrator.",
        )

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
        weekly = week in (1, 2, 3, 4, 5)
        ops = []
        for item in result.get("items", []):
            if weekly:
                # Weekly invoice posting: route the parsed quantity into a single
                # w{week}_{received|issued} column for the chosen period, without
                # disturbing on_hand or other weeks.
                ops.append(
                    {
                        "operation": "inventory_week_update",
                        "payload": {
                            "month": result["month"],
                            "year": result["year"],
                            "week": week,
                            "direction": direction,
                            "review_new": True,
                            "items": [
                                {
                                    "sku": item.get("sku"),
                                    "desc": item.get("desc"),
                                    "category": item.get("category"),
                                    "qty": item.get("onHand", 0),
                                    "price": item.get("price"),
                                    "par": item.get("par"),
                                }
                            ],
                        },
                    }
                )
            else:
                ops.append(
                    {
                        "operation": "inventory_save",
                        "payload": {
                            "month": result["month"],
                            "year": result["year"],
                            "notes": result.get("notes", ""),
                            # Ingested items whose SKU isn't already in the index
                            # land in "New Items" so the manager reviews additions.
                            "review_new": True,
                            "items": [item],
                        },
                    }
                )
        return ops, {}

    if operation == "event_create":
        if rows is not None:
            events = mapper.map_rows_to_events(rows)
            if not events:
                events = mapper.ai_extract_events(rows, ai_config)
        else:
            events = mapper.ai_extract_events(text, ai_config)
        return [{"operation": "event_create", "payload": ev} for ev in events], {}

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
    raw = ai_engine.complete(
        messages, ai_config, operation=operation, called_by=called_by
    )
    payload = ai_engine.extract_json(raw)
    if isinstance(payload, list):
        payload = {"items": payload}
    return [{"operation": operation, "payload": payload}], {}


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
        result = (
            svc.table("user_profiles").select("*").eq("id", user_id).single().execute()
        )
        user = result.data if result.data else None
    except Exception:
        user = None

    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


# ── SKU resolution pass (before staging) ─────────────────────────────────────


def _resolve_and_queue_items(
    ops: list[dict],
    source_ref: str,
    vendor_id: str | None = None,
) -> tuple[list[dict], int]:
    """Resolve every parsed SKU via resolve_invoice_sku RPC.

    - direct / alias → keep the item in the op (it maps to a known inventory_items row).
    - none (unknown) → insert a sku_review_queue row for manager triage; DROP the item
      from the staging op so no silent MJC- duplicate is created.

    Returns (filtered_ops, queued_count).
    """
    svc = _client()
    resolved_ops: list[dict] = []
    queued_count = 0
    for op in ops:
        if op.get("operation") not in ("inventory_save", "inventory_week_update"):
            resolved_ops.append(op)
            continue

        items_in = op["payload"].get("items", [])
        items_kept: list[dict] = []

        for item in items_in:
            sku = (item.get("sku") or "").strip()
            if not sku:
                items_kept.append(item)
                continue

            match_type = "none"
            try:
                rpc_result = svc.rpc(
                    "resolve_invoice_sku",
                    {"p_sku": sku, "p_vendor": vendor_id},
                ).execute()
                data = rpc_result.data
                if isinstance(data, list):
                    data = data[0] if data else {}
                match_type = (data or {}).get("match_type", "none")
            except Exception:
                pass  # network/rpc error — treat as unknown and queue

            if match_type in ("direct", "alias"):
                items_kept.append(item)
            else:
                # Queue for manager review; do not stage as a new item.
                try:
                    svc.table("sku_review_queue").insert(
                        {
                            "parsed_sku": sku,
                            "parsed_description": item.get("desc")
                            or item.get("description")
                            or "",
                            "vendor_id": vendor_id,
                            "source_ref": source_ref,
                            "qty": float(item.get("qty") or item.get("onHand") or 0),
                            "unit_price": float(item.get("price") or 0),
                            "status": "pending",
                        }
                    ).execute()
                    queued_count += 1
                except Exception:
                    pass  # Don't block the import if queue insert fails

        if items_kept:
            resolved_ops.append(
                {**op, "payload": {**op["payload"], "items": items_kept}}
            )
        # ops with zero remaining items are silently dropped (all items queued)

    return resolved_ops, queued_count


# ── invoice record helpers ────────────────────────────────────────────────────


def _upsert_invoice_record(
    meta: dict,
    month: int,
    year: int,
    week: int,
    submitter_id: str,
) -> tuple[Optional[str], bool]:
    """Insert an invoices row from parsed meta.  Returns (invoice_id, already_existed).

    invoice_number is the idempotency key.  If a row with the same invoice_number
    already exists we return its id without inserting (idempotent re-upload guard).
    Returns (None, False) when invoice_number is absent (non-US Foods uploads).
    """
    svc = _client()
    inv_num = (meta.get("invoice_number") or "").strip()
    if not inv_num:
        return None, False

    # Idempotency check — only block re-upload when a data-entry-created (status=pending)
    # record already exists.  Pre-existing verified/applied rows were entered manually
    # and should be updatable; we upsert those in-place rather than returning 409.
    try:
        existing = (
            svc.table("invoices")
            .select("id, status")
            .eq("invoice_number", inv_num)
            .limit(1)
            .execute()
        )
        if existing.data:
            row_data = existing.data[0]
            if row_data.get("status") == "pending":
                # Genuinely in-flight data-entry record — block duplicate staging
                return row_data["id"], True
            # Pre-existing verified/applied invoice — allow re-import (will overwrite w{N})
            return row_data["id"], False
    except Exception:
        pass

    # Parse invoice_date — accept MM/DD/YYYY or YYYY-MM-DD
    inv_date_raw = (meta.get("invoice_date") or "").strip()
    inv_date: Optional[str] = None
    if inv_date_raw:
        try:
            from datetime import datetime as _dt

            for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
                try:
                    inv_date = _dt.strptime(inv_date_raw, fmt).date().isoformat()
                    break
                except ValueError:
                    continue
        except Exception:
            pass
    if not inv_date:
        inv_date = _now()[:10]  # fallback to today

    def _to_dec(v: Any) -> Optional[float]:
        try:
            return float(str(v).replace(",", "")) if v is not None else None
        except (ValueError, TypeError):
            return None

    row: dict = {
        "invoice_number": inv_num,
        "invoice_date": inv_date,
        "month": month,
        "year": year,
        "week_number": week or None,
        "status": "pending",
        "applied_by": submitter_id,
        "created_at": _now(),
        "updated_at": _now(),
    }
    for field, key in [
        ("subtotal", "subtotal"),
        ("vizient_discount", "vizient_discount"),
        ("fuel_surcharge", "fuel_surcharge"),
        ("net_total", "net_total"),
        ("account_number", "account_number"),
        ("order_number", "order_number"),
        ("route_number", "route"),
        ("stop_number", "stop"),
    ]:
        val = meta.get(key)
        if val is not None:
            row[field] = (
                _to_dec(val)
                if field
                in ("subtotal", "vizient_discount", "fuel_surcharge", "net_total")
                else str(val)
            )

    try:
        r = svc.table("invoices").insert(row).execute()
        invoice_id = r.data[0]["id"] if r.data else None
        return invoice_id, False
    except Exception:
        return None, False


# ── routes ────────────────────────────────────────────────────────────────────


@router.post("/upload", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    hint: Optional[str] = Form(None),
    month: int = Form(default=0),
    year: int = Form(default=0),
    week: int = Form(default=0),
    direction: str = Form(default="received"),
    description: Optional[str] = Form(None),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Upload a file for AI extraction and staging.
    - hint: optional operation type hint (inventory / events / haccp / menu / log)
    - month/year: target period for inventory imports (defaults to current month/year)
    - week: 1-4 to post a weekly invoice into that week's column (0 = whole-month save)
    - direction: 'received' (Imports) or 'issued' (Exports) for a weekly post
    """
    job_start = time.monotonic()
    now = datetime.now(timezone.utc)
    if not month:
        month = now.month
    if not year:
        year = now.year

    content = await file.read()
    fname = file.filename or "upload"
    fsize_kb = round(len(content) / 1024, 1)

    log.info(
        "[DATA-ENTRY] Job started | file=%s size=%sKB month=%s year=%s week=%s dir=%s user=%s",
        fname,
        fsize_kb,
        month,
        year,
        week,
        direction,
        auth_user.get("username", auth_user["id"]),
    )

    if not content:
        log.warning("[DATA-ENTRY] Rejected: empty file | file=%s", fname)
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        log.warning(
            "[DATA-ENTRY] Rejected: file too large (%sKB) | file=%s", fsize_kb, fname
        )
        raise HTTPException(status_code=413, detail="File too large (max 10 MB).")

    ai_config = ctx.get_ai_config()
    tools_cfg = ctx.get_ai_tools_config()

    try:
        parse_start = time.monotonic()
        ops, invoice_meta = _extract_ops(
            fname,
            content,
            hint,
            month,
            year,
            ai_config,
            week=week,
            direction=direction,
            tools_cfg=tools_cfg,
            called_by=auth_user["id"],
        )
        parse_elapsed = round(time.monotonic() - parse_start, 2)
        log.info(
            "[DATA-ENTRY] Parse complete | file=%s ops=%d elapsed=%.2fs provider=%s",
            fname,
            len(ops),
            parse_elapsed,
            ai_config.get("provider", "?"),
        )
    except HTTPException:
        raise
    except Exception as e:
        log.error("[DATA-ENTRY] Parse failed | file=%s error=%s", fname, e)
        raise HTTPException(status_code=422, detail=f"Extraction failed: {e}")

    if not ops:
        log.warning("[DATA-ENTRY] No data extracted | file=%s", fname)
        raise HTTPException(
            status_code=422, detail="No data could be extracted from this file."
        )

    # invoice_meta comes directly from _extract_ops (no second parse needed).
    # reconcile_and_adjust() already ran inside parse_invoice_bytes_pdf.
    parsed_meta: dict = invoice_meta
    reconciliation: dict = parsed_meta.get("reconciliation", {})
    invoice_id: Optional[str] = None
    invoice_is_pending_dup = False
    if any(
        op.get("operation") in ("inventory_save", "inventory_week_update") for op in ops
    ):
        # Gate: refuse to stage when totals are off by more than 5%
        if reconciliation and reconciliation.get("net_total", 0) > 0:
            recon = reconciliation
            log.info(
                "[DATA-ENTRY] Reconcile | file=%s subtotal=%.2f net_total=%.2f "
                "vizient=%.2f factor=%.4f delta_pct=%.2f%% ok=%s",
                fname,
                recon.get("computed_subtotal", 0),
                recon.get("net_total", 0),
                recon.get("vizient_discount", 0),
                recon.get("discount_factor", 1),
                recon.get("delta_pct", 0),
                recon.get("reconciled", False),
            )
            delta_pct = recon.get("delta_pct", 0)
            if delta_pct > 5.0:
                log.error(
                    "[DATA-ENTRY] BLOCKED reconciliation_failed | file=%s delta_pct=%.2f%%",
                    fname,
                    delta_pct,
                )
                raise HTTPException(
                    status_code=422,
                    detail={
                        "error": "reconciliation_failed",
                        "message": (
                            f"Invoice line items sum to ${recon['computed_subtotal']:,.2f} "
                            f"but the invoice total is ${recon['net_total']:,.2f} "
                            f"(delta {delta_pct:.1f}%). "
                            "Fix the parse or re-upload a corrected file."
                        ),
                        "reconciliation": recon,
                    },
                )

        invoice_id, invoice_is_pending_dup = _upsert_invoice_record(
            parsed_meta, month, year, week, auth_user["id"]
        )
        if invoice_is_pending_dup and invoice_id:
            log.warning(
                "[DATA-ENTRY] BLOCKED duplicate_invoice | file=%s invoice=%s",
                fname,
                parsed_meta.get("invoice_number"),
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "duplicate_invoice",
                    "message": (
                        f"Invoice {parsed_meta.get('invoice_number')} is already staged "
                        "and pending review. Merge or reject that batch before re-importing."
                    ),
                    "invoice_id": invoice_id,
                },
            )

    # Resolve SKUs: unknown ones go to sku_review_queue, not staging.
    ops, sku_queued = _resolve_and_queue_items(ops, fname)
    if sku_queued:
        log.warning(
            "[DATA-ENTRY] SKUs queued for review | file=%s queued=%d", fname, sku_queued
        )

    if not ops:
        log.error(
            "[DATA-ENTRY] BLOCKED all-unknown-skus | file=%s queued=%d",
            fname,
            sku_queued,
        )
        raise HTTPException(
            status_code=422,
            detail=(
                f"All {sku_queued} parsed item(s) have unknown SKUs and were queued for "
                "manager review (GET /api/sku-review)."
            ),
        )

    batch_id = str(uuid.uuid4())
    submitter = auth_user["id"]

    # Expire any stale pending batches from the same source file so re-uploads
    # replace rather than accumulate duplicate staging rows.
    try:
        svc = _client()
        stale = (
            svc.table("staging_entries")
            .select("entry_id, batch_id")
            .eq("file_ref", fname)
            .eq("status", "pending")
            .execute()
        )
        if stale.data:
            stale_ids = [r["entry_id"] for r in stale.data]
            stale_batches = list(
                {r["batch_id"] for r in stale.data if r.get("batch_id")}
            )
            svc.table("staging_entries").update(
                {"status": "rejected", "review_note": "superseded by re-upload"}
            ).in_("entry_id", stale_ids).execute()
            log.info(
                "[DATA-ENTRY] Superseded %d stale pending entries | file=%s old_batches=%s",
                len(stale_ids),
                fname,
                stale_batches,
            )
    except Exception as _e:
        log.warning(
            "[DATA-ENTRY] Could not expire stale entries | file=%s err=%s", fname, _e
        )

    try:
        staged = _stage_entries(ops, batch_id, fname, submitter)
    except Exception as e:
        log.error(
            "[DATA-ENTRY] Staging failed | file=%s batch=%s error=%s",
            fname,
            batch_id,
            e,
        )
        raise HTTPException(status_code=500, detail=f"Staging failed: {e}")

    # lightweight summary — full diff available via /preview/{batch_id}
    op_counts: dict[str, int] = {}
    for op in ops:
        op_counts[op["operation"]] = op_counts.get(op["operation"], 0) + 1

    resp: dict = {
        "batch_id": batch_id,
        "staged_count": len(staged),
        "sku_queued": sku_queued,
        "is_reimport": invoice_id is not None and not invoice_is_pending_dup,
        "operations": op_counts,
        "file": file.filename,
        "month": month,
        "year": year,
        "ai_provider": ai_config.get("provider", "groq"),
        "ai_model": ai_config.get("model", ""),
        "staging_ids": [s["entry_id"] for s in staged],
    }
    if invoice_id:
        resp["invoice_id"] = invoice_id
    if reconciliation:
        resp["reconciliation"] = reconciliation
    if description:
        resp["description"] = description[:500]

    total_elapsed = round(time.monotonic() - job_start, 2)
    log.info(
        "[DATA-ENTRY] Job complete | file=%s batch=%s staged=%d sku_queued=%d "
        "ops=%s elapsed=%.2fs reimport=%s",
        fname,
        batch_id,
        len(staged),
        sku_queued,
        dict(op_counts),
        total_elapsed,
        resp.get("is_reimport", False),
    )
    return resp


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
    """Get current AI stack configuration from ai_stack_config + ai_provider_keys + ai_providers."""
    svc = _client()
    # Current active stack
    try:
        stack_r = (
            svc.table("ai_stack_config")
            .select("provider, key_id, model, vision_capable, is_vision, ollama_url")
            .eq("name", "default")
            .limit(1)
            .execute()
        )
        stack = stack_r.data[0] if stack_r.data else {}
    except Exception:
        stack = {}

    current = {
        "provider": stack.get("provider", ""),
        "model": stack.get("model", ""),
        "key_id": stack.get("key_id"),
        "is_vision": stack.get("vision_capable") or stack.get("is_vision") or False,
        "ollama_url": stack.get("ollama_url"),
    }

    # Providers from ai_providers table
    try:
        prov_r = (
            svc.table("ai_providers")
            .select("provider, label, description, has_key, default_url, sort_order")
            .order("sort_order")
            .execute()
        )
        providers = prov_r.data or []
    except Exception:
        providers = []

    # Keys from ai_provider_keys — never return raw api_key
    try:
        keys_r = (
            svc.table("ai_provider_keys")
            .select(
                "id, provider, label, is_active, is_default, model_override, base_url, api_key, created_at, updated_at"
            )
            .order("created_at")
            .execute()
        )
        keys = [
            {
                "id": k["id"],
                "provider": k["provider"],
                "label": k.get("label", ""),
                "is_active": k.get("is_active", False),
                "is_default": k.get("is_default", False),
                "has_key": bool(k.get("api_key")),
                "model_override": k.get("model_override"),
                "base_url": k.get("base_url"),
                "updated_at": k.get("updated_at"),
            }
            for k in (keys_r.data or [])
        ]
    except Exception:
        keys = []

    return {
        "current": current,
        "providers": providers,
        "keys": keys,
        "vision_models": list(ai_engine.VISION_MODELS),
        "ai_enabled": True,
    }


class AIKeyCreateBody(BaseModel):
    provider: str
    label: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_override: Optional[str] = None
    set_active: bool = False
    notes: Optional[str] = None


class AIKeyPatchBody(BaseModel):
    label: Optional[str] = None
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model_override: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class AIStackBody(BaseModel):
    provider: str
    key_id: str
    model: str
    vision_capable: bool = False


@router.put("/settings")
async def update_settings(
    body: AISettingsBody, auth_user: dict = Depends(_get_auth_user)
):
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


_ROLE_LEVELS = {"staff": 10, "assistant": 20, "manager": 30, "admin": 40, "sudo": 50}


@router.get("/models")
async def get_models(provider: str, auth_user: dict = Depends(_get_auth_user)):
    """Live model discovery for a provider. Falls back to static list on any error."""
    if _ROLE_LEVELS.get(auth_user.get("role", ""), 0) < 30:
        raise HTTPException(status_code=403, detail="Manager+ required")

    if provider not in ai_engine.SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {provider}")

    # Get active key/url for this provider from DB
    svc = _client()
    api_key: str | None = None
    base_url: str | None = None
    try:
        kr = (
            svc.table("ai_provider_keys")
            .select("api_key, base_url")
            .eq("provider", provider)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if kr.data:
            api_key = kr.data[0].get("api_key")
            base_url = kr.data[0].get("base_url")
    except Exception:
        pass

    model_ids: list[str] = []

    try:
        import httpx as _httpx

        if provider == "groq" and api_key:
            r = _httpx.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            r.raise_for_status()
            model_ids = [m["id"] for m in r.json().get("data", [])]

        elif provider == "anthropic":
            model_ids = list(ai_engine.ANTHROPIC_MODELS)

        elif provider == "openai" and api_key:
            url = (base_url or "https://api.openai.com").rstrip("/") + "/v1/models"
            r = _httpx.get(
                url, headers={"Authorization": f"Bearer {api_key}"}, timeout=10
            )
            r.raise_for_status()
            all_ids = [m["id"] for m in r.json().get("data", [])]
            model_ids = [
                m for m in all_ids if any(p in m for p in ("gpt-4", "gpt-3.5"))
            ]

        elif provider == "mistral" and api_key:
            r = _httpx.get(
                "https://api.mistral.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
            r.raise_for_status()
            model_ids = [m["id"] for m in r.json().get("data", [])]

        elif provider == "ollama":
            ollama_base = base_url or "http://localhost:11434"
            r = _httpx.get(f"{ollama_base}/api/tags", timeout=10)
            r.raise_for_status()
            model_ids = [m["name"] for m in r.json().get("models", [])]

        elif provider == "lm_studio":
            lm_base = base_url or "http://localhost:1234"
            r = _httpx.get(f"{lm_base}/v1/models", timeout=10)
            r.raise_for_status()
            model_ids = [m["id"] for m in r.json().get("data", [])]

    except Exception:
        pass

    # Fall back to static list if live discovery yielded nothing
    if not model_ids:
        static = {
            "groq": ai_engine.GROQ_MODELS,
            "anthropic": ai_engine.ANTHROPIC_MODELS,
            "openai": ai_engine.OPENAI_MODELS,
            "mistral": ai_engine.MISTRAL_MODELS,
            "ollama": ai_engine.OLLAMA_MODELS,
            "lm_studio": ai_engine.LM_STUDIO_MODELS,
        }
        model_ids = static.get(provider, [])

    models = [
        {"id": mid, "label": mid, "vision": mid in ai_engine.VISION_MODELS}
        for mid in model_ids
    ]
    return {"provider": provider, "models": models}


@router.post("/ai-keys")
async def create_ai_key(
    body: AIKeyCreateBody, auth_user: dict = Depends(_get_auth_user)
):
    """Create a named key in ai_provider_keys. Sudo only."""
    if auth_user.get("role") != "sudo":
        raise HTTPException(status_code=403, detail="Sudo required")
    if body.provider not in ai_engine.SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=422, detail=f"Unknown provider: {body.provider}"
        )

    svc = _client()
    now = _now()
    row: dict = {
        "provider": body.provider,
        "label": body.label,
        "is_active": False,
        "is_default": False,
        "created_by": auth_user["id"],
        "created_at": now,
        "updated_at": now,
    }
    if body.api_key:
        row["api_key"] = body.api_key
    if body.base_url:
        row["base_url"] = body.base_url
    if body.model_override:
        row["model_override"] = body.model_override
    if body.notes:
        row["notes"] = body.notes

    try:
        r = svc.table("ai_provider_keys").insert(row).execute()
        new_row = r.data[0] if r.data else {}
        if body.set_active and new_row.get("id"):
            # Deactivate others for same provider, activate this one
            svc.table("ai_provider_keys").update({"is_active": False}).eq(
                "provider", body.provider
            ).neq("id", new_row["id"]).execute()
            svc.table("ai_provider_keys").update({"is_active": True}).eq(
                "id", new_row["id"]
            ).execute()
            new_row["is_active"] = True
        return {
            "id": new_row.get("id"),
            "provider": new_row.get("provider"),
            "label": new_row.get("label", ""),
            "is_active": new_row.get("is_active", False),
            "has_key": bool(body.api_key),
            "updated_at": new_row.get("updated_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.patch("/ai-keys/{key_id}")
async def patch_ai_key(
    key_id: str, body: AIKeyPatchBody, auth_user: dict = Depends(_get_auth_user)
):
    """Update a named key by UUID. Sudo only."""
    if auth_user.get("role") != "sudo":
        raise HTTPException(status_code=403, detail="Sudo required")

    svc = _client()
    now = _now()
    update_data: dict = {"updated_at": now}

    if body.label is not None:
        update_data["label"] = body.label
    if body.api_key is not None and body.api_key != "":
        update_data["api_key"] = body.api_key
    if body.base_url is not None:
        update_data["base_url"] = body.base_url or None
    if body.model_override is not None:
        update_data["model_override"] = body.model_override or None
    if body.notes is not None:
        update_data["notes"] = body.notes or None

    if body.is_active is True:
        # Get provider first to deactivate siblings
        try:
            existing = (
                svc.table("ai_provider_keys")
                .select("provider")
                .eq("id", key_id)
                .limit(1)
                .execute()
            )
            if existing.data:
                prov = existing.data[0]["provider"]
                svc.table("ai_provider_keys").update({"is_active": False}).eq(
                    "provider", prov
                ).neq("id", key_id).execute()
        except Exception:
            pass
        update_data["is_active"] = True
    elif body.is_active is False:
        update_data["is_active"] = False

    try:
        r = svc.table("ai_provider_keys").update(update_data).eq("id", key_id).execute()
        row = r.data[0] if r.data else {}
        return {
            "id": row.get("id", key_id),
            "is_active": row.get("is_active", False),
            "has_key": bool(row.get("api_key")),
            "updated_at": row.get("updated_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/ai-keys/{key_id}")
async def delete_ai_key(key_id: str, auth_user: dict = Depends(_get_auth_user)):
    """Delete a named key. Sudo only. 409 if it is the only active key for its provider."""
    if auth_user.get("role") != "sudo":
        raise HTTPException(status_code=403, detail="Sudo required")

    svc = _client()
    # Fetch the key to check if it is active + get provider
    try:
        existing = (
            svc.table("ai_provider_keys")
            .select("provider, is_active")
            .eq("id", key_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            raise HTTPException(status_code=404, detail="Key not found")
        row = existing.data[0]
        if row.get("is_active"):
            # Check if it is the only active key for this provider
            active_count = (
                svc.table("ai_provider_keys")
                .select("id", count="exact")
                .eq("provider", row["provider"])
                .eq("is_active", True)
                .execute()
            )
            if (active_count.count or 0) <= 1:
                raise HTTPException(
                    status_code=409,
                    detail="Cannot delete the only active key for this provider.",
                )
        svc.table("ai_provider_keys").delete().eq("id", key_id).execute()
        return {"ok": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("/ai-stack")
async def set_ai_stack(body: AIStackBody, auth_user: dict = Depends(_get_auth_user)):
    """Set the active AI stack (provider + key + model). Manager+ required."""
    if _ROLE_LEVELS.get(auth_user.get("role", ""), 0) < 30:
        raise HTTPException(status_code=403, detail="Manager+ required")
    if body.provider not in ai_engine.SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=422, detail=f"Unknown provider: {body.provider}"
        )

    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    row = {
        "name": "default",
        "provider": body.provider,
        "key_id": body.key_id,
        "model": body.model,
        "vision_capable": body.vision_capable,
        "updated_by": auth_user["id"],
        "updated_at": now,
    }
    try:
        svc = _client()
        r = svc.table("ai_stack_config").upsert(row, on_conflict="name").execute()
        return r.data[0] if r.data else row
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── AI management — sudo only ─────────────────────────────────────────────────


async def _require_sudo_for_ai(auth_user: dict = Depends(_get_auth_user)) -> dict:
    """Require sudo role for all AI management endpoints (keys, tools, usage)."""
    if auth_user.get("role") != "sudo":
        raise HTTPException(status_code=403, detail="AI management requires sudo role")
    return auth_user


class AIKeyUpdateBody(BaseModel):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/ai-keys")
async def get_ai_keys(auth_user: dict = Depends(_require_sudo_for_ai)):
    """List all AI provider key status. Never returns the actual key string."""
    try:
        result = (
            _client()
            .table("api_keys")
            .select("provider,is_active,base_url,updated_at,api_key")
            .execute()
        )
        rows = result.data or []
        return [
            {
                "provider": r["provider"],
                "is_active": r["is_active"],
                "has_key": bool(r.get("api_key")),
                "base_url": r.get("base_url"),
                "updated_at": r.get("updated_at"),
            }
            for r in rows
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.put("/ai-keys/{provider}")
async def update_ai_key(
    provider: str,
    body: AIKeyUpdateBody,
    auth_user: dict = Depends(_require_sudo_for_ai),
):
    """Update API key / base_url / active status for a provider."""
    if provider not in ai_engine.SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"Unknown provider: {provider}")

    svc = _client()
    now = _now()
    update_data: dict = {"updated_at": now, "updated_by": auth_user["id"]}

    if body.api_key is not None and body.api_key != "":
        update_data["api_key"] = body.api_key
    if body.base_url is not None:
        update_data["base_url"] = body.base_url or None

    if body.is_active is True:
        # Only one provider active at a time
        try:
            svc.table("api_keys").update({"is_active": False}).neq(
                "provider", provider
            ).execute()
        except Exception:
            pass
        update_data["is_active"] = True
    elif body.is_active is False:
        update_data["is_active"] = False

    try:
        result = (
            svc.table("api_keys")
            .upsert({"provider": provider, **update_data}, on_conflict="provider")
            .execute()
        )
        row = result.data[0] if result.data else {}
        return {
            "provider": provider,
            "is_active": row.get("is_active", False),
            "has_key": bool(row.get("api_key")),
            "updated_at": row.get("updated_at"),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── AI tools config ───────────────────────────────────────────────────────────


class AIToolsBody(BaseModel):
    tools: dict  # {tool_key: bool}


@router.get("/ai-tools")
async def get_ai_tools(auth_user: dict = Depends(_require_sudo_for_ai)):
    """Return current AI tool toggle configuration."""
    return ctx.get_ai_tools_config()


@router.put("/ai-tools")
async def update_ai_tools(
    body: AIToolsBody, auth_user: dict = Depends(_require_sudo_for_ai)
):
    """Update AI tool toggles. Only known tool keys are stored."""
    from backend.ai.context import DEFAULT_TOOLS

    sanitized = {k: bool(v) for k, v in body.tools.items() if k in DEFAULT_TOOLS}
    try:
        ctx.save_ai_tools_config(sanitized)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return ctx.get_ai_tools_config()


# ── AI usage stats ────────────────────────────────────────────────────────────


@router.get("/ai-usage")
async def get_ai_usage(
    days: int = 30,
    limit: int = 50,
    auth_user: dict = Depends(_require_sudo_for_ai),
):
    """
    Return AI usage stats + recent log rows for the past N days.
    days  — rolling window for aggregate stats (default 30)
    limit — number of recent rows to return (default 50, max 200)
    """
    svc = _client()
    from datetime import datetime, timezone, timedelta

    since = (datetime.now(timezone.utc) - timedelta(days=min(days, 365))).isoformat()
    limit = min(limit, 200)

    # ── aggregate stats ──
    try:
        agg_rows = (
            svc.table("ai_usage_logs")
            .select("provider,tokens_in,tokens_out,cost_usd,success,duration_ms")
            .gte("created_at", since)
            .execute()
        ).data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    total_calls = len(agg_rows)
    total_success = sum(1 for r in agg_rows if r.get("success"))
    total_tokens_in = sum(r.get("tokens_in", 0) or 0 for r in agg_rows)
    total_tokens_out = sum(r.get("tokens_out", 0) or 0 for r in agg_rows)
    total_cost = sum(float(r.get("cost_usd") or 0) for r in agg_rows)
    avg_duration = (
        int(sum(r.get("duration_ms", 0) or 0 for r in agg_rows) / total_calls)
        if total_calls
        else 0
    )

    # per-provider breakdown
    by_provider: dict[str, dict] = {}
    for r in agg_rows:
        p = r.get("provider", "unknown")
        if p not in by_provider:
            by_provider[p] = {
                "calls": 0,
                "tokens_in": 0,
                "tokens_out": 0,
                "cost_usd": 0.0,
            }
        by_provider[p]["calls"] += 1
        by_provider[p]["tokens_in"] += r.get("tokens_in", 0) or 0
        by_provider[p]["tokens_out"] += r.get("tokens_out", 0) or 0
        by_provider[p]["cost_usd"] += float(r.get("cost_usd") or 0)

    # per-operation breakdown
    by_operation: dict[str, int] = {}
    for r in agg_rows:
        op = r.get("operation") or "unknown"
        by_operation[op] = by_operation.get(op, 0) + 1

    # ── recent rows ──
    try:
        recent = (
            svc.table("ai_usage_logs")
            .select(
                "id,provider,model,operation,tokens_in,tokens_out,cost_usd,duration_ms,success,error_msg,called_by,created_at"
            )
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return {
        "window_days": days,
        "summary": {
            "total_calls": total_calls,
            "successful": total_success,
            "failed": total_calls - total_success,
            "tokens_in": total_tokens_in,
            "tokens_out": total_tokens_out,
            "total_tokens": total_tokens_in + total_tokens_out,
            "cost_usd": round(total_cost, 6),
            "avg_duration_ms": avg_duration,
        },
        "by_provider": by_provider,
        "by_operation": by_operation,
        "recent": recent,
    }
