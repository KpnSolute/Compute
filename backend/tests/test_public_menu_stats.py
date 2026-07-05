"""Regression test for the LunchVoice feedback stats sort order in backend.routes.public_menu."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_sorts_by_response_count_desc():
    from backend.routes.public_menu import _feedback_sort_key

    rows = [
        {"dish_name": "Low", "response_count": 2, "avg_rating": 4.5},
        {"dish_name": "High", "response_count": 10, "avg_rating": 3.0},
    ]
    rows.sort(key=_feedback_sort_key)
    assert [r["dish_name"] for r in rows] == ["High", "Low"]


def test_ties_broken_by_avg_rating_desc():
    from backend.routes.public_menu import _feedback_sort_key

    rows = [
        {"dish_name": "Lower", "response_count": 5, "avg_rating": 3.2},
        {"dish_name": "Higher", "response_count": 5, "avg_rating": 4.8},
    ]
    rows.sort(key=_feedback_sort_key)
    assert [r["dish_name"] for r in rows] == ["Higher", "Lower"]


def test_null_avg_rating_sorts_last_within_tie():
    from backend.routes.public_menu import _feedback_sort_key

    rows = [
        {"dish_name": "Rated", "response_count": 0, "avg_rating": 1.0},
        {"dish_name": "Unrated", "response_count": 0, "avg_rating": None},
    ]
    rows.sort(key=_feedback_sort_key)
    assert [r["dish_name"] for r in rows] == ["Rated", "Unrated"]


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} public menu stats tests passed")


if __name__ == "__main__":
    _run_standalone()
