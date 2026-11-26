-- Administration au niveau de la v1 (spec 013, PARITE_V1 §6).
select plan(29);

select tests.ready_org('adm1') as org \gset
select tests.create_user('admin-adm1@firmo.test') as admin \gset
insert into public.staff (user_id, email, role) values (:'admin', 'admin-adm1@firmo.test', 'admin');
select tests.create_user('support-adm1@firmo.test') as support \gset
insert into public.staff (user_id, email, role) values (:'support', 'support-adm1@firmo.test', 'support');

-- P-74 : journal en ajout seul.
select app.audit('staff', :'admin', 'test', 'organization', :'org', null, null);
select throws_ok($$ update public.audit_log set action = 'x' $$, '42501', null, 'P-74 le journal ne se modifie pas');
select throws_ok($$ delete from public.audit_log $$, '42501', null, 'P-74 le journal ne s''efface pas');

-- P-74 : motif obligatoire pour les actions sensibles.
select throws_ok(format('select app.set_org_status(%L, %L, %L, %L)', :'org', 'suspended', :'admin', 'ok'), '22023', null, 'P-74 suspension sans motif refusée');
select throws_ok(format('select app.set_org_status(%L, %L, %L, %L)', :'org', 'suspended', :'support', 'motif valable ici'), '42501', null, 'suspension réservée aux administrateurs');
select app.set_org_status(:'org', 'suspended', :'admin', 'paiement frauduleux signalé');
select is((select after ->> 'reason' from public.audit_log where action = 'set_org_status' and entity_id = :'org' order by id desc limit 1), 'paiement frauduleux signalé', 'P-74 le motif est au journal');
select app.set_org_status(:'org', 'active', :'admin', 'vérification faite, réactivé');

-- P-72 : réinitialiser le quota (exceptionnel, audité).
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Porte', 1, 50000))) as d1 \gset
select app.issue_document(:'org', :'d1');
select is((select used from app.entitlement(:'org')), 1, 'un document utilisé');
select throws_ok(format('select app.reset_quota(%L, %L, %L)', :'org', :'admin', ''), '22023', null, 'réinitialisation sans motif refusée');
select app.reset_quota(:'org', :'admin', 'document émis par erreur de l''équipe');
select is((select used from app.entitlement(:'org')), 0, 'P-72 quota réinitialisé');
select is((select (before ->> 'used')::int from public.audit_log where action = 'reset_quota' order by id desc limit 1), 1, 'avant et après au journal');

-- P-74 : montants visibles seulement sur motif, pour un temps.
select is(app.prices_revealed(:'support', :'org'), null, 'P-74 montants masqués par défaut');
select throws_ok(format('select app.reveal_prices(%L, %L, %L)', :'support', :'org', 'vu'), '22023', null, 'affichage sans motif refusé');
select ok(app.reveal_prices(:'support', :'org', 'litige signalé par le client de l''artisan') > now(), 'P-74 montants affichés sur motif');
select ok(app.prices_revealed(:'support', :'org') > now(), 'affichage actif pour ce membre et cette organisation');
select is(app.prices_revealed(:'admin', :'org'), null, 'pas pour un autre membre');
update public.price_reveals set expires_at = now() - interval '1 minute';
select is(app.prices_revealed(:'support', :'org'), null, 'affichage terminé après la durée');
select is((select count(*)::int from public.audit_log where action = 'reveal_prices' and entity_id = :'org'), 1, 'affichage journalisé');

-- P-75 : durées réglables, bornées.
select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'settings', 'admin_link_minutes', '{"value":500}', :'admin'), '22023', null, 'P-75 durée hors bornes refusée');
select throws_ok(format('select app.admin_update_reference(%L, %L, %L, %L)', 'settings', 'portal_link_minutes', '{"value":"long"}', :'admin'), '22023', null, 'P-75 valeur non numérique refusée');
select app.admin_update_reference('settings', 'portal_link_minutes', '{"value":30}', :'admin');
select is(app.setting('portal_link_minutes'), '30'::jsonb, 'P-75 durée des liens client modifiée');

-- P-76 : accès admin depuis le chat, identité autorisée seulement, usage unique.
select identity_id as ident from app.ensure_identity('simulator', 'staff-phone-1', 'Kossi', '+22890998877', null) \gset
select is(app.create_admin_link(:'ident', sha256('adm-0')), null, 'P-76 identité non autorisée : pas de lien');
select throws_ok(format('select app.authorize_staff_identity(%L, %L, %L, true)', :'support', :'support', :'ident'), '42501', null, 'autorisation réservée aux administrateurs');
select app.authorize_staff_identity(:'admin', :'admin', :'ident', true);
select is(app.create_admin_link(:'ident', sha256('adm-1')), 10, 'P-76 lien de 10 minutes pour une identité autorisée');
select is(app.consume_admin_link(sha256('adm-1')), :'admin'::uuid, 'le lien ouvre une session du bon membre');
select throws_ok($$ select app.consume_admin_link(sha256('adm-1')) $$, 'P0002', null, 'P-76 usage unique');
select app.create_admin_link(:'ident', sha256('adm-2'));
update public.admin_links set expires_at = now() - interval '1 minute' where token_hash = sha256('adm-2');
select throws_ok($$ select app.consume_admin_link(sha256('adm-2')) $$, 'P0002', null, 'lien expiré refusé');

-- P-71 : incidents ouverts, clos avec une note.
insert into public.messages (org_id, identity_id, channel, direction, kind, status, error)
select :'org', identity_id, 'simulator', 'in', 'audio', 'failed', 'transcription vide'
from app.ensure_identity('simulator', 'adm1', null, null, null) returning id as failed_msg \gset
select ok(exists (select 1 from app.open_incidents where subject_id = :'failed_msg'), 'P-71 message en échec : incident ouvert');
select app.resolve_incident(:'support', 'message', :'failed_msg', 'nouveau vocal demandé');
select ok(not exists (select 1 from app.open_incidents where subject_id = :'failed_msg'), 'P-71 incident clos');

-- P-77 : recherche par nom, téléphone, numéro de document.
select ok((app.admin_search(:'support', 'atelier adm1') -> 'organizations') @> jsonb_build_array(jsonb_build_object('id', :'org')), 'P-77 recherche par nom');
select ok((app.admin_search(:'support', (select number from public.documents where id = :'d1')) -> 'documents') @> jsonb_build_array(jsonb_build_object('id', :'d1')), 'P-77 recherche par numéro de document');

select * from finish();
