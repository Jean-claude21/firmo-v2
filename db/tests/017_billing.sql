-- Paiement de l'abonnement (OFF-3).
select plan(10);

select tests.ready_org('bill') as org \gset

select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 'k-1') \gset p_
select is(:p_amount_minor::bigint, 2000::bigint, 'montant pris de l''offre (XOF)');
select is((app.start_subscription_payment(:'org', 'standard', 'simulator', 'k-1')).id, :'p_id'::uuid, 'même clé d''idempotence : même paiement');
select throws_ok(format('select app.start_subscription_payment(%L, %L, %L, %L)', :'org', 'standard', 'moneroo', 'k-2'), '22023', null, 'fournisseur inactif refusé');
select throws_ok(format('select app.start_subscription_payment(%L, %L, %L, %L)', :'org', 'inexistant', 'simulator', 'k-3'), 'P0002', null, 'offre inconnue refusée');

select is(app.settle_subscription_payment('simulator', 'e-1', :'p_id', 'succeeded', 1000, 'XOF'), 'mismatch', 'montant incohérent refusé');
select is((select status from public.subscription_payments where id = :'p_id'), 'failed', 'paiement incohérent marqué échoué');

select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 'k-4') \gset q_
select is(app.settle_subscription_payment('simulator', 'e-2', :'q_id', 'succeeded', 2000, 'xof'), 'applied', 'paiement réglé');
select is((select kind || '/' || quota from app.entitlement(:'org')), 'paid/15', 'période payée ouverte (offre v1 : 15 documents)');
select is(app.settle_subscription_payment('simulator', 'e-2', :'q_id', 'succeeded', 2000, 'XOF'), 'duplicate', 'événement rejoué ignoré');
select is((select count(*)::int from public.analytics_events where name = 'subscription_paid' and org_id = :'org'), 1, 'subscription_paid émis une fois');

select * from finish();
