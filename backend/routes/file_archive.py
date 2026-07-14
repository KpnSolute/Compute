"""Manager-only API for durable MJCC file archives."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from backend.archive_storage import (
    ARCHIVE_CATEGORIES,
    archive_file_bytes,
    archive_settings_valid,
    get_archive_object,
    max_file_bytes,
    safe_filename,
)
from backend.routes import supabase_service
from backend.routes._deps import _require_manager

router = APIRouter(prefix="/api/file-archive", tags=["file-archive"])


def _get_row(file_id: str) -> dict:
    result = (
        supabase_service.table("archived_files")
        .select("*")
        .eq("id", file_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Archived file not found")
    return result.data[0]


@router.get("")
def list_files(
    category: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
    _user: dict = Depends(_require_manager),
):
    query = (
        supabase_service.table("archived_files")
        .select("*")
        .eq("status", "active")
        .order("uploaded_at", desc=True)
        .range(max(offset, 0), max(offset, 0) + min(max(limit, 1), 250) - 1)
    )
    if category:
        if category not in ARCHIVE_CATEGORIES:
            raise HTTPException(status_code=422, detail="Unsupported category")
        query = query.eq("category", category)
    if search and search.strip():
        needle = search.strip().replace("%", "\\%").replace("_", "\\_")
        query = query.ilike("original_filename", f"%{needle}%")
    return {
        "files": query.execute().data or [],
        "storage_ready": archive_settings_valid(),
    }


@router.post("", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    category: str = Form("document"),
    description: str | None = Form(None),
    month: int = Form(0),
    year: int = Form(0),
    week: int = Form(0),
    user: dict = Depends(_require_manager),
):
    if month not in range(0, 13):
        raise HTTPException(status_code=422, detail="Month must be 1 through 12")
    if year and not 2000 <= year <= 2200:
        raise HTTPException(status_code=422, detail="Year must be 2000 through 2200")
    if week not in range(0, 7):
        raise HTTPException(status_code=422, detail="Week must be 0 through 6")
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > max_file_bytes():
        raise HTTPException(status_code=413, detail="File exceeds archive size limit")
    try:
        return archive_file_bytes(
            content=content,
            filename=file.filename or "upload",
            content_type=file.content_type,
            category=category,
            uploaded_by=user["id"],
            description=description,
            month=month or None,
            year=year or None,
            week=week,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/{file_id}/download")
def download_file(file_id: str, _user: dict = Depends(_require_manager)):
    row = _get_row(file_id)
    try:
        obj = get_archive_object(row)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    filename = safe_filename(row["original_filename"])
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    body = obj["Body"]

    def stream():
        try:
            yield from body.iter_chunks(chunk_size=1024 * 1024)
        finally:
            body.close()

    return StreamingResponse(
        stream(),
        media_type=row.get("content_type") or "application/octet-stream",
        headers={
            "Content-Disposition": disposition,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Length": str(obj.get("ContentLength", row["size_bytes"])),
        },
    )


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: str, user: dict = Depends(_require_manager)):
    _get_row(file_id)
    deleted_at = datetime.now(UTC).isoformat()
    (
        supabase_service.table("archived_files")
        .update(
            {"status": "deleted", "deleted_at": deleted_at, "deleted_by": user["id"]}
        )
        .eq("id", file_id)
        .eq("status", "active")
        .execute()
    )
    return None
