-- Hashed staff PIN storage for tenant-local KpnCompute sign-in.
--
-- Additive and reversible. MJCC staff continue to sign in with the same
-- username and PIN at their own tenant route; only the storage and comparison
-- change. Rows keep their existing plaintext `pin` until a successful login
-- migrates them, at which point `pin_hash` becomes the only value consulted.
--
-- Rollback: alter table user_profiles drop column pin_hash;

alter table user_profiles
  add column if not exists pin_hash text;

comment on column user_profiles.pin_hash is
  'scrypt hash of the staff PIN (kpn-scrypt$1$N$r$p$salt$digest). When present, '
  'the legacy plaintext pin column is ignored by authentication.';

-- Backfill is intentionally NOT performed here: the plaintext PIN is only
-- available at sign-in time, and hashing it server-side on first successful
-- login avoids a migration that would have to read every plaintext credential.

-- Once every active staff row has a pin_hash, the plaintext column can be
-- dropped in a separate, separately approved migration:
--   alter table user_profiles drop column pin;
