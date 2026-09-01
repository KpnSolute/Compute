from types import SimpleNamespace

from backend.ai import context


class _FakeQuery:
    def __init__(self, data):
        self.data = data

    def select(self, _columns):
        return self

    def eq(self, _column, _value):
        return self

    def limit(self, _count):
        return self

    def execute(self):
        return SimpleNamespace(data=self.data)


class _FakeSupabase:
    def __init__(self, data):
        self.data = data

    def table(self, _name):
        return _FakeQuery(self.data)


def test_get_ai_config_accepts_embedded_key_list(monkeypatch):
    monkeypatch.setattr(
        context,
        "supabase_service",
        _FakeSupabase(
            [
                {
                    "provider": "google",
                    "model": "gemini-2.5-flash",
                    "is_vision": True,
                    "vision_capable": True,
                    "ollama_url": None,
                    "ai_provider_keys": [
                        {
                            "api_key": "test-key",
                            "base_url": None,
                            "model_override": "gemini-2.5-flash",
                        }
                    ],
                }
            ]
        ),
    )

    assert context.get_ai_config() == {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "api_key": "test-key",
        "ollama_url": None,
        "is_vision": True,
    }
