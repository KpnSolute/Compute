-- Remove redundant dynamic parent indexes and cover tenant/project foreign keys.
do $$
declare
  duplicate_index record;
begin
  for duplicate_index in
    select namespace_row.nspname as schema_name, index_class.relname as index_name
    from pg_index candidate_index
    join pg_class table_class on table_class.oid = candidate_index.indrelid
    join pg_class index_class on index_class.oid = candidate_index.indexrelid
    join pg_namespace namespace_row on namespace_row.oid = table_class.relnamespace
    where namespace_row.nspname = 'public'
      and index_class.relname like 'uq_tenant_parent_%'
      and not exists (
        select 1 from pg_constraint constraint_row
        where constraint_row.conindid = candidate_index.indexrelid
      )
      and exists (
        select 1
        from pg_index other_index
        where other_index.indrelid = candidate_index.indrelid
          and other_index.indexrelid <> candidate_index.indexrelid
          and other_index.indisvalid
          and other_index.indisunique = candidate_index.indisunique
          and other_index.indkey = candidate_index.indkey
          and other_index.indpred is not distinct from candidate_index.indpred
      )
  loop
    execute format(
      'drop index if exists %I.%I',
      duplicate_index.schema_name,
      duplicate_index.index_name
    );
  end loop;
end;
$$;

do $$
declare
  foreign_key record;
  column_list text;
  index_name text;
begin
  for foreign_key in
    select
      constraint_row.oid,
      constraint_row.conrelid,
      constraint_row.conname,
      constraint_row.conkey,
      namespace_row.nspname as schema_name,
      table_class.relname as table_name
    from pg_constraint constraint_row
    join pg_class table_class on table_class.oid = constraint_row.conrelid
    join pg_namespace namespace_row on namespace_row.oid = table_class.relnamespace
    where namespace_row.nspname = 'public'
      and constraint_row.contype = 'f'
      and (
        constraint_row.conname like 'tenant_%'
        or constraint_row.conname like 'workspace_projects_%'
        or constraint_row.conname like 'project_%'
        or constraint_row.conname like 'generation_%'
      )
      and not exists (
        select 1
        from pg_index index_row
        where index_row.indrelid = constraint_row.conrelid
          and index_row.indisvalid
          and (index_row.indkey::smallint[])[0:cardinality(constraint_row.conkey)-1]
            = constraint_row.conkey
      )
  loop
    select string_agg(format('%I', attribute_row.attname), ', ' order by key_row.ordinality)
    into strict column_list
    from unnest(foreign_key.conkey) with ordinality key_row(attnum, ordinality)
    join pg_attribute attribute_row
      on attribute_row.attrelid = foreign_key.conrelid
      and attribute_row.attnum = key_row.attnum;

    index_name := left(
      format(
        'idx_%s_fk_%s',
        foreign_key.table_name,
        substr(md5(foreign_key.conname), 1, 8)
      ),
      63
    );
    execute format(
      'create index if not exists %I on %I.%I (%s)',
      index_name,
      foreign_key.schema_name,
      foreign_key.table_name,
      column_list
    );
  end loop;
end;
$$;

alter function public.prevent_inventory_overpull()
  set search_path = public, pg_temp;
