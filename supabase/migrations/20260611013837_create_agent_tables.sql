
-- Agent conversation history
CREATE TABLE IF NOT EXISTS agent_conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content text NOT NULL,
  tool_name text,
  tool_args jsonb,
  tool_result jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_conv_user ON agent_conversations(user_id, created_at DESC);
ALTER TABLE agent_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON agent_conversations;
CREATE POLICY "service role only" ON agent_conversations USING (auth.role() = 'service_role');

-- Agent rate-limiting usage tracking
CREATE TABLE IF NOT EXISTS agent_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_usage_user ON agent_usage(user_id, created_at DESC);
ALTER TABLE agent_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service role only" ON agent_usage;
CREATE POLICY "service role only" ON agent_usage USING (auth.role() = 'service_role');
;
