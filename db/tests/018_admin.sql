-- Administration (ADM-1 à ADM-5).
select plan(14);

select tests.create_user('chef@example.test') as admin \gset
select tests.create_user('aide@example.test') as support \gset
select app.grant_staff(:'admin', 'admin', null);
select app.grant_staff(:'support', 'support', :'admin');
select tests.ready_org('adm') as org \gset

select ok((app.admin_dashboard(30) ->> 'organizations')::int >= 1, 'tableau de bord : organisations comptées');
select ok(jsonb_array_length(app.admin_dashboard(7) -> 'series') = 7, 'série quotidienne sur la fenêtre');

select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'taxes', 'x', '{}', :'admin'), '22023', null, 'table non configurable refusée');
select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'document_types', 'quote', '{"counts_quota":false}', :'admin'), '22023', null, 'champ protégé refusé');
select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'ai_tasks', 'read', '{"model":"autre"}', :'support'), '42501', null, 'support ne configure pas');
select app.admin_update_reference('ai_tasks', 'read', '{"model":"gpt-test","pricing":{"input_per_mtok":150000}}', :'admin');
select is((select model from public.ai_tasks where task = 'read'), 'gpt-test', 'modèle d''IA modifié');
select is((select (pricing ->> 'input_per_mtok')::int from public.ai_tasks where task = 'read'), 150000, 'prix du modèle enregistré');
select ok(exists (select 1 from public.audit_log where action = 'update_reference' and entity = 'ai_tasks'), 'configuration auditée');
select app.admin_update_reference('settings', 'trial_documents', '{"value":5}', :'admin');
select is(app.setting('trial_documents'), '5'::jsonb, 'réglage modifié');

select app.publish_plan('standard', 'XOF', '{"fr":"Firmo mensuel"}', 2500, 40, 30, :'admin') as plan2 \gset
select is((select version from public.plans where id = :'plan2'), 3, 'nouvelle version d''offre (après la v2 de la spec 011)');
select is((select count(*)::int from public.plans where code = 'standard' and currency_code = 'XOF' and active), 1, 'une seule version active');

select app.grant_period(:'org', 'standard', :'admin');
select is((select kind || '/' || quota from app.entitlement(:'org')), 'grant/40', 'accès offert avec la nouvelle offre');

select app.set_org_status(:'org', 'suspended', :'admin');
select throws_ok(format('select app.create_draft(%L, %L, %L)', :'org', 'quote', '[]'), '42501', null, 'organisation suspendue : plus de brouillon');

select throws_ok($$ select app.grant_staff_by_email('inconnu@example.test', 'support', null) $$, 'P0002', null, 'compte inconnu refusé');

select * from finish();
