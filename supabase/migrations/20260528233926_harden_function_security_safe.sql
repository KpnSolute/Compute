-- Pin search_path on the flagged push/pull function (behavior-preserving)
alter function public.increment_inventory_field(uuid, integer, integer, text, numeric)
  set search_path = public, pg_temp;

-- Trigger guard function should never be RPC-callable; trigger still fires regardless of EXECUTE grants
revoke execute on function public.block_txn_history_mutation() from public;
revoke execute on function public.block_txn_history_mutation() from anon;
revoke execute on function public.block_txn_history_mutation() from authenticated;;
