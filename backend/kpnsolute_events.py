"""KpnSolute Events CloudEvents 1.0 publisher.

Publishing is disabled unless all three server-only environment variables are
present. Menu writes remain authoritative even when notification delivery is
temporarily unavailable; the gateway's idempotency key makes retries safe.
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from uuid import uuid4

import httpx

logger = logging.getLogger("mjcc.kpnsolute_events")

MENU_DAY_UPDATED = "com.kpnsolute.compute.menu.day.updated.v1"
MENU_CYCLE_UPDATED = "com.kpnsolute.compute.menu.cycle.updated.v1"


def _settings() -> tuple[str, str, str] | None:
    gateway_url = os.getenv("KPNSOLUTE_EVENTS_URL", "").strip().rstrip("/")
    publisher_key = os.getenv("KPNSOLUTE_EVENTS_PUBLISHER_KEY", "").strip()
    tenant_id = os.getenv("KPNSOLUTE_TENANT_ID", "").strip()
    if not gateway_url or not publisher_key or not tenant_id:
        return None
    return gateway_url, publisher_key, tenant_id


def _publish(
    event_type: str, subject: str, data: dict, correlation_id: str | None = None
) -> bool:
    settings = _settings()
    if settings is None:
        logger.debug("KpnSolute Events publisher is not configured; menu event skipped")
        return False

    gateway_url, publisher_key, tenant_id = settings
    event = {
        "specversion": "1.0",
        "id": f"menu-{uuid4().hex}",
        "source": f"https://compute.kpnsolute.com/tenants/{tenant_id}",
        "type": event_type,
        "subject": subject,
        "time": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "datacontenttype": "application/json",
        "dataschema": (
            "https://events.kpnsolute.com/schemas/compute-menu-day-v1.json"
            if event_type == MENU_DAY_UPDATED
            else "https://events.kpnsolute.com/schemas/compute-menu-cycle-v1.json"
        ),
        "tenantid": tenant_id,
        "data": data,
    }
    if correlation_id:
        event["correlationid"] = correlation_id
    raw_body = json.dumps(event, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )
    headers = {
        "Authorization": f"Bearer {publisher_key}",
        "Content-Type": "application/cloudevents+json",
        "User-Agent": "KpnCompute/1.0",
    }

    for attempt, delay in enumerate((0, 1, 3), start=1):
        if delay:
            time.sleep(delay)
        try:
            response = httpx.post(
                f"{gateway_url}/v1/events",
                content=raw_body,
                headers=headers,
                timeout=10,
            )
            if response.status_code == 202:
                logger.info("Published %s to KpnSolute Events", event_type)
                return True
            if 400 <= response.status_code < 500 and response.status_code not in {
                408,
                429,
            }:
                logger.error(
                    "KpnSolute Events rejected menu event: HTTP %s",
                    response.status_code,
                )
                return False
            logger.warning(
                "KpnSolute Events publish attempt %s failed: HTTP %s",
                attempt,
                response.status_code,
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "KpnSolute Events publish attempt %s failed: %s", attempt, exc
            )

    logger.error("KpnSolute Events publish exhausted retries for %s", event_type)
    return False


def publish_menu_day(data: dict, correlation_id: str | None = None) -> bool:
    return _publish(
        MENU_DAY_UPDATED,
        f"menu-rotations/{data.get('rotation_id', 'primary')}/days/{data['cycle_day']}",
        data,
        correlation_id,
    )


def publish_menu_cycle(data: dict, correlation_id: str | None = None) -> bool:
    return _publish(
        MENU_CYCLE_UPDATED,
        f"menu-rotations/{data.get('rotation_id', 'primary')}",
        data,
        correlation_id,
    )
