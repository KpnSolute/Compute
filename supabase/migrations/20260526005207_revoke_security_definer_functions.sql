-- Revoke public REST API access to SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.block_txn_history_mutation() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_stage_merge(uuid, uuid) FROM anon, authenticated;;
