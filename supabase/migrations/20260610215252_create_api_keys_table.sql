CREATE TABLE IF NOT EXISTS api_keys (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider text NOT NULL UNIQUE,
  api_key  text,
  base_url text,
  is_active boolean DEFAULT false,
  updated_by text,
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY api_keys_service_only ON api_keys USING (false);

INSERT INTO api_keys (provider, is_active) VALUES
  ('groq',      false),
  ('anthropic', false),
  ('openai',    false),
  ('ollama',    false)
ON CONFLICT (provider) DO NOTHING;;
