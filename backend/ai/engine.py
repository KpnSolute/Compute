"""Provider-agnostic AI engine with usage logging.

Supported providers:
  groq       — Groq cloud (llama, gemma, qwen)
  anthropic  — Anthropic cloud (claude-*)
  openai     — OpenAI cloud (gpt-*)
  mistral    — Mistral AI cloud (mistral-*, mixtral-*)
  ollama     — Local Ollama server (any model)
  lm_studio  — Local LM Studio (OpenAI-compatible; runs GGUF models locally)

Usage is logged to ai_usage_logs after every call (best-effort, never raises).
"""

import json
import logging
import os
import time
import httpx

log = logging.getLogger("mjcc.ai")

# ── cost rates (USD per 1k tokens, approximate) ───────────────────────────────

COST_RATES: dict[str, dict[str, float]] = {
    "groq": {"in": 0.00059, "out": 0.00079},
    "anthropic": {"in": 0.003, "out": 0.015},
    "openai": {"in": 0.00015, "out": 0.0006},  # gpt-4o-mini baseline
    "mistral": {"in": 0.0014, "out": 0.0014},
    "google": {"in": 0.0, "out": 0.0},  # free tier
    "ollama": {"in": 0.0, "out": 0.0},
    "lm_studio": {"in": 0.0, "out": 0.0},
}

# ── provider implementations — return (text, {tokens_in, tokens_out}) ─────────


def _groq_complete(messages: list[dict], model: str, api_key: str) -> tuple[str, dict]:
    resp = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.1,
            # Groq's free tier rejects requests whose max_tokens exceeds its
            # per-request budget with an instant 413 (Payload Too Large), even on
            # a tiny prompt. 8192 reliably tripped that ceiling and made groq a
            # dead fallback; 4096 stays under it while still covering invoice
            # extraction. See CHANGELOG v4.10.23.
            "max_tokens": 4096,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage", {})
    return (
        data["choices"][0]["message"]["content"],
        {
            "tokens_in": usage.get("prompt_tokens", 0),
            "tokens_out": usage.get("completion_tokens", 0),
        },
    )


_ANTHROPIC_RETRYABLE = {429, 500, 502, 503, 504}


def _anthropic_complete(
    messages: list[dict], model: str, api_key: str
) -> tuple[str, dict]:
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    user_messages = [m for m in messages if m.get("role") != "system"]
    body: dict = {"model": model, "max_tokens": 16384, "messages": user_messages}
    if system_parts:
        body["system"] = "\n\n".join(system_parts)
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
    }

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            resp = httpx.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers,
                json=body,
                # 60s was too aggressive for Claude extraction calls (max_tokens
                # up to 16384) and surfaced as spurious "read operation timed out"
                # failures on a healthy primary. 90s gives slow-but-valid calls
                # room while staying under the platform request ceiling.
                timeout=90,
            )
            resp.raise_for_status()
            data = resp.json()
            usage = data.get("usage", {})
            return (
                data["content"][0]["text"],
                {
                    "tokens_in": usage.get("input_tokens", 0),
                    "tokens_out": usage.get("output_tokens", 0),
                },
            )
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if exc.response.status_code in _ANTHROPIC_RETRYABLE and attempt < 2:
                wait = 2 ** (attempt + 1)
                log.warning(
                    "[ANTHROPIC] %s on attempt %d — retrying in %ds",
                    exc.response.status_code,
                    attempt + 1,
                    wait,
                )
                time.sleep(wait)
                continue
            raise
        except httpx.TimeoutException:
            raise
    raise last_exc  # type: ignore[misc]


