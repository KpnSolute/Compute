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


def _anthropic_complete(
    messages: list[dict], model: str, api_key: str
) -> tuple[str, dict]:
    system_parts = [m["content"] for m in messages if m.get("role") == "system"]
    user_messages = [m for m in messages if m.get("role") != "system"]
    body: dict = {"model": model, "max_tokens": 4096, "messages": user_messages}
    if system_parts:
        body["system"] = "\n\n".join(system_parts)
    resp = httpx.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=body,
        timeout=60,
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


def _gemini_complete(
    messages: list[dict], model: str, api_key: str
) -> tuple[str, dict]:
    """Call Google Gemini generateContent API."""
    # Split system messages from conversation turns
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
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096},
    }
    if system_parts:
        body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}

    timeout_sec = 120 if any(isinstance(m.get("content"), list) for m in turns) else 60
    resp = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
        json=body,
        timeout=timeout_sec,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    meta = data.get("usageMetadata", {})
    return text, {
        "tokens_in": meta.get("promptTokenCount", 0),
        "tokens_out": meta.get("candidatesTokenCount", 0),
    }


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

    t0 = time.monotonic()
    text: str = ""
    usage: dict = {"tokens_in": 0, "tokens_out": 0}
    success = True
    error_msg: str | None = None

    try:
        if provider == "groq":
            db_key, _ = _get_db_row("groq")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for groq — add one in Settings → AI."
                )
            text, usage = _groq_complete(messages, model, api_key)

        elif provider == "anthropic":
            db_key, _ = _get_db_row("anthropic")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for anthropic — add one in Settings → AI."
                )
            text, usage = _anthropic_complete(
                messages, model or "claude-sonnet-4-20250514", api_key
            )

        elif provider == "openai":
            db_key, db_url = _get_db_row("openai")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for openai — add one in Settings → AI."
                )
            text, usage = _openai_complete(
                messages, model or "gpt-4o-mini", api_key, db_url
            )

        elif provider == "mistral":
            db_key, _ = _get_db_row("mistral")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for mistral — add one in Settings → AI."
                )
            text, usage = _mistral_complete(
                messages, model or "mistral-small-latest", api_key
            )

        elif provider == "google":
            db_key, _ = _get_db_row("google")
            api_key = db_key or cfg.get("api_key")
            if not api_key:
                raise RuntimeError(
                    "No API key configured for Google Gemini — add one in Settings → AI."
                )
            text, usage = _gemini_complete(
                messages, model or "gemini-2.0-flash", api_key
            )

        elif provider == "ollama":
            _, db_url = _get_db_row("ollama")
            base_url = db_url or cfg.get("ollama_url") or "http://localhost:11434"
            text, usage = _ollama_complete(messages, model, base_url)

        elif provider == "lm_studio":
            _, db_url = _get_db_row("lm_studio")
            base_url = db_url or cfg.get("lm_studio_url") or "http://localhost:1234"
            db_key, _ = _get_db_row("lm_studio")
            api_key = db_key or cfg.get("api_key") or "lm-studio"
            text, usage = _openai_complete(
                messages, model or "local-model", api_key, base_url
            )

        else:
            raise ValueError(
                f"Unknown AI provider: {provider!r}. Must be one of {SUPPORTED_PROVIDERS}"
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
                "[AI] request done | provider=%s model=%s operation=%s elapsed_ms=%d "
                "tokens_in=%d tokens_out=%d resp_chars=%d",
                provider,
                model,
                operation or "?",
                duration_ms,
                usage.get("tokens_in", 0),
                usage.get("tokens_out", 0),
                len(text or ""),
            )
        else:
            log.error(
                "[AI] request FAILED | provider=%s model=%s operation=%s elapsed_ms=%d error=%s",
                provider,
                model,
                operation or "?",
                duration_ms,
                error_msg,
            )

    return text


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
                _, db_url = _get_db_row("lm_studio")
                base_url = db_url or cfg.get("lm_studio_url") or "http://localhost:1234"
                db_key2, _ = _get_db_row("lm_studio")
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
    raise ValueError(f"No JSON found in AI response: {text[:200]}")
