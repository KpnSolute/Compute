ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS phone      text DEFAULT '',
  ADD COLUMN IF NOT EXISTS job_title  text DEFAULT '',
  ADD COLUMN IF NOT EXISTS avatar_url text DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio        text DEFAULT '';;
