"""Gemini must fail cleanly (not KeyError) when it returns no content.

Regression for the production incident where scanned invoices (image-only PDFs)
routed to Gemini 2.5 Flash vision, whose thinking budget consumed the whole
maxOutputTokens and returned finishReason=MAX_TOKENS with no content block.
The old code did data["candidates"][0]["content"]["parts"][0]["text"] and threw
a bare KeyError('content') that logged as the opaque string "'content'".
"""

import pytest

from backend.ai import engine


def test_max_tokens_no_content_raises_clear_error():
    # Exact shape Gemini returns when thinking exhausts the output budget.
    data = {
        "candidates": [{"finishReason": "MAX_TOKENS", "index": 0}],
        "usageMetadata": {"candidatesTokenCount": 0, "thoughtsTokenCount": 32768},
    }
    with pytest.raises(RuntimeError) as exc:
        engine._gemini_extract_text(data)
    msg = str(exc.value)
    assert "MAX_TOKENS" in msg and "empty response" in msg
    assert msg != "'content'"  # never the opaque KeyError string again


def test_prompt_block_raises_clear_error():
    data = {"promptFeedback": {"blockReason": "SAFETY"}}
    with pytest.raises(RuntimeError, match="blockReason=SAFETY"):
        engine._gemini_extract_text(data)


def test_no_candidates_raises_clear_error():
    with pytest.raises(RuntimeError, match="no candidates"):
        engine._gemini_extract_text({"candidates": []})


def test_happy_path_returns_joined_text():
    data = {
        "candidates": [
            {"content": {"parts": [{"text": "[{"}, {"text": '"sku":"1"}]'}]}}
        ]
    }
    assert engine._gemini_extract_text(data) == '[{"sku":"1"}]'


def test_gemini_25_flash_disables_thinking(monkeypatch):
    """The 2.5 request body must carry thinkingConfig.thinkingBudget=0."""
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["body"] = json
        return _Resp()

    monkeypatch.setattr(engine.httpx, "post", fake_post)
    engine._gemini_complete(
        [{"role": "user", "content": "hi"}], "gemini-2.5-flash", "k"
    )
    tc = captured["body"]["generationConfig"].get("thinkingConfig")
    assert tc == {"thinkingBudget": 0}


def test_non_25_model_omits_thinking_config(monkeypatch):
    captured = {}

    class _Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["body"] = json
        return _Resp()

    monkeypatch.setattr(engine.httpx, "post", fake_post)
    engine._gemini_complete(
        [{"role": "user", "content": "hi"}], "gemini-2.0-flash", "k"
    )
    assert "thinkingConfig" not in captured["body"]["generationConfig"]
