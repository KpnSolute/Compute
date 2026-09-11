"""Regression tests for the Supabase client connection-pool settings.

postgrest builds its own httpx client with `http2=True` and no keepalive expiry.
Because the Supabase clients in `backend.routes` are process-lifetime singletons,
that combination produced a burst of 500s every time traffic went idle: Supabase
closes the idle connection, the pool hands the dead socket to the next request,
and it fails on read.

Production logs for 2026-09-09..11 carried 193 errors, 188 of them this one
failure — ReadError `[Errno 11] Resource temporarily unavailable` on
/api/inventory, /api/commits, /api/staging and /api/auth/me, plus h2 stream
corruption (RemoteProtocolError, LocalProtocolError, KeyError on a stream id).

These tests pin the two settings that close that window. They assert against the
live httpx pool object rather than the constructor arguments, because passing
`transport=` to httpx.Client silently ignores client-level `http2`/`limits` — a
plausible way to write this fix so that it does nothing at all.
"""

from backend.routes import pooled_httpx_client


def _pool():
    return pooled_httpx_client()._transport._pool


def test_http2_is_disabled():
    # HTTP/2 is where the stream-state corruption came from; postgrest turns it
    # on by default, so this must actively override it.
    assert _pool()._http2 is False
    assert _pool()._http1 is True


def test_idle_connections_expire_before_supabase_drops_them():
    # The actual fix for the stale-socket reads. Unbounded (the httpx default of
    # 5s is fine too, but postgrest's client leaves this effectively long-lived)
    # is what allowed a dead connection to be handed out.
    expiry = _pool()._keepalive_expiry
    assert expiry is not None
    assert 0 < expiry <= 30, (
        f"keepalive_expiry={expiry} is too long to beat Supabase's idle close"
    )


def test_connection_errors_are_retried():
    assert _pool()._retries >= 1


def test_request_timeout_matches_postgrest_default():
    # Preserved deliberately: shortening it here would silently change the budget
    # for long inventory queries and AI data-entry parses.
    assert pooled_httpx_client().timeout.read == 120.0


def test_each_call_returns_a_distinct_client():
    # supabase sets headers on the client it is handed, so the anon and
    # service-role clients must never share one.
    assert pooled_httpx_client() is not pooled_httpx_client()
