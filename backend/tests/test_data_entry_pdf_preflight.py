"""Regression coverage for image-only PDF warnings in Data Entry."""

import asyncio
import io

import fitz
import pytest
from fastapi import HTTPException, UploadFile

from backend.routes.data_entry import preflight_pdf


def _pdf_bytes(*, text: str | None = None) -> bytes:
    document = fitz.open()
    page = document.new_page()
    if text:
        page.insert_text((72, 72), text)
    content = document.tobytes()
    document.close()
    return content


def _preflight(content: bytes, filename: str = "inventory.pdf") -> dict:
    upload = UploadFile(filename=filename, file=io.BytesIO(content))
    return asyncio.run(preflight_pdf(upload, {"id": "test-user"}))


def test_image_only_pdf_returns_inventory_warning():
    result = _preflight(_pdf_bytes())

    assert result["is_pdf"] is True
    assert result["has_native_text"] is False
    assert result["image_only"] is True
    assert "inventory sheets" in result["warning"]
    assert "reconciliation" in result["warning"]


def test_searchable_pdf_does_not_return_warning():
    result = _preflight(_pdf_bytes(text="SKU Description Quantity Price"))

    assert result["has_native_text"] is True
    assert result["image_only"] is False
    assert result["warning"] is None


def test_non_pdf_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        _preflight(b"not a pdf", filename="inventory.txt")

    assert exc_info.value.status_code == 415
