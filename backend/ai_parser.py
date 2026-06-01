"""
ai_parser.py — AI invoice parsing for MJCC.

Supports two input modes:
  1. Text  — paste raw invoice text (existing flow)
  2. Image — base64-encoded photo of invoice or delivery receipt
             (JPEG, PNG, WEBP, GIF supported)

Provider routing (AI_PROVIDER env var):
  groq   — text only (Groq does not support vision yet on free tier)
  gemini — text + image (Gemini 1.5 Flash / 2.0 Flash)
  ollama — text only (llama3.2 vision models need explicit setup)
  claude — text + image (claude-haiku-4-5 via Anthropic API — most accurate)
"""

import base64
import json
import logging
import os
import re
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

AI_PROVIDER     = os.getenv("AI_PROVIDER", "groq")
AI_MODEL        = os.getenv("AI_MODEL", "")
GROQ_API_KEY    = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY  = os.getenv("GEMINI_API_KEY", "")
ANTHROPIC_KEY   = os.getenv("ANTHROPIC_API_KEY", os.getenv("CLAUDE_API_KEY", ""))
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

# ── Prompt templates ──────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an expert at parsing US Foods food service invoices for Miami Job Corps Cafeteria.

Given invoice content (text or image) and a catalog of items, extract each line item and match it to the closest catalog entry.

Return ONLY a JSON array — no markdown, no explanation, no preamble.

Each element must have:
  catalog_item_id  — item_id from catalog (string UUID) or null if no match
  sku              — catalog SKU or invoice SKU
  description      — catalog description (or invoice description if unmatched)
  invoice_description — raw description from invoice
  quantity         — numeric quantity from invoice
  unit_price       — unit price from invoice (null if not found)
  confidence       — 0.0 to 1.0
  matched          — true/false

Match by SKU first (exact), then by description similarity."""


def _build_catalog_str(catalog_items: list) -> str:
    lines = []
    for item in catalog_items[:200]:
        lines.append(
            f"  id={item['item_id']} sku={item.get('sku','')} "
            f"desc=\"{item['description']}\" price=${item.get('unit_price', 0)}"
        )
    return "\n".join(lines)


def _build_text_prompt(catalog_items: list, invoice_text: str) -> str:
    return (
        f"CATALOG ({len(catalog_items)} items):\n"
        f"{_build_catalog_str(catalog_items)}\n\n"
        f"INVOICE TEXT:\n{invoice_text[:8000]}\n\n"
        "Match each invoice line to the catalog. Return JSON array only."
    )


def _parse_json_response(text: str) -> list:
    """Strip markdown fences and parse JSON."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    text = text.strip()
    parsed = json.loads(text)
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict) and "matches" in parsed:
        return parsed["matches"]
    return []


# ── Provider implementations ──────────────────────────────────────────

def _parse_groq_text(catalog_items: list, invoice_text: str) -> list:
    """Groq: text only. Fast, free tier."""
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY not set")

    model   = AI_MODEL or "mixtral-8x7b-32768"
    payload = {
        "model":    model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": _build_text_prompt(catalog_items, invoice_text)},
        ],
        "temperature": 0.1,
        "max_tokens":  4000,
    }
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=data,
        headers={
            "Authorization": f"Bearer {GROQ_API_KEY}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
    return _parse_json_response(result["choices"][0]["message"]["content"])


def _parse_gemini(catalog_items: list, invoice_text: str = "",
                  image_b64: str = "", image_mime: str = "image/jpeg") -> list:
    """Gemini: supports text + image. Uses REST API directly."""
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY not set")

    model = AI_MODEL or "gemini-2.0-flash"

    parts = []

    # Text part: system prompt + catalog + invoice text
    text_content = (
        SYSTEM_PROMPT + "\n\n"
        + _build_text_prompt(catalog_items, invoice_text if invoice_text else "See invoice image above.")
    )
    parts.append({"text": text_content})

    # Image part (if provided)
    if image_b64:
        parts.insert(0, {
            "inlineData": {
                "mimeType": image_mime,
                "data":     image_b64,
            }
        })

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4000},
    }
    url  = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={GEMINI_API_KEY}"
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=45) as resp:
        result = json.loads(resp.read())
    raw = result["candidates"][0]["content"]["parts"][0]["text"]
    return _parse_json_response(raw)


