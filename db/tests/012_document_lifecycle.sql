-- Cycle : révision, conversion, partage, décision du client, sans suivi des paiements (DOC-6, ART-7).
select plan(17);

select tests.ready_org('cyc') as org \gset
select tests.ready_org('other', '+22991000000') as other \gset

select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Portail', 1, 100000))) as q \gset
select app.set_document_client(:'org', :'q', 'Hôtel du Lac', '{"phone":"+22890000001"}');
select app.issue_document(:'org', :'q');
select is((select client_snapshot ->> 'name' from public.documents where id = :'q'), 'Hôtel du Lac', 'client figé');

-- Autre organisation : aucun accès.
select throws_ok(format('select app.revise_document(%L, %L)', :'other', :'q'), 'P0002', null, 'document d''une autre organisation introuvable');

-- Révision : brouillon, puis remplace l'original sans consommer d'unité.
select app.revise_document(:'org', :'q') as r \gset
select is(app.revise_document(:'org', :'q'), :'r'::uuid, 'une seule révision en cours');
select app.patch_line(:'org', :'r', 1, '{"unit_price_minor": 90000}');
select app.issue_document(:'org', :'r');
select is((select status from public.documents where id = :'q'), 'replaced', 'original remplacé');
select is((select used from app.entitlement(:'org')), 1, 'la révision ne consomme pas d''unité');

-- Partage et décision du client.
select app.share_document(:'org', :'r', sha256('share-r'));
select app.mark_shared(:'org', :'r', 'chat');
select is(app.document_by_share(sha256('share-r')), :'r'::uuid, 'document public par jeton');
select is((select count(*)::int from public.analytics_events where name = 'document_viewed' and org_id = :'org'), 1, 'première vue mesurée');
select app.document_by_share(sha256('share-r'));
select is((select count(*)::int from public.analytics_events where name = 'document_viewed' and org_id = :'org'), 1, 'vue mesurée une seule fois');
select throws_ok($$ select app.document_by_share(sha256('faux')) $$, 'P0002', null, 'jeton inconnu refusé');
select app.client_decision(sha256('share-r'), 'accepted', 'OK pour lundi');
select is((select status || '/' || decision_by from public.documents where id = :'r'), 'accepted/client', 'accepté par le client');
select throws_ok($$ select app.client_decision(sha256('share-r'), 'refused') $$, '42501', null, 'décision déjà prise');

-- Conversion en facture.
select app.convert_document(:'org', :'r') as inv \gset
select is(app.convert_document(:'org', :'r'), :'inv'::uuid, 'une seule facture par devis');
select is((select total_minor from public.documents where id = :'inv'), 90000::bigint, 'montants repris');
select app.issue_document(:'org', :'inv');

-- Firmo ne note aucun paiement client et n'émet pas de reçu (0020) : l'artisan gère lui-même.
select throws_ok(format('select app.record_payment(%L, %L, 40000)', :'org', :'inv'), '42501', null, 'aucun paiement client noté');
select throws_ok(format('select app.issue_receipt(%L, gen_random_uuid())', :'org'), '42501', null, 'aucun reçu émis');
select is((select active from public.document_types where code = 'receipt'), false, 'type reçu retiré');
select is((select status || '/' || paid_minor from public.documents where id = :'inv'), 'issued/0', 'la facture reste émise, sans suivi d''encaissement');

select * from finish();
