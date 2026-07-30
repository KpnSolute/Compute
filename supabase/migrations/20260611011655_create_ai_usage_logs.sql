CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider    text NOT NULL,
  model       text NOT NULL,
  operation   text,
  tokens_in   integer DEFAULT 0,
  tokens_out  integer DEFAULT 0,
  cost_usd    numeric(10,6) DEFAULT 0,
  duration_ms integer DEFAULT 0,
  success     boolean DEFAULT true,
  error_msg   text,
  called_by   text,
  created_at  timestamptz DEFAULT now()
);
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_logs_service_only ON ai_usage_logs USING (false);
CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx ON ai_usage_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_logs_provider_idx   ON ai_usage_logs (provider);

INSERT INTO api_keys (provider, is_active) VALUES
  ('lm_studio', false),
  ('mistral',   false)
ON CONFLICT (provider) DO NOTHING;;
