"""Provider-agnostic AI engine. Reads active config from app_settings or env fallback."""

import json
import os
import httpx

# ── provider implementations ──────────────────────────────────────────────────


def _groq_complete(messages: list[dict], model: str, api_key: str) -> str:
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
    return resp.json()["choices"][0]["message"]["content"]


def _ollama_complete(messages: list[dict], model: str, base_url: str) -> str:
    resp = httpx.post(
        f"{base_url}/api/chat",
        json={"model": model, "messages": messages, "stream": False},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["message"]["content"]


# ── public interface ──────────────────────────────────────────────────────────

SUPPORTED_PROVIDERS = ("groq", "ollama")

GROQ_MODELS = [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "llama3-70b-8192",
    "gemma2-9b-it",
    "qwen-qwq-32b",
]

OLLAMA_MODELS = [
    "llama3.2:3b",
    "llama3.1:8b",
    "mistral:7b",
    "mixtral:8x7b",
]


def complete(messages: list[dict], config: dict | None = None) -> str:
    """
    Send messages to the configured AI provider and return the response text.
    config: {'provider': 'groq'|'ollama', 'model': '...', 'ollama_url': '...'}
    Falls back to env vars if config is None.
    """
    cfg = config or {}
    provider = cfg.get("provider") or os.getenv("AI_PROVIDER", "groq")
    model = cfg.get("model") or os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

    if provider == "groq":
        api_key = os.getenv("GROQ_API_KEY", "")
        if not api_key:
            raise RuntimeError("GROQ_API_KEY not set")
        return _groq_complete(messages, model, api_key)

    if provider == "ollama":
        base_url = cfg.get("ollama_url") or os.getenv(
            "OLLAMA_URL", "http://localhost:11434"
        )
        return _ollama_complete(messages, model, base_url)

    raise ValueError(
        f"Unknown AI provider: {provider!r}. Must be one of {SUPPORTED_PROVIDERS}"
    )


def extract_json(text: str) -> dict | list:
    """Pull the first JSON object or array out of an AI response."""
    text = text.strip()
    # strip markdown code fences
    if text.startswith("```"):
        lines = text.splitlines()
        text = "\n".join(line for line in lines if not line.startswith("```")).strip()
    # find outermost { or [
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
