-- Équipe et audit (ADM-1).
select plan(6);

select tests.create_user('admin@example.test') as admin \gset
select tests.create_user('support@example.test') as support \gset

select lives_ok($$ select app.grant_staff(tests.create_user('x@example.test'), 'admin', null) $$, 'premier admin par la ligne de commande');
select app.grant_staff(:'admin', 'admin', null);
select throws_ok(format('select app.grant_staff(%L, %L, %L)', :'support', 'admin', :'support'),
  '42501', null, 'un non-admin ne donne pas de rôle');
select lives_ok(format('select app.grant_staff(%L, %L, %L)', :'support', 'support', :'admin'), 'un admin donne un rôle');
select is((select count(*)::int from public.audit_log where action = 'grant_staff' and entity_id = :'support'), 1, 'attribution auditée');
select throws_ok(format('select app.revoke_staff(%L, %L)', :'admin', :'admin'), '22023', null, 'un admin ne se retire pas lui-même');
select lives_ok(format('select app.revoke_staff(%L, %L)', :'support', :'admin'), 'retrait par un admin');

select * from finish();
