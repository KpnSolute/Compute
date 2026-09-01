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
    def __init__(self, config_data, key_data):
        self.config_data = config_data
        self.key_data = key_data

    def table(self, name):
        return _FakeQuery(
            self.config_data if name == "ai_stack_config" else self.key_data
        )


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
                    "key_id": "key-id",
                    "tenant_id": "tenant-id",
                }
            ],
            [
                {
                    "api_key": "test-key",
                    "base_url": None,
                    "model_override": "gemini-2.5-flash",
                }
            ],
        ),
    )

    assert context.get_ai_config() == {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "api_key": "test-key",
        "ollama_url": None,
        "is_vision": True,
    }