def _openai_complete(
    messages: list[dict], model: str, api_key: str, base_url: str | None = None
) -> tuple[str, dict]:
    endpoint = (base_url or "https://api.openai.com").rstrip(
        "/"
    ) + "/v1/chat/completions"
    resp = httpx.post(
        endpoint,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 16384,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage", {})
    return (
        data["choices"][0]["message"]["content"],
        {
            "tokens_in": usage.get("prompt_tokens", 0),
            "tokens_out": usage.get("completion_tokens", 0),
        },
    )


def _mistral_complete(
    messages: list[dict], model: str, api_key: str
) -> tuple[str, dict]:
    resp = httpx.post(
        "https://api.mistral.ai/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 8192,
        },
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    usage = data.get("usage", {})
    return (
        data["choices"][0]["message"]["content"],
        {
            "tokens_in": usage.get("prompt_tokens", 0),
            "tokens_out": usage.get("completion_tokens", 0),
        },
    )


_GEMINI_RETRYABLE = {429, 500, 502, 503, 504}


def _gemini_complete(
    messages: list[dict], model: str, api_key: str
) -> tuple[str, dict]:
    """Call Google Gemini generateContent API with exponential-backoff retry."""
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    turns = [m for m in messages if m.get("role") != "system"]

    body: dict = {
        "contents": [
            {
                "role": "user" if m["role"] == "user" else "model",
                "parts": m["content"]
                if isinstance(m["content"], list)
                else [{"text": m["content"]}],
            }
            for m in turns
        ],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 32768},
    }
    if system_parts:
        body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}

    # ponytail: 300s for multimodal (PDF/image pages can be large); 60s for text
    timeout_sec = 300 if any(isinstance(m.get("content"), list) for m in turns) else 60
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            resp = httpx.post(url, headers=headers, json=body, timeout=timeout_sec)
            resp.raise_for_status()
            data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            meta = data.get("usageMetadata", {})
            return text, {
                "tokens_in": meta.get("promptTokenCount", 0),
                "tokens_out": meta.get("candidatesTokenCount", 0),
            }
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            if exc.response.status_code in _GEMINI_RETRYABLE and attempt < 2:
                wait = 2 ** (attempt + 1)  # 2s, 4s
                log.warning(
                    "[GEMINI] %s on attempt %d — retrying in %ds",
                    exc.response.status_code,
                    attempt + 1,
                    wait,
                )
                time.sleep(wait)
                continue
            raise
        except httpx.TimeoutException:
            raise
    raise last_exc  # type: ignore[misc]


def _ollama_complete(
    messages: list[dict], model: str, base_url: str
) -> tuple[str, dict]:
    resp = httpx.post(
        f"{base_url}/api/chat",
        json={"model": model, "messages": messages, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    # Ollama reports eval_count (output tokens); prompt_eval_count (input tokens)
    return (
        data["message"]["content"],
        {
            "tokens_in": data.get("prompt_eval_count", 0),
            "tokens_out": data.get("eval_count", 0),
        },
    )


# ── provider registry ─────────────────────────────────────────────────────────

SUPPORTED_PROVIDERS = (
    "groq",
    "anthropic",
    "openai",
    "mistral",
    "google",
    "ollama",
    "lm_studio",
)

PROVIDER_LABELS = {
    "groq": "Groq",
    "anthropic": "Anthropic (Claude)",
    "openai": "OpenAI",
    "mistral": "Mistral AI",
    "google": "Google Gemini",
    "ollama": "Ollama (local)",
    "lm_studio": "LM Studio (local)",
}

GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "gemma2-9b-it",
    "qwen-qwq-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
]
ANTHROPIC_MODELS = [
    "claude-fable-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
]
OPENAI_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"]
MISTRAL_MODELS = [
    "mistral-small-latest",
    "mistral-medium-latest",
    "mistral-large-latest",
    "open-mistral-7b",
    "open-mixtral-8x7b",
    "pixtral-large-2411",
    "pixtral-12b-2409",
]
OLLAMA_MODELS = [
    "llama3.2:3b",
    "llama3.1:8b",
    "mistral:7b",
    "mixtral:8x7b",
    "phi3:mini",
]
GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-1.5-pro",
]
LM_STUDIO_MODELS = ["local-model"]  # user fills in whatever is loaded