def _parse_claude(catalog_items: list, invoice_text: str = "",
                  image_b64: str = "", image_mime: str = "image/jpeg") -> list:
    """
    Claude claude-haiku-4-5 via Anthropic API.
    Best accuracy for handwritten/scanned invoices.
    Supports text + image.
    """
    if not ANTHROPIC_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY not set")

    model   = AI_MODEL or "claude-haiku-4-5"
    content = []

    if image_b64:
        content.append({
            "type":   "image",
            "source": {"type": "base64", "media_type": image_mime, "data": image_b64},
        })

    catalog_str  = _build_catalog_str(catalog_items)
    user_text    = (
        f"CATALOG ({len(catalog_items)} items):\n{catalog_str}\n\n"
        + (f"INVOICE TEXT:\n{invoice_text[:8000]}\n\n" if invoice_text else "Parse the invoice image above.\n\n")
        + "Match each invoice line to the catalog. Return JSON array only."
    )
    content.append({"type": "text", "text": user_text})

    payload = {
        "model":      model,
        "max_tokens": 4000,
        "system":     SYSTEM_PROMPT,
        "messages":   [{"role": "user", "content": content}],
    }
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=data,
        headers={
            "x-api-key":         ANTHROPIC_KEY,
            "anthropic-version": "2023-06-01",
            "Content-Type":      "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        result = json.loads(resp.read())
    raw = result["content"][0]["text"]
    return _parse_json_response(raw)


def _parse_ollama_text(catalog_items: list, invoice_text: str) -> list:
    """Ollama: local text-only parsing."""
    model   = AI_MODEL or "llama3.2:3b"
    payload = {
        "model":  model,
        "prompt": SYSTEM_PROMPT + "\n\n" + _build_text_prompt(catalog_items, invoice_text),
        "stream": False,
    }
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
    return _parse_json_response(result.get("response", "[]"))


# ── Public interface ──────────────────────────────────────────────────

def parse_invoice_text(catalog_items: list, invoice_text: str) -> dict:
    """
    Parse a text invoice. Called from existing /parse-invoice endpoint.
    Routes to the configured AI_PROVIDER.
    """
    provider = AI_PROVIDER.lower()
    logger.info(f"Parsing text invoice via provider={provider}")

    try:
        if provider == "groq":
            matches = _parse_groq_text(catalog_items, invoice_text)
        elif provider == "gemini":
            matches = _parse_gemini(catalog_items, invoice_text=invoice_text)
        elif provider == "claude":
            matches = _parse_claude(catalog_items, invoice_text=invoice_text)
        elif provider == "ollama":
            matches = _parse_ollama_text(catalog_items, invoice_text)
        else:
            raise ValueError(f"Unknown AI provider: {provider}")

        return {"matches": matches, "provider": provider, "match_count": len(matches), "source": "text"}

    except Exception as e:
        logger.exception(f"Text invoice parsing failed with {provider}: {e}")
        raise


def parse_invoice_image(catalog_items: list, image_b64: str,
                         image_mime: str = "image/jpeg") -> dict:
    """
    Parse an invoice or delivery receipt photo.
    image_b64 — base64-encoded image (strip data URI prefix before passing in)
    image_mime — MIME type: image/jpeg, image/png, image/webp, image/gif

    Only providers with vision support are used:
      - gemini  (default if GEMINI_API_KEY set)
      - claude  (if ANTHROPIC_API_KEY set)
      - groq    → falls back to text extraction error
      - ollama  → falls back to text extraction error
    """
    provider = AI_PROVIDER.lower()
    logger.info(f"Parsing image invoice via provider={provider}")

    # Auto-upgrade to best available vision provider
    if provider in ("groq", "ollama"):
        if GEMINI_API_KEY:
            provider = "gemini"
            logger.info("Provider upgraded to gemini for image parsing")
        elif ANTHROPIC_KEY:
            provider = "claude"
            logger.info("Provider upgraded to claude for image parsing")
        else:
            raise RuntimeError(
                f"Provider '{provider}' does not support image parsing. "
                "Set GEMINI_API_KEY or ANTHROPIC_API_KEY to enable image invoice parsing."
            )

    try:
        if provider == "gemini":
            matches = _parse_gemini(catalog_items, image_b64=image_b64, image_mime=image_mime)
        elif provider == "claude":
            matches = _parse_claude(catalog_items, image_b64=image_b64, image_mime=image_mime)
        else:
            raise ValueError(f"Unsupported vision provider: {provider}")

        return {
            "matches":     matches,
            "provider":    provider,
            "match_count": len(matches),
            "source":      "image",
        }

    except Exception as e:
        logger.exception(f"Image invoice parsing failed with {provider}: {e}")
        raise


def validate_image(image_b64: str) -> tuple[str, str]:
    """
    Validate a base64 image and detect its MIME type.
    Strips data URI prefix if present.
    Returns (clean_b64, mime_type).
    Raises ValueError if invalid.
    """
    # Strip data URI prefix: data:image/jpeg;base64,<data>
    if image_b64.startswith("data:"):
        try:
            header, data = image_b64.split(",", 1)
            mime = header.split(":")[1].split(";")[0]
            return data, mime
        except Exception:
            raise ValueError("Invalid data URI format")

    # Detect from magic bytes
    try:
        raw = base64.b64decode(image_b64[:32])
    except Exception:
        raise ValueError("Invalid base64 encoding")

    if raw[:2] == b"\xff\xd8":
        return image_b64, "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return image_b64, "image/png"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return image_b64, "image/webp"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return image_b64, "image/gif"

    # Default to JPEG
    return image_b64, "image/jpeg"
