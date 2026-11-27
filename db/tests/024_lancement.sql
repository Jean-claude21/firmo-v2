-- Lancement en Afrique (spec 015, migrations 0019 et 0020) : pays proposés, mention de TVA,
-- changement de numéro, aucun suivi des paiements des clients.
select plan(16);

-- Pays : l'Europe reste en base mais n'est plus proposée.
select is((select count(*)::int from public.countries where code in ('FR', 'BE') and active), 0, 'France et Belgique non proposées');
select ok((select active from public.countries where code = 'TG'), 'Togo proposé');

-- Mention de TVA : imprimée pour un artisan non assujetti, jamais pour un assujetti.
select tests.ready_org('lan-tva') as org \gset
update public.organizations set tax_registered = false, locale = 'fr' where id = :'org';
select is(app.issuer_snapshot(:'org') ->> 'tax_mention', 'Non assujetti à la TVA', 'mention pour un non-assujetti');
update public.organizations set locale = 'en' where id = :'org';
select is(app.issuer_snapshot(:'org') ->> 'tax_mention', 'Not registered for VAT', 'mention dans la langue du document');
update public.organizations set tax_registered = true where id = :'org';
select is(app.issuer_snapshot(:'org') ->> 'tax_mention', null, 'aucune mention pour un assujetti');

-- Changement de numéro.
select tests.create_user('admin-lan@firmo.test') as admin \gset
insert into public.staff (user_id, email, role) values (:'admin', 'admin-lan@firmo.test', 'admin');
select tests.create_user('support-lan@firmo.test') as support \gset
insert into public.staff (user_id, email, role) values (:'support', 'support-lan@firmo.test', 'support');
select tests.ready_org('lan-old', '+22890000001') as old \gset
select app.create_draft(:'old', 'quote', jsonb_build_array(tests.line('A', 1, 100))) as olddoc \gset
select tests.new_org('lan-new', '+22890000002') as neworg \gset
select id as ident from public.channel_identities where org_id = :'neworg' \gset

select throws_ok(format('select app.move_identity(%L, %L, %L, %L)', :'support', :'ident', :'old', 'même artisan, vérifié'), '42501', null, 'réservé aux administrateurs');
select throws_ok(format('select app.move_identity(%L, %L, %L, %L)', :'admin', :'ident', :'old', 'ok'), '22023', null, 'motif obligatoire');
select throws_ok(format('select app.move_identity(%L, %L, %L, %L)', :'admin', :'ident', :'neworg', 'même artisan, vérifié'), '22023', null, 'déjà dans cette organisation');

-- Un numéro qui a déjà des documents ne se fusionne jamais.
select tests.new_org('lan-busy', '+22890000003') as busy \gset
select app.create_draft(:'busy', 'quote', jsonb_build_array(tests.line('B', 1, 100))) as busydoc \gset
select id as busyident from public.channel_identities where org_id = :'busy' \gset
select throws_ok(format('select app.move_identity(%L, %L, %L, %L)', :'admin', :'busyident', :'old', 'même artisan, vérifié'), '22023', null, 'refusé si le nouveau numéro a des documents');

select lives_ok(format('select app.move_identity(%L, %L, %L, %L)', :'admin', :'ident', :'old', 'même artisan, vérifié par appel'), 'rattachement accepté');
select is((select org_id from public.channel_identities where id = :'ident'), :'old'::uuid, 'le nouveau numéro rejoint l''organisation d''origine');
select is((select count(*)::int from public.organizations where id = :'neworg'), 0, 'l''organisation vide disparaît');
select is((select count(*)::int from public.documents where org_id = :'old'), 1, 'les documents de l''artisan restent');
select is((select after ->> 'reason' from public.audit_log where action = 'move_identity' and entity_id = :'ident'), 'même artisan, vérifié par appel', 'motif au journal');

-- Aucun paiement client noté, aucun reçu (0020).
select throws_ok(format('select app.record_payment(%L, %L, 100)', :'old', :'olddoc'), '42501', null, 'aucun paiement client noté');
select is((select count(*)::int from public.document_types where code = 'receipt' and active), 0, 'le reçu n''est plus proposé');

select * from finish();
