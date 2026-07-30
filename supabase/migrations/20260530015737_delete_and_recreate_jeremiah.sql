
-- Remove old broken auth user (keep user_profiles row)
DELETE FROM auth.users WHERE id = '6edf25a5-4265-4131-9183-a9a964a609de';
-- Also clear the profile so we can reinsert cleanly
DELETE FROM user_profiles WHERE id = '6edf25a5-4265-4131-9183-a9a964a609de';
;
