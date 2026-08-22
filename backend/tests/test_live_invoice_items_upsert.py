"""Live integration check for the tenant-scoped invoice-item upsert."""

from __future__ import annotations

import os
import uuid

import pytest
from dotenv import load_dotenv


def test_live_tenant_invoice_items_upsert_creates_and_updates_rows():
    """Exercise the actual TenantScopedClient/PostgREST upsert path once."""
    load_dotenv()
    if os.getenv("RUN_LIVE_SUPABASE_TESTS") != "1":
        pytest.skip("set RUN_LIVE_SUPABASE_TESTS=1 to run against live Supabase")
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        pytest.skip("live Supabase service credentials are not configured")

    from supabase import create_client

    from backend.tenancy import TenantContext, TenantScopedClient, tenant_scope

    tenant_id = "6a40b9fd-73fa-4d80-9110-fed6c3d5468e"
    admin = create_client(url, key)
    scoped = TenantScopedClient(admin)
    invoice_id = None
    invoice_number = f"__codex_upsert_{uuid.uuid4().hex[:12]}"

    try:
        with tenant_scope(
            TenantContext(id=tenant_id, slug="mjcc", name="Miami Job Corps Center")
        ):
            invoice = (
                scoped.table("invoices")
                .insert(
                    {
                        "invoice_number": invoice_number,
                        "invoice_date": "2026-08-22",
                        "status": "pending",
                    }
                )
                .execute()
            )
            invoice_id = invoice.data[0]["id"]

            item = {
                "invoice_id": invoice_id,
                "line_number": 1,
                "sku": "__CODEX_TEST__",
                "description": "Codex live upsert verification",
                "quantity_shipped": 2,
                "unit_price": 3.25,
                "extended_price": 6.50,
            }
            scoped.table("invoice_items").upsert(
                [item], on_conflict="invoice_id,line_number"
            ).execute()

            first = (
                scoped.table("invoice_items")
                .select("invoice_id,line_number,quantity_shipped")
                .eq("invoice_id", invoice_id)
                .execute()
            )
            assert len(first.data) == 1
            assert first.data[0]["quantity_shipped"] == 2

            item["quantity_shipped"] = 4
            item["extended_price"] = 13.00
            scoped.table("invoice_items").upsert(
                [item], on_conflict="invoice_id,line_number"
            ).execute()

            second = (
                scoped.table("invoice_items")
                .select("invoice_id,line_number,quantity_shipped")
                .eq("invoice_id", invoice_id)
                .execute()
            )
            assert len(second.data) == 1
            assert second.data[0]["quantity_shipped"] == 4
    finally:
        if invoice_id:
            admin.table("invoices").delete().eq("id", invoice_id).execute()
