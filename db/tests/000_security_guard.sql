-- Garde de sécurité (constitution V, décision 0002) : toute table de public a RLS, et aucune
-- n'est accordée aux rôles de la Data API.

select plan(3);

select is_empty(
  $$
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'toute table de public a RLS activé'
);

select is_empty(
  $$
    select table_name || ' : ' || grantee || ' ' || privilege_type
    from information_schema.role_table_grants
    where grantee in ('anonymous', 'authenticated') and table_schema = 'public'
  $$,
  'aucune table de public n''est accordée à anonymous ou authenticated'
);

select is_empty(
  $$
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (has_function_privilege('anonymous', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    union all
    select 'schéma app accessible'
    where has_schema_privilege('anonymous', 'app', 'USAGE')
       or has_schema_privilege('authenticated', 'app', 'USAGE')
  $$,
  'aucune fonction exposée à la Data API'
);

select * from finish();
