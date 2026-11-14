-- Cycle : révision, conversion, partage, décision du client, paiements, reçus (DOC-6, ART-7).
select plan(21);

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

-- Paiements notés.
select throws_ok(format('select app.record_payment(%L, %L, 100000)', :'org', :'inv'), '22023', null, 'paiement supérieur au reste refusé');
select app.record_payment(:'org', :'inv', 40000, current_date, 'Mobile Money') as p1 \gset
select is((select status from public.documents where id = :'inv'), 'partially_paid', 'acompte');
select app.record_payment(:'org', :'inv', 50000) as p2 \gset
select is((select status || '/' || paid_minor from public.documents where id = :'inv'), 'paid/90000', 'soldée');
select throws_ok(format('select app.cancel_document(%L, %L)', :'org', :'inv'), '42501', null, 'une facture payée ne s''annule pas');

-- Reçu.
select app.issue_receipt(:'org', :'p1') as rec \gset
select is((select number from public.documents where id = :'rec'), 'REC-' || extract(year from current_date)::int || '-001', 'reçu numéroté');
select is((select total_minor from public.documents where id = :'rec'), 40000::bigint, 'montant du reçu');
select is(app.issue_receipt(:'org', :'p1'), :'rec'::uuid, 'un seul reçu par paiement');
select is((select used from app.entitlement(:'org')), 2, 'reçu sans consommation (devis + facture seulement)');

select * from finish();
