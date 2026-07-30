
-- Recreate rls_auto_enable as SECURITY INVOKER with pinned search_path.
-- Event trigger functions run in the DDL executor's context, so SECURITY INVOKER
-- is safe here and removes the SECURITY DEFINER exposure via REST API.
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table', 'partitioned table')
  LOOP
    IF cmd.schema_name IS NOT NULL
      AND cmd.schema_name IN ('public')
      AND cmd.schema_name NOT IN ('pg_catalog', 'information_schema')
      AND cmd.schema_name NOT LIKE 'pg_toast%'
      AND cmd.schema_name NOT LIKE 'pg_temp%'
    THEN
      BEGIN
        EXECUTE format(
          'ALTER TABLE IF EXISTS %s ENABLE ROW LEVEL SECURITY',
          cmd.object_identity
        );
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION WHEN OTHERS THEN
        RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
    ELSE
      RAISE LOG 'rls_auto_enable: skip % (system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    END IF;
  END LOOP;
END;
$$;

-- Revoke REST-callable execute from public roles
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM authenticated;
;
