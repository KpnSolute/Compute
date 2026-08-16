-- Reconcile duplicate relationships introduced by the tenant integrity
-- migration. PostgREST treats every foreign key as an embeddable relationship;
-- retaining both the legacy single-column FK and its tenant-aware composite FK
-- makes existing embeds ambiguous (PGRST201).
--
-- Replace each generated pair with one composite FK under the original stable
-- constraint name. Preserve the legacy FK's MATCH, ON UPDATE, ON DELETE, and
-- deferrability semantics. For SET NULL deletes, only nullable relationship
-- columns are cleared; tenant_id remains intact and non-null.

do $$
declare
  legacy_fk record;
  tenant_fk record;
  source_columns text;
  target_columns text;
  match_clause text;
  update_clause text;
  delete_clause text;
  deferrable_clause text;
  reconciled_count integer := 0;
begin
  for legacy_fk in
    select
      constraint_row.*,
      source_tenant.attnum as source_tenant_attnum,
      target_tenant.attnum as target_tenant_attnum
    from pg_constraint constraint_row
    join pg_attribute source_tenant
      on source_tenant.attrelid = constraint_row.conrelid
     and source_tenant.attname = 'tenant_id'
     and not source_tenant.attisdropped
    join pg_attribute target_tenant
      on target_tenant.attrelid = constraint_row.confrelid
     and target_tenant.attname = 'tenant_id'
     and not target_tenant.attisdropped
    where constraint_row.contype = 'f'
      and constraint_row.connamespace = 'public'::regnamespace
      and constraint_row.conname not like 'tenant\_%' escape '\'
      and not source_tenant.attnum = any(constraint_row.conkey)
    order by constraint_row.conrelid, constraint_row.conname
  loop
    select generated_constraint.*
      into tenant_fk
    from pg_constraint generated_constraint
    where generated_constraint.contype = 'f'
      and generated_constraint.connamespace = 'public'::regnamespace
      and generated_constraint.conrelid = legacy_fk.conrelid
      and generated_constraint.confrelid = legacy_fk.confrelid
      and generated_constraint.conname like 'tenant\_%' escape '\'
      -- The generated tenant constraints used default NO ACTION semantics.
      -- This distinguishes them from intentionally modeled relationships.
      and generated_constraint.confupdtype = 'a'
      and generated_constraint.confdeltype = 'a'
      and array_length(generated_constraint.conkey, 1) =
          array_length(legacy_fk.conkey, 1) + 1
      and array_length(generated_constraint.confkey, 1) =
          array_length(legacy_fk.confkey, 1) + 1
      and generated_constraint.conkey[1:array_length(legacy_fk.conkey, 1)] =
          legacy_fk.conkey
      and generated_constraint.confkey[1:array_length(legacy_fk.confkey, 1)] =
          legacy_fk.confkey
      and generated_constraint.conkey[array_length(generated_constraint.conkey, 1)] =
          legacy_fk.source_tenant_attnum
      and generated_constraint.confkey[array_length(generated_constraint.confkey, 1)] =
          legacy_fk.target_tenant_attnum
    limit 1;

    if not found then
      continue;
    end if;

    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
      into source_columns
    from unnest(legacy_fk.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = legacy_fk.conrelid
     and attribute.attnum = key_column.attnum;

    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
      into target_columns
    from unnest(legacy_fk.confkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = legacy_fk.confrelid
     and attribute.attnum = key_column.attnum;

    match_clause := case legacy_fk.confmatchtype
      when 'f' then ' match full'
      when 'p' then ' match partial'
      else ''
    end;

    update_clause := case legacy_fk.confupdtype
      when 'r' then ' on update restrict'
      when 'c' then ' on update cascade'
      when 'n' then ' on update set null'
      when 'd' then ' on update set default'
      else ''
    end;

    delete_clause := case legacy_fk.confdeltype
      when 'r' then ' on delete restrict'
      when 'c' then ' on delete cascade'
      when 'n' then format(' on delete set null (%s)', source_columns)
      when 'd' then ' on delete set default'
      else ''
    end;

    deferrable_clause := case
      when not legacy_fk.condeferrable then ' not deferrable'
      when legacy_fk.condeferred then ' deferrable initially deferred'
      else ' deferrable initially immediate'
    end;

    execute format(
      'alter table %s drop constraint %I',
      legacy_fk.conrelid::regclass,
      tenant_fk.conname
    );
    execute format(
      'alter table %s drop constraint %I',
      legacy_fk.conrelid::regclass,
      legacy_fk.conname
    );
    execute format(
      'alter table %s add constraint %I foreign key (%s, tenant_id) ' ||
      'references %s(%s, tenant_id)%s%s%s%s not valid',
      legacy_fk.conrelid::regclass,
      legacy_fk.conname,
      source_columns,
      legacy_fk.confrelid::regclass,
      target_columns,
      match_clause,
      update_clause,
      delete_clause,
      deferrable_clause
    );
    execute format(
      'alter table %s validate constraint %I',
      legacy_fk.conrelid::regclass,
      legacy_fk.conname
    );

    reconciled_count := reconciled_count + 1;
  end loop;

  if reconciled_count = 0 then
    raise exception 'No generated tenant foreign-key pairs were found to reconcile';
  end if;

  raise notice 'Reconciled % tenant foreign-key pairs', reconciled_count;
end;
$$;

-- Ask PostgREST to refresh relationship metadata immediately after commit.
notify pgrst, 'reload schema';