# ── vision-capable model IDs (cross-provider) ─────────────────────────────────
VISION_MODELS: frozenset[str] = frozenset(
    {
        # Groq — Llama 4 family
        "meta-llama/llama-4-scout-17b-16e-instruct",
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        # Anthropic — all current models support vision
        "claude-fable-5",
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
        # OpenAI
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-turbo",
        # Mistral — pixtral family
        "pixtral-large-2411",
        "pixtral-12b-2409",
        # Google Gemini — all current models support vision
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
    }
)


# ── capability helpers ────────────────────────────────────────────────────────


def is_vision_capable(provider: str, model: str, cfg: dict | None = None) -> bool:
    """True if the provider+model combination accepts image content."""
    if model in VISION_MODELS:
        return True
    # Ollama / LM Studio: operator sets vision=true in config when their local model supports it
    if provider in ("ollama", "lm_studio") and (cfg or {}).get("vision"):
        return True
    return False


# ── helpers ───────────────────────────────────────────────────────────────────


def _get_db_row(provider: str) -> tuple[str | None, str | None]:
    """Query ai_provider_keys for active (api_key, base_url). Returns (None, None) on any error."""
    try:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            return None, None
        svc = create_client(url, key)
        r = (
            svc.table("ai_provider_keys")
            .select("api_key,base_url")
            .eq("provider", provider)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
        if r.data:
            row = r.data[0]
            return row.get("api_key") or None, row.get("base_url") or None
    except Exception:
        pass
    return None, None


def _log_usage(
    provider: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    duration_ms: int,
    operation: str | None,
    called_by: str | None,
    success: bool,
    error_msg: str | None,
) -> None:
    """Write one row to ai_usage_logs. Never raises — logging must not break the caller."""
    try:
        rate = COST_RATES.get(provider, {"in": 0.0, "out": 0.0})
        cost = (tokens_in * rate["in"] + tokens_out * rate["out"]) / 1000.0

        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            return
        svc = create_client(url, key)
        svc.table("ai_usage_logs").insert(
            {
                "provider": provider,
                "model": model,
                "operation": operation,
                "tokens_in": tokens_in,
                "tokens_out": tokens_out,
                "cost_usd": float(cost),
                "duration_ms": duration_ms,
                "success": success,
                "error_msg": error_msg,
                "called_by": called_by,
            }
        ).execute()
    except Exception:
        pass


# ── public interface ──────────────────────────────────────────────────────────


# Fallback chain — when the configured provider fails with a transient error
# (e.g. Google 503 Service Unavailable, timeouts), automatically retry the same
# request on the next provider that has a key. This keeps data entry working
# through a single-vendor outage instead of failing the whole upload.
_FALLBACK_ORDER = ["anthropic", "groq", "openai", "mistral", "google"]
_FALLBACK_MODELS = {
    # claude-haiku-4-5 is current, fast, and vision-capable — the right profile
    # for a fallback. The old "claude-sonnet-4-20250514" 404'd on every call
    # (model does not exist), making anthropic a dead fallback. See CHANGELOG
    # v4.10.23.
    "anthropic": "claude-haiku-4-5-20251001",
    "groq": "llama-3.3-70b-versatile",
    "openai": "gpt-4o-mini",
    "mistral": "mistral-small-latest",
    "google": "gemini-2.0-flash",
}


def _get_any_key(provider: str) -> str | None:
    """Return a usable api_key for `provider` regardless of is_active (prefers an
    active row). The primary provider uses _get_db_row (is_active only); fallback
    providers aren't marked active, so they need this looser lookup."""
    try:
        from supabase import create_client

        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            return None
        svc = create_client(url, key)
        r = (
            svc.table("ai_provider_keys")
            .select("api_key,is_active")
            .eq("provider", provider)
            .order("is_active", desc=True)
            .limit(5)
            .execute()
        )
        for row in r.data or []:
            if row.get("api_key"):
                return row["api_key"]
    except Exception:
        pass
    return None


def _resolve_key(provider: str, cfg: dict) -> tuple[str | None, str | None]:
    """Resolve (api_key, base_url) for a provider: active DB key → any DB key →
    config-supplied key."""
    db_key, db_url = _get_db_row(provider)
    if not db_key:
        db_key = _get_any_key(provider)
    return (db_key or cfg.get("api_key")), db_url


def _dispatch_text(
    provider: str, model: str | None, messages: list[dict], cfg: dict
) -> tuple[str, dict]:
    """Run ONE provider and return (text, usage). Raises on missing key or
    provider error (so the caller can fall back to the next provider)."""
    if provider == "groq":
        key, _ = _resolve_key("groq", cfg)
        if not key:
            raise RuntimeError("No API key configured for groq")
        return _groq_complete(messages, model or "llama-3.3-70b-versatile", key)
    elif provider == "anthropic":
        key, _ = _resolve_key("anthropic", cfg)
        if not key:
            raise RuntimeError("No API key configured for anthropic")
        return _anthropic_complete(messages, model or "claude-sonnet-4-6", key)
    elif provider == "openai":
        key, url = _resolve_key("openai", cfg)
        if not key:
            raise RuntimeError("No API key configured for openai")
        return _openai_complete(messages, model or "gpt-4o-mini", key, url)
    elif provider == "mistral":
        key, _ = _resolve_key("mistral", cfg)
        if not key:
            raise RuntimeError("No API key configured for mistral")
        return _mistral_complete(messages, model or "mistral-small-latest", key)
    elif provider == "google":
        key, _ = _resolve_key("google", cfg)
        if not key:
            raise RuntimeError("No API key configured for Google Gemini")
        return _gemini_complete(messages, model or "gemini-2.0-flash", key)
    elif provider == "ollama":
        _, url = _resolve_key("ollama", cfg)
        base = url or cfg.get("ollama_url") or "http://localhost:11434"
        return _ollama_complete(messages, model, base)
    elif provider == "lm_studio":
        key, url = _resolve_key("lm_studio", cfg)
        base = url or cfg.get("lm_studio_url") or "http://localhost:1234"
        return _openai_complete(
            messages, model or "local-model", key or "lm-studio", base
        )
    else:
        raise ValueError(
            f"Unknown AI provider: {provider!r}. Must be one of {SUPPORTED_PROVIDERS}"
        )


def complete(
    messages: list[dict],
    config: dict | None = None,
    *,
    operation: str | None = None,
    called_by: str | None = None,
) -> str:
    """
    Send messages to the configured AI provider and return the response text.

    config  — {'provider': ..., 'model': ..., 'ollama_url': ...}
    operation — caller label for usage logs (e.g. 'inventory_save', 'event_create')
    called_by — user_id for usage logs

    Key resolution order: api_keys table → env vars.
    Usage is logged to ai_usage_logs (best-effort, never raises).
    """
    cfg = config or {}
    provider = cfg.get("provider") or "groq"
    model = cfg.get("model") or "llama-3.3-70b-versatile"

    log.info(
        "[AI] request start | provider=%s model=%s operation=%s called_by=%s msgs=%d",
        provider,
        model,
        operation or "?",
        called_by or "?",
        len(messages),
    )

    # Build the attempt chain: configured provider first, then each fallback
    # provider that has a key. Local providers (ollama/lm_studio) are never used
    # as auto-fallbacks since they depend on a reachable local URL.
    attempts: list[tuple[str, str | None]] = [(provider, model)]
    if cfg.get("enable_fallback", True):
        for fb in _FALLBACK_ORDER:
            if fb == provider or fb in ("ollama", "lm_studio"):
                continue
            if _get_any_key(fb):
                attempts.append((fb, _FALLBACK_MODELS[fb]))

    last_exc: Exception | None = None
    for idx, (prov, mdl) in enumerate(attempts):
        t0 = time.monotonic()
        try:
            text, usage = _dispatch_text(prov, mdl, messages, cfg)
        except Exception as exc:
            duration_ms = int((time.monotonic() - t0) * 1000)
            _log_usage(
                provider=prov,
                model=mdl,
                tokens_in=0,
                tokens_out=0,
                duration_ms=duration_ms,
                operation=operation,
                called_by=called_by,
                success=False,
                error_msg=str(exc)[:500],
            )
            last_exc = exc
            more = idx < len(attempts) - 1
            log.warning(
                "[AI] provider FAILED | provider=%s model=%s operation=%s elapsed_ms=%d error=%s%s",
                prov,
                mdl,
                operation or "?",
                duration_ms,
                str(exc)[:300],
                " — falling back to next provider" if more else " — no providers left",
            )
            continue

        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_usage(
            provider=prov,
            model=mdl,
            tokens_in=usage.get("tokens_in", 0),
            tokens_out=usage.get("tokens_out", 0),
            duration_ms=duration_ms,
            operation=operation,
            called_by=called_by,
            success=True,
            error_msg=None,
        )
        if idx > 0:
            log.warning(
                "[AI] primary provider '%s' failed — request served by fallback '%s'",
                provider,
                prov,
            )
        log.info(
            "[AI] request done | provider=%s model=%s operation=%s elapsed_ms=%d "
            "tokens_in=%d tokens_out=%d resp_chars=%d",
            prov,
            mdl,
            operation or "?",
            duration_ms,
            usage.get("tokens_in", 0),
            usage.get("tokens_out", 0),
            len(text or ""),
        )
        return text

    log.error(
        "[AI] request FAILED (all providers exhausted) | tried=%s operation=%s error=%s",
        [a[0] for a in attempts],
        operation or "?",
        str(last_exc)[:300],
    )
    raise last_exc if last_exc else RuntimeError("AI completion failed: no providers")


def complete_vision(
    prompt: str,
    images: list[bytes],
    config: dict | None = None,
    *,
    operation: str | None = None,
    called_by: str | None = None,
) -> str:
    """Send a prompt + images to the configured provider and return the response text.

    images — list of raw image bytes (JPEG or PNG recommended).
    Raises RuntimeError if the configured model does not support vision.

    Provider image formats:
      anthropic   — base64 source blocks in content list
      ollama      — images list in message object
      everything else (groq, openai, mistral, lm_studio) — OpenAI image_url content parts
    """
    import base64

    cfg = config or {}
    provider = cfg.get("provider") or "groq"
    model = cfg.get("model") or "llama-3.3-70b-versatile"

    if not is_vision_capable(provider, model, cfg):
        raise RuntimeError(
            f"Model '{model}' on provider '{provider}' does not support vision. "
            "Select a vision-capable model in Data Entry → AI stack settings."
        )

    log.info(
        "[AI] vision request start | provider=%s model=%s operation=%s called_by=%s images=%d",
        provider,
        model,
        operation or "?",
        called_by or "?",
        len(images),
    )

    t0 = time.monotonic()
    text: str = ""
    usage: dict = {"tokens_in": 0, "tokens_out": 0}
    success = True
    error_msg: str | None = None

    def _media_type(b: bytes) -> str:
        if b[:4] == b"\x89PNG":
            return "image/png"
        if b[:4] == b"GIF8":
            return "image/gif"
        return "image/jpeg"

    try:
        if provider == "anthropic":
            blocks: list[dict] = []
            for img in images:
                b64 = base64.b64encode(img).decode()
                blocks.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": _media_type(img),
                            "data": b64,
                        },
                    }
                )
            blocks.append({"type": "text", "text": prompt})
            messages = [{"role": "user", "content": blocks}]
            db_key, _ = _get_db_row("anthropic")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for anthropic — add one in Settings → AI."
                )
            text, usage = _anthropic_complete(messages, model, api_key)

        elif provider == "ollama":
            b64_imgs = [base64.b64encode(img).decode() for img in images]
            messages = [{"role": "user", "content": prompt, "images": b64_imgs}]
            _, db_url = _get_db_row("ollama")
            base_url = db_url or cfg.get("ollama_url") or "http://localhost:11434"
            text, usage = _ollama_complete(messages, model, base_url)

        elif provider == "google":
            parts: list[dict] = []
            for img in images:
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": _media_type(img),
                            "data": base64.b64encode(img).decode(),
                        },
                    }
                )
            parts.append({"text": prompt})
            messages = [{"role": "user", "content": parts}]
            db_key, _ = _get_db_row("google")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for Google Gemini — add one in Settings → AI."
                )
            text, usage = _gemini_complete(messages, model, api_key)

        else:
            # OpenAI-compatible: groq, openai, mistral, lm_studio
            content_parts: list[dict] = []
            for img in images:
                b64 = base64.b64encode(img).decode()
                content_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{_media_type(img)};base64,{b64}"},
                    }
                )
            content_parts.append({"type": "text", "text": prompt})
            messages = [{"role": "user", "content": content_parts}]

            if provider == "groq":
                db_key, _ = _get_db_row("groq")
                api_key = db_key or cfg.get("api_key")
                if not api_key:
                    raise RuntimeError(
                        "No API key configured for groq — add one in Settings → AI."
                    )
                text, usage = _groq_complete(messages, model, api_key)
            elif provider == "openai":
                db_key, db_url = _get_db_row("openai")
                api_key = db_key or cfg.get("api_key")
                if not api_key:
                    raise RuntimeError(
                        "No API key configured for openai — add one in Settings → AI."
                    )
                text, usage = _openai_complete(messages, model, api_key, db_url)
            elif provider == "mistral":
                db_key, _ = _get_db_row("mistral")
                api_key = db_key or cfg.get("api_key")
                if not api_key:
                    raise RuntimeError(
                        "No API key configured for mistral — add one in Settings → AI."
                    )
                text, usage = _mistral_complete(messages, model, api_key)
            elif provider == "lm_studio":
                db_key2, db_url = _resolve_key("lm_studio", cfg)
                base_url = db_url or cfg.get("lm_studio_url") or "http://localhost:1234"
                api_key = db_key2 or cfg.get("api_key") or "lm-studio"
                text, usage = _openai_complete(messages, model, api_key, base_url)
            else:
                raise ValueError(
                    f"Vision dispatch not implemented for provider: {provider!r}"
                )

    except Exception as exc:
        success = False
        error_msg = str(exc)[:500]
        raise

    finally:
        duration_ms = int((time.monotonic() - t0) * 1000)
        _log_usage(
            provider=provider,
            model=model,
            tokens_in=usage.get("tokens_in", 0),
            tokens_out=usage.get("tokens_out", 0),
            duration_ms=duration_ms,
            operation=operation,
            called_by=called_by,
            success=success,
            error_msg=error_msg,
        )
        if success:
            log.info(
                "[AI] vision request done | provider=%s model=%s operation=%s elapsed_ms=%d "
                "tokens_in=%d tokens_out=%d resp_chars=%d images=%d",
                provider,
                model,
                operation or "?",
                duration_ms,
                usage.get("tokens_in", 0),
                usage.get("tokens_out", 0),
                len(text or ""),
                len(images),
            )
        else:
            log.error(
                "[AI] vision request FAILED | provider=%s model=%s operation=%s elapsed_ms=%d images=%d error=%s",
                provider,
                model,
                operation or "?",
                duration_ms,
                len(images),
                error_msg,
            )

    return text


def extract_json(text: str) -> dict | list:
    """Pull the first JSON object or array out of an AI response."""
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(line for line in lines if not line.startswith("```")).strip()
    for start_char, end_char in [("{", "}"), ("[", "]")]:
        s = text.find(start_char)
        if s == -1:
            continue
        depth = 0
        for i, ch in enumerate(text[s:], s):
            if ch == start_char:
                depth += 1
            elif ch == end_char:
                depth -= 1
                if depth == 0:
                    return json.loads(text[s : i + 1])
    raise ValueError(
        "AI response did not contain a complete JSON object. "
        "Try the deterministic import path or ask AI to retry with a smaller file section."
    )
