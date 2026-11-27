-- Mesure et données au niveau de la v1 (spec 014, PARITE_V1 §7).
select plan(20);

select tests.ready_org('data1') as org \gset
select tests.create_user('admin-data1@firmo.test') as admin \gset
insert into public.staff (user_id, email, role) values (:'admin', 'admin-data1@firmo.test', 'admin');
select identity_id as ident from app.ensure_identity('simulator', 'data1', null, null, null) \gset

-- P-81 : médias sources supprimés après la durée réglée.
insert into public.messages (org_id, identity_id, channel, direction, kind, status, media_key, transcript, created_at)
values (:'org', :'ident', 'simulator', 'in', 'audio', 'processed', 'inbox/x/old.ogg', 'deux portes à 45000', now() - interval '40 days')
returning id as old_msg \gset
insert into public.messages (org_id, identity_id, channel, direction, kind, status, media_key, created_at)
values (:'org', :'ident', 'simulator', 'in', 'image', 'processed', 'inbox/x/recent.jpg', now() - interval '2 days')
returning id as new_msg \gset
select ok(exists (select 1 from app.media_to_purge(1000) where message_id = :'old_msg'), 'P-81 média de plus de 30 jours à supprimer');
select ok(not exists (select 1 from app.media_to_purge(1000) where message_id = :'new_msg'), 'P-81 média récent gardé');
select is(app.mark_media_purged(array[:'old_msg'::uuid]), 1, 'média marqué supprimé');
select is((select media_key || '|' || coalesce(transcript, '') from public.messages where id = :'old_msg'), null, 'la référence du fichier part');
select is((select transcript from public.messages where id = :'old_msg'), 'deux portes à 45000', 'P-81 le texte lu reste');
select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'settings', 'media_retention_days', '{"value":0}', :'admin'), '22023', null, 'durée de rétention bornée');

-- P-80 : relais sans donnée personnelle.
select app.emit('document_issued', :'org', '{"doc_type":"quote","lines":3,"client_name":"Hôtel du Lac","phone":"+228900","total_minor":185000}');
select ok((select props from app.analytics_batch(100000) where name = 'document_issued' and org_id = :'org' order by id desc limit 1) = '{"doc_type":"quote","lines":3}'::jsonb,
  'P-80 seules les propriétés techniques connues sont relayées (ni nom, ni téléphone, ni prix)');
select app.mark_forwarded(array(select id from app.analytics_batch(100000) where org_id = :'org'));
select ok(not exists (select 1 from app.analytics_batch(100000) where org_id = :'org'), 'événements relayés une seule fois');

-- P-83 : suppression sur demande.
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Porte', 1, 50000))) as issued_doc \gset
select app.set_document_client(:'org', :'issued_doc', 'Hôtel du Lac', '{}'::jsonb);
select app.issue_document(:'org', :'issued_doc');
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Fenêtre', 1, 30000))) as draft_doc \gset
insert into public.clients (org_id, name) values (:'org', 'Client sans document');
select app.save_clause(:'org', null, '{"body":"Acompte 30 %"}');
update public.organizations set phone = '+22890000000', email = 'atelier@example.test', logo_key = 'brand/x/logo.png' where id = :'org';
select app.request_data(:'org', :'ident', 'deletion', 'chat') as req \gset
select throws_ok(format('select app.execute_deletion(%L, %L, %L)', :'admin', :'req', ''), '22023', null, 'P-83 motif obligatoire');
select app.execute_deletion(:'admin', :'req', 'demande vérifiée depuis le même numéro') as result \gset
select is((:'result'::jsonb ->> 'logo_key'), 'brand/x/logo.png', 'le logo est à effacer du stockage');
select ok((:'result'::jsonb -> 'media_keys') ? 'inbox/x/recent.jpg', 'les médias sont à effacer du stockage');
select is((select count(*)::int from public.messages where org_id = :'org'), 0, 'P-83 conversations supprimées');
select is((select count(*)::int from public.channel_identities where org_id = :'org'), 0, 'P-83 identités supprimées');
select is((select count(*)::int from public.documents where id = :'draft_doc'), 0, 'P-83 brouillons supprimés');
select is((select count(*)::int from public.clients where org_id = :'org' and name = 'Client sans document'), 0, 'P-83 clients sans document supprimés');
select is((select count(*)::int from public.clauses where org_id = :'org'), 0, 'clauses supprimées');
select is((select coalesce(name, '') || coalesce(phone, '') || coalesce(email, '') || coalesce(logo_key, '') || status from public.organizations where id = :'org'), 'deleted', 'P-83 présentation effacée, organisation « deleted »');
select is((select status from public.documents where id = :'issued_doc'), 'issued', 'P-83 document émis conservé (obligation légale)');
select is((select status from public.data_requests where id = :'req'), 'done', 'demande traitée');
select throws_ok(format('select app.execute_deletion(%L, %L, %L)', :'admin', :'req', 'deuxième passage'), '22023', null, 'une demande ne s''exécute qu''une fois');

select * from finish();
