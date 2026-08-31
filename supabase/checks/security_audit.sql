-- Read-only audit for the public schema. This statement does not change data or permissions.
with public_tables as (
  select
    c.oid,
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    count(pol.polname) as policy_count
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  left join pg_catalog.pg_policy pol on pol.polrelid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
  group by c.oid, c.relname, c.relrowsecurity
),
definer_functions as (
  select
    p.oid,
    p.oid::regprocedure::text as function_name,
    coalesce(p.proconfig, array[]::text[]) as runtime_settings
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
),
definer_public_execute as (
  select distinct functions.function_name
  from definer_functions functions
  join pg_catalog.pg_proc p on p.oid = functions.oid
  cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
  where acl.grantee = 0
    and acl.privilege_type = 'EXECUTE'
),
client_table_access as (
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'tables_without_rls', coalesce((
    select jsonb_agg(table_name order by table_name)
    from public_tables
    where not rls_enabled
  ), '[]'::jsonb),
  'rls_tables_without_policies_review', coalesce((
    select jsonb_agg(table_name order by table_name)
    from public_tables
    where rls_enabled and policy_count = 0
  ), '[]'::jsonb),
  'definer_functions_without_safe_search_path', coalesce((
    select jsonb_agg(function_name order by function_name)
    from definer_functions
    where not exists (
      select 1
      from unnest(runtime_settings) setting
      where setting like 'search_path=%pg_temp%'
    )
  ), '[]'::jsonb),
  'definer_functions_executable_by_public', coalesce((
    select jsonb_agg(function_name order by function_name)
    from definer_public_execute
  ), '[]'::jsonb),
  'client_table_access_review', coalesce((
    select jsonb_agg(
      jsonb_build_object('table', table_name, 'role', grantee, 'privilege', privilege_type)
      order by table_name, grantee, privilege_type
    )
    from client_table_access
  ), '[]'::jsonb)
)) as security_audit;
