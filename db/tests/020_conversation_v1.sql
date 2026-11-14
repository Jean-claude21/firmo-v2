-- Conversation v1 (spec 010) : demandes sur les données (P-42), statistiques du chat.
select plan(7);

select tests.ready_org('conv') as org \gset
select id as ident from public.channel_identities where org_id = :'org' limit 1 \gset

select app.request_data(:'org', :'ident', 'deletion', 'chat') as r1 \gset
select is(app.request_data(:'org', :'ident', 'deletion', 'chat'), :'r1'::uuid, 'une seule demande de suppression en attente');
select is((select status || '/' || origin from public.data_requests where id = :'r1'), 'pending/chat', 'demande enregistrée');
select is((select count(*)::int from public.audit_log where action = 'data_request' and entity_id = :'r1'::text), 1, 'demande journalisée');
select is((select count(*)::int from public.analytics_events where name = 'data_deletion_requested' and org_id = :'org'), 1, 'événement émis');
select throws_ok(format('select app.request_data(%L, null, %L, %L)', :'org', 'oubli', 'chat'), '23514', null, 'type de demande contrôlé');

select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Portail', 1, 100000))) as d1 \gset
select app.issue_document(:'org', :'d1');
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Grille', 2, 5000)));
select is(app.org_chat_stats(:'org'), '{"drafts": 1, "issued": 1, "quotes": 1, "invoices": 0, "accepted": 0}'::jsonb, 'statistiques du chat');

select ok((select relrowsecurity from pg_class where relname = 'data_requests'), 'RLS activé sur data_requests');

select * from finish();
