"""Failed commits must restore overwrite-cleared inventory scopes.

A confirmed month/week overwrite deletes the live scope before replaying the
new upload. These tests pin the snapshot-before-clear and restore-on-abort
behavior so a failed replay can never leave the period empty.
"""

from backend.routes import sourcectrl


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, log, table, select_data):
        self._log = log
        self._table = table
        self._select_data = select_data
        self._op = None
        self._filters = []
        self._payload = None

    def select(self, *_args, **_kwargs):
        self._op = "select"
        return self

    def delete(self):
        self._op = "delete"
        return self

    def update(self, values):
        self._op = "update"
        self._payload = values
        return self

    def insert(self, rows):
        self._op = "insert"
        self._payload = rows
        return self

    def eq(self, column, value):
        self._filters.append(("eq", column, value))
        return self

    def neq(self, column, value):
        self._filters.append(("neq", column, value))
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self._log.append((self._op, self._table, tuple(self._filters), self._payload))
        data = self._select_data.get(self._table, []) if self._op == "select" else []
        return _Result(data)


class _FakeSupabase:
    def __init__(self, select_data=None):
        self.log = []
        self._select_data = select_data or {}

    def table(self, name):
        return _FakeQuery(self.log, name, self._select_data)


def _ops(log, op, table):
    return [entry for entry in log if entry[0] == op and entry[1] == table]


def test_month_overwrite_snapshots_scope_before_clearing(monkeypatch):
    monthly = [{"id": "mi-1", "item_id": "it-1", "month": 6, "year": 2026}]
    txns = [{"txn_id": "tx-1", "item_id": "it-1", "month": 6, "year": 2026}]
    fake = _FakeSupabase({"monthly_inventory": monthly, "inventory_transactions": txns})
    monkeypatch.setattr(sourcectrl, "supabase_service", fake)

    backups: list[dict] = []
    entries = [
        {
            "operation": "inventory_save",
            "full_payload": {"overwrite": True, "month": 7, "year": 2026},
        }
    ]
    cleared = sourcectrl._apply_confirmed_inventory_overwrites(entries, backups)

    assert cleared == [{"scope": "month", "month": 7, "year": 2026}]
    assert backups[0]["monthly_rows"] == monthly
    assert backups[0]["txn_rows"] == txns
    # Snapshot selects must happen before the destructive deletes.
    first_delete = fake.log.index(_ops(fake.log, "delete", "monthly_inventory")[0])
    last_select = max(
        fake.log.index(entry) for entry in fake.log if entry[0] == "select"
    )
    assert last_select < first_delete


def test_restore_reinserts_month_snapshot(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(sourcectrl, "supabase_service", fake)

    monthly = [{"id": "mi-1", "item_id": "it-1", "month": 6, "year": 2026}]
    txns = [{"txn_id": "tx-1", "item_id": "it-1", "month": 6, "year": 2026}]
    sourcectrl._restore_inventory_overwrites(
        [
            {
                "scope": "month",
                "db_month": 6,
                "year": 2026,
                "monthly_rows": monthly,
                "txn_rows": txns,
            }
        ]
    )

    # Re-clears whatever a partial replay landed, then reinserts the originals.
    assert _ops(fake.log, "delete", "monthly_inventory")
    assert _ops(fake.log, "delete", "inventory_transactions")
    assert _ops(fake.log, "insert", "monthly_inventory")[0][3] == monthly
    assert _ops(fake.log, "insert", "inventory_transactions")[0][3] == txns


def test_restore_week_scope_puts_back_column_values_and_txns(monkeypatch):
    fake = _FakeSupabase()
    monkeypatch.setattr(sourcectrl, "supabase_service", fake)

    sourcectrl._restore_inventory_overwrites(
        [
            {
                "scope": "week",
                "db_month": 6,
                "year": 2026,
                "week": 2,
                "txn_type": "issued",
                "col": "w2_pulled",
                "monthly_values": [{"id": "mi-1", "w2_pulled": 5}],
                "txn_rows": [{"txn_id": "tx-1", "week_number": 2}],
            }
        ]
    )

    updates = _ops(fake.log, "update", "monthly_inventory")
    # First zeroes the column for the scope, then restores each saved value.
    assert updates[0][3] == {"w2_pulled": 0}
    assert {"w2_pulled": 5} in [entry[3] for entry in updates]
    assert _ops(fake.log, "insert", "inventory_transactions")[0][3] == [
        {"txn_id": "tx-1", "week_number": 2}
    ]


def test_restore_survives_per_scope_failures(monkeypatch):
    class _ExplodingSupabase:
        def table(self, _name):
            raise RuntimeError("db down")

    monkeypatch.setattr(sourcectrl, "supabase_service", _ExplodingSupabase())
    # Best-effort: a rollback failure is logged, never raised.
    sourcectrl._restore_inventory_overwrites(
        [
            {
                "scope": "month",
                "db_month": 6,
                "year": 2026,
                "monthly_rows": [],
                "txn_rows": [],
            }
        ]
    )
