"""New items keep the parser's category as an advisory suggestion.

Data-entry ingestion force-routes brand-new SKUs into "New Items" for review.
Before this change the parser's inferred category was discarded and the operator
re-derived an obvious category by hand. resolve_and_write_item now records the
guess as suggested_category_id (advisory) so the review UI can pre-fill it.
"""

from backend import inventory_identity


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, sink):
        self._sink = sink
        self._op = None
        self._payload = None

    def select(self, *a, **k):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, *a, **k):
        return self

    def ilike(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        if self._op == "insert":
            self._sink["inserted"] = self._payload
            return _Result([{"id": "new-item-1"}])
        if self._op == "update":
            self._sink["updated"] = self._payload
            return _Result([{"id": "existing-1"}])
        # select: no existing row -> forces the create path
        return _Result([])


class _Sup:
    def __init__(self, sink):
        self._sink = sink

    def table(self, _name):
        return _Query(self._sink)


NEW_ITEMS = "newitems-cat-uuid"
FROZEN = "frozen-cat-uuid"


def test_review_new_item_keeps_guess_as_suggestion():
    sink = {}
    item_id, sku, created = inventory_identity.resolve_and_write_item(
        _Sup(sink),
        sku="9014812",
        desc="MUFFIN, BRAN 2 Z TRAY PK FZN",
        category_id=FROZEN,  # parser guessed Frozen Food
        fallback_category_id=NEW_ITEMS,
        force_review_category=True,
    )
    assert created is True
    row = sink["inserted"]
    # Filed under New Items for review, but the guess is preserved as advisory.
    assert row["category_id"] == NEW_ITEMS
    assert row["suggested_category_id"] == FROZEN


def test_no_suggestion_when_guess_equals_new_items():
    sink = {}
    inventory_identity.resolve_and_write_item(
        _Sup(sink),
        sku="0001",
        desc="MYSTERY ITEM",
        category_id=NEW_ITEMS,  # parser had no real guess
        fallback_category_id=NEW_ITEMS,
        force_review_category=True,
    )
    assert "suggested_category_id" not in sink["inserted"]


def test_non_review_applies_guess_directly_no_suggestion():
    sink = {}
    inventory_identity.resolve_and_write_item(
        _Sup(sink),
        sku="0002",
        desc="WHOLE MILK",
        category_id="dairy-uuid",
        fallback_category_id=NEW_ITEMS,
        force_review_category=False,
    )
    row = sink["inserted"]
    assert row["category_id"] == "dairy-uuid"
    assert "suggested_category_id" not in row
