-- Additive: lets new staging entries attach to a user's existing OPEN pr
-- instead of always minting a new one. Used by the auto-PR-on-stage hook so
-- a user uploading several invoices in one session gets ONE PR, not N.
create or replace function public.sc_attach_to_open_pr(
  p_author uuid, p_entry_ids uuid[]
) returns public.pull_requests
language plpgsql security definer set search_path = public as $fn$
declare pr public.pull_requests;
begin
  select * into pr from public.pull_requests
   where author_id = p_author and status = 'open'
   order by created_at desc limit 1;

  if pr.pr_id is null then
    return null;  -- caller should fall back to sc_open_pull_request
  end if;

  update public.staging_entries
     set pull_request_id = pr.pr_id
   where entry_id = any(p_entry_ids)
     and submitted_by = p_author
     and status = 'pending'
     and pull_request_id is null;

  return pr;
end $fn$;

grant execute on function public.sc_attach_to_open_pr(uuid,uuid[]) to service_role;;
