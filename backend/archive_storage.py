"""Backend-only Garage/S3 storage for durable MJCC file originals."""

from __future__ import annotations

import hashlib
import os
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from botocore.client import Config

ARCHIVE_CATEGORIES = {"invoice", "menu", "recipe", "report", "document", "other"}


def archive_is_configured() -> bool:
    return all(
        os.getenv(name)
        for name in (
            "MJCC_ARCHIVE_ENDPOINT",
            "MJCC_ARCHIVE_ACCESS_KEY",
            "MJCC_ARCHIVE_SECRET_KEY",
        )
    )


def archive_is_required() -> bool:
    raw = os.getenv("MJCC_ARCHIVE_REQUIRED")
    if raw is not None:
        return raw.lower() in {"1", "true", "yes"}
    # Infer "required" only from the core connection vars, so a partial or
    # typo'd credential setup fails closed. Auxiliary tuning vars alone
    # (MJCC_ARCHIVE_MAX_FILE_MB, MJCC_ARCHIVE_ALLOW_INSECURE, ...) must not
    # flip archiving to required-but-unconfigurable and 503 every upload.
    return any(
        os.getenv(name)
        for name in (
            "MJCC_ARCHIVE_ENDPOINT",
            "MJCC_ARCHIVE_ACCESS_KEY",
            "MJCC_ARCHIVE_SECRET_KEY",
        )
    )


def archive_settings_valid() -> bool:
    try:
        _settings()
        return True
    except RuntimeError:
        return False


def _settings() -> dict[str, str]:
    endpoint = os.getenv("MJCC_ARCHIVE_ENDPOINT", "").rstrip("/")
    if not archive_is_configured():
        raise RuntimeError("MJCC archive storage is not configured")
    if urlparse(endpoint).scheme != "https" and os.getenv(
        "MJCC_ARCHIVE_ALLOW_INSECURE", ""
    ).lower() not in {"1", "true", "yes"}:
        raise RuntimeError("MJCC_ARCHIVE_ENDPOINT must use HTTPS")
    return {
        "endpoint": endpoint,
        "bucket": os.getenv("MJCC_ARCHIVE_BUCKET", "mjcc-archive"),
        "region": os.getenv("MJCC_ARCHIVE_REGION", "mjcc"),
        "access_key": os.environ["MJCC_ARCHIVE_ACCESS_KEY"],
        "secret_key": os.environ["MJCC_ARCHIVE_SECRET_KEY"],
    }


def _client():
    import boto3

    settings = _settings()
    return boto3.client(
        "s3",
        endpoint_url=settings["endpoint"],
        region_name=settings["region"],
        aws_access_key_id=settings["access_key"],
        aws_secret_access_key=settings["secret_key"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def safe_filename(filename: str) -> str:
    name = Path(filename or "upload").name
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return name[:180] or "upload"


def display_filename(filename: str) -> str:
    name = Path(filename or "upload").name
    name = "".join(ch for ch in name if ch >= " " and ch != "\x7f").strip()
    return name[:255] or "upload"


def build_object_key(category: str, filename: str) -> str:
    category = category if category in ARCHIVE_CATEGORIES else "other"
    now = datetime.now(UTC)
    return f"{category}/{now:%Y/%m}/{uuid.uuid4().hex}-{safe_filename(filename)}"


def max_file_bytes() -> int:
    return int(float(os.getenv("MJCC_ARCHIVE_MAX_FILE_MB", "50")) * 1024 * 1024)


def archive_file_bytes(
    *,
    content: bytes,
    filename: str,
    content_type: str | None,
    category: str,
    uploaded_by: str,
    source: str = "manual",
    description: str | None = None,
    linked_entity_type: str | None = None,
    linked_entity_id: str | None = None,
    month: int | None = None,
    year: int | None = None,
    week: int | None = None,
    metadata: dict | None = None,
) -> dict:
    if not content:
        raise ValueError("Cannot archive an empty file")
    if len(content) > max_file_bytes():
        raise ValueError("File exceeds the archive size limit")
    if category not in ARCHIVE_CATEGORIES:
        raise ValueError("Unsupported archive category")

    from backend.routes import supabase_service

    digest = hashlib.sha256(content).hexdigest()
    settings = _settings()
    key = build_object_key(category, filename)
    client = _client()
    client.put_object(
        Bucket=settings["bucket"],
        Key=key,
        Body=content,
        ContentType=content_type or "application/octet-stream",
        Metadata={"sha256": digest},
    )
    row = {
        "bucket": settings["bucket"],
        "object_key": key,
        "category": category,
        "original_filename": display_filename(filename),
        "content_type": content_type or "application/octet-stream",
        "size_bytes": len(content),
        "sha256": digest,
        "source": source,
        "description": description,
        "linked_entity_type": linked_entity_type,
        "linked_entity_id": linked_entity_id,
        "period_month": month or None,
        "period_year": year or None,
        "week_number": week if week is not None else None,
        "uploaded_by": uploaded_by,
        "metadata": metadata or {},
    }
    try:
        result = supabase_service.table("archived_files").insert(row).execute()
        return result.data[0]
    except Exception:
        try:
            client.delete_object(Bucket=settings["bucket"], Key=key)
        except Exception:
            pass
        raise


def get_archive_object(row: dict):
    return _client().get_object(Bucket=row["bucket"], Key=row["object_key"])


def delete_archive_object(row: dict) -> None:
    _client().delete_object(Bucket=row["bucket"], Key=row["object_key"])
