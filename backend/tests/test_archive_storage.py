import pytest

from backend import archive_storage
from backend.tenancy import TenantContext, tenant_scope


def test_safe_filename_removes_paths_and_unsafe_characters():
    assert archive_storage.safe_filename("../../July Week #2.pdf") == "July-Week-2.pdf"


def test_display_filename_preserves_unicode_but_removes_controls():
    assert archive_storage.display_filename("../Café\n Menu.pdf") == "Café Menu.pdf"


def test_build_object_key_uses_category_and_safe_filename(monkeypatch):
    class FixedUuid:
        hex = "abc123"

    monkeypatch.setattr(archive_storage.uuid, "uuid4", lambda: FixedUuid())
    key = archive_storage.build_object_key("invoice", "July Week 2.pdf")
    assert key.startswith("tenants/legacy-mjcc/invoice/")
    assert key.endswith("/abc123-July-Week-2.pdf")


def test_build_object_key_uses_immutable_tenant_id(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    tenant = TenantContext(id="tenant-123", slug="acme", name="Acme")
    with tenant_scope(tenant):
        key = archive_storage.build_object_key("document", "SOP.pdf")
    assert key.startswith("tenants/tenant-123/document/")


def test_build_object_key_fails_closed_without_tenant(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    with pytest.raises(RuntimeError, match="Tenant context required"):
        archive_storage.build_object_key("document", "SOP.pdf")


def test_settings_requires_https_by_default(monkeypatch):
    monkeypatch.setenv("MJCC_ARCHIVE_ENDPOINT", "http://192.168.1.96:3900")
    monkeypatch.setenv("MJCC_ARCHIVE_ACCESS_KEY", "key")
    monkeypatch.setenv("MJCC_ARCHIVE_SECRET_KEY", "secret")
    monkeypatch.delenv("MJCC_ARCHIVE_ALLOW_INSECURE", raising=False)
    with pytest.raises(RuntimeError, match="must use HTTPS"):
        archive_storage._settings()


def test_settings_allows_explicit_local_http(monkeypatch):
    monkeypatch.setenv("MJCC_ARCHIVE_ENDPOINT", "http://192.168.1.96:3900")
    monkeypatch.setenv("MJCC_ARCHIVE_ACCESS_KEY", "key")
    monkeypatch.setenv("MJCC_ARCHIVE_SECRET_KEY", "secret")
    monkeypatch.setenv("MJCC_ARCHIVE_ALLOW_INSECURE", "true")
    assert archive_storage._settings()["endpoint"] == "http://192.168.1.96:3900"


def test_each_upload_gets_its_own_audit_row(monkeypatch):
    import backend.routes

    inserted = []

    class Result:
        def __init__(self, data):
            self.data = data

    class Table:
        def insert(self, row):
            inserted.append(row)
            return self

        def execute(self):
            return Result([{**inserted[-1], "id": f"row-{len(inserted)}"}])

    class Db:
        def table(self, _name):
            return Table()

    class S3:
        def put_object(self, **_kwargs):
            return None

        def delete_object(self, **_kwargs):
            return None

    monkeypatch.setattr(backend.routes, "supabase_service", Db())
    monkeypatch.setattr(
        archive_storage,
        "_settings",
        lambda: {"bucket": "mjcc", "endpoint": "https://archive", "region": "mjcc"},
    )
    monkeypatch.setattr(archive_storage, "_client", lambda: S3())

    kwargs = {
        "content": b"same invoice",
        "filename": "invoice.pdf",
        "content_type": "application/pdf",
        "category": "invoice",
        "uploaded_by": "user-1",
    }
    first = archive_storage.archive_file_bytes(**kwargs)
    second = archive_storage.archive_file_bytes(**kwargs)
    assert first["id"] != second["id"]
    assert len(inserted) == 2
