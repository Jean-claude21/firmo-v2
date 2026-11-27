-- Offre au niveau de la v1 (spec 011, PARITE_V1 §4) : versions, recharges, grâce, conditions de fin,
-- file de confirmation, rapprochement.
select plan(37);

select tests.ready_org('off') as org \gset
select tests.create_user('admin-off@firmo.test') as admin \gset
insert into public.staff (user_id, email, role) values (:'admin', 'admin-off@firmo.test', 'admin');
select tests.create_user('support-off@firmo.test') as support \gset
insert into public.staff (user_id, email, role) values (:'support', 'support-off@firmo.test', 'support');

-- P-50, P-51 : essai de 3 documents, puis 2 000 F CFA pour 15 documents (décision v1 du 2026-08-17).
select is((select kind || '/' || quota from app.entitlement(:'org')), 'trial/3', 'P-50 essai de 3 documents');
select is((select price_minor || '/' || quota || '/' || top_up_documents || '/' || grace_days from public.plans
           where code = 'standard' and currency_code = 'XOF' and active),
  '2000/15/10/3', 'P-51 offre active : 2 000 pour 15 documents, recharge de 10, grâce de 3 jours');
select is((select provider_products ->> 'chariow' from public.plans where code = 'standard' and currency_code = 'XOF' and active),
  'prd_s1bcdqkm', 'P-56 produit Chariow de la v1');
select is((select count(*)::int from public.plans where code = 'standard' and currency_code = 'XOF'), 2, 'P-54 l''ancienne version est gardée');

-- P-55 : une correction ne consomme rien ; une révision non plus ; une conversion émise, un document.
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Porte', 1, 50000))) as q1 \gset
select app.set_lines(:'org', :'q1', jsonb_build_array(tests.line('Porte', 2, 50000)));
select is((select used from app.entitlement(:'org')), 0, 'P-55 correction du brouillon : rien consommé');
select app.issue_document(:'org', :'q1');
select is((select used from app.entitlement(:'org')), 1, 'émission : 1 document');
select app.revise_document(:'org', :'q1') as q1r \gset
select app.issue_document(:'org', :'q1r');
select is((select used from app.entitlement(:'org')), 1, 'P-55 révision émise : rien consommé');
select app.convert_document(:'org', :'q1r', 'invoice') as inv \gset
select app.issue_document(:'org', :'inv');
select is((select used from app.entitlement(:'org')), 2, 'P-55 conversion émise : 1 document');

-- Recharge impossible pendant l'essai.
select throws_ok(format('select app.start_subscription_payment(%L, %L, %L, %L, %L)', :'org', 'standard', 'simulator', 't-0', 'top_up'),
  '42501', null, 'P-52 recharge réservée à un abonnement en cours');

select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 's-1') \gset p_
select app.settle_subscription_payment('simulator', 'ev-s1', :'p_id', 'succeeded', 2000, 'XOF');
select is((select kind || '/' || quota from app.entitlement(:'org')), 'paid/15', 'P-54 période payée selon la version active');

-- P-57 : la confirmation part dans la file, avec le paiement ; une seule fois.
select is((select count(*)::int from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = :'p_id'), 1,
  'P-57 message de confirmation mis en file avec le paiement');
select is(app.settle_subscription_payment('simulator', 'ev-s1-bis', :'p_id', 'succeeded', 2000, 'XOF'), 'already_settled', 'avis répété : déjà réglé');
select is((select count(*)::int from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = :'p_id'), 1,
  'P-57 pas de second message');
select app.fail_job((select id from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = :'p_id'), 'canal en panne', true);
select is((select status from public.subscription_payments where id = :'p_id'), 'succeeded', 'P-57 le paiement reste acquis si le message échoue');
select is((select status from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = :'p_id'), 'pending', 'P-57 message repris plus tard');

-- Conditions de fin : rappels programmés à la création de la période.
select id as sub from public.subscriptions where org_id = :'org' and kind = 'paid' \gset
select is((select array_agg(dedupe_key order by run_at) from public.jobs where kind = 'subscription_notice' and payload ->> 'subscription_id' = :'sub'),
  array['period_notice:' || :'sub' || ':ending:3', 'period_notice:' || :'sub' || ':ending:1',
        'period_notice:' || :'sub' || ':ended', 'period_notice:' || :'sub' || ':closed'],
  'rappels : 3 jours avant, la veille, à la fin, à la fin de la grâce');
select ok((select run_at = s.period_end + interval '3 days' from public.jobs j, public.subscriptions s
           where s.id = :'sub' and j.dedupe_key = 'period_notice:' || :'sub' || ':closed'), 'fin de grâce : 3 jours après la fin');
select is((select send from app.period_notice(:'sub')), true, 'rappel envoyé tant que rien n''est renouvelé');

-- Recharge sans prix fixé : non proposée (aucun prix inventé).
select throws_ok(format('select app.start_subscription_payment(%L, %L, %L, %L, %L)', :'org', 'standard', 'simulator', 't-1', 'top_up'),
  'P0002', null, 'P-52 recharge sans prix : non proposée');

-- Prix fixé dans la console : recharge de 10 documents.
update public.plans set top_up_price_minor = 1000 where code = 'standard' and currency_code = 'XOF' and active;
select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 't-2', 'top_up') \gset t_
select is(:t_amount_minor::bigint || '/' || :'t_units', '1000/10', 'P-52 recharge au prix et à la taille de l''offre');
select is(app.settle_subscription_payment('simulator', 'ev-t2', :'t_id', 'succeeded', 1000, 'XOF'), 'applied', 'recharge réglée');
select is((select quota from app.entitlement(:'org')), 25, 'P-52 10 documents ajoutés à la période en cours');
select is((select count(*)::int from public.subscriptions where org_id = :'org' and kind = 'paid'), 1, 'P-54 aucune période réécrite ni ajoutée');
select is((select count(*)::int from public.analytics_events where name = 'top_up_paid' and org_id = :'org'), 1, 'top_up_paid émis');
select is((select payload ->> 'kind' from public.jobs where kind = 'notify_subscription' and payload ->> 'payment_id' = :'t_id'), 'top_up',
  'P-57 confirmation de recharge en file');

-- Renouvellement anticipé : la période suivante coupe les rappels de la première.
select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 's-renew') \gset n_
select app.settle_subscription_payment('simulator', 'ev-renew', :'n_id', 'succeeded', 2000, 'XOF');
select is((select send from app.period_notice(:'sub')), false, 'renouvelé : plus de rappel pour la période précédente');
update public.subscriptions set ended_at = now() where id = (select subscription_id from public.subscription_payments where id = :'n_id');

-- P-54 : période de grâce.
update public.subscriptions set period_start = now() - interval '40 days', period_end = now() - interval '2 days'
where id = :'sub';
select is((select kind from app.entitlement(:'org')), 'paid', 'P-54 grâce de 3 jours : encore active 2 jours après la fin');
select throws_ok(format('select app.start_subscription_payment(%L, %L, %L, %L, %L)', :'org', 'standard', 'simulator', 't-3', 'top_up'),
  '42501', null, 'pendant la grâce : se réabonner, pas recharger');
update public.subscriptions set period_end = now() - interval '4 days' where id = :'sub';
select is((select count(*)::int from app.entitlement(:'org')), 0, 'P-54 grâce passée : plus de droit');
select throws_ok(format('select app.consume_unit(%L)', :'org'), 'P0001', null, 'grâce passée : aucun document final');

-- Console : une nouvelle version reprend recharge, grâce et produits.
select app.publish_plan('standard', 'XOF', '{"fr":"Firmo mensuel"}', 2000, 20, 30, :'admin') as v3 \gset
select is((select version || '/' || quota || '/' || top_up_documents || '/' || top_up_price_minor || '/' || grace_days || '/' || (provider_products ->> 'chariow')
           from public.plans where id = :'v3'), '3/20/10/1000/3/prd_s1bcdqkm', 'P-54 version 3 : reprend recharge, grâce et produit');
select app.publish_plan('standard', 'XOF', '{"fr":"Firmo mensuel"}', 2000, 20, 30, :'admin', 0, 5, 800, '{}') as v4 \gset
select is((select grace_days || '/' || top_up_documents || '/' || top_up_price_minor || '/' || provider_products::text from public.plans where id = :'v4'),
  '0/5/800/{}', 'version 4 : valeurs données');
select throws_ok(format('select app.publish_plan(%L, %L, %L, 1, 1, 30, %L)', 'standard', 'XOF', '{"fr":"x"}', :'support'),
  '42501', null, 'publication réservée aux administrateurs');

-- P-56 : rapprochement par l'équipe, motif obligatoire, une seule fois.
select * from app.start_subscription_payment(:'org', 'standard', 'simulator', 's-2') \gset r_
select throws_ok(format('select app.reconcile_payment(%L, %L, %L, 2000, %L, %L)', :'support', :'r_id', 'succeeded', 'XOF', 'vu chez le fournisseur'),
  '42501', null, 'P-56 rapprochement réservé aux administrateurs');
select throws_ok(format('select app.reconcile_payment(%L, %L, %L, 2000, %L, %L)', :'admin', :'r_id', 'succeeded', 'XOF', ' '),
  '22023', null, 'P-56 motif obligatoire');
select is(app.reconcile_payment(:'admin', :'r_id', 'succeeded', 2000, 'XOF', 'vente vue chez le fournisseur, avis jamais reçu')
  || '/' || app.reconcile_payment(:'admin', :'r_id', 'succeeded', 2000, 'XOF', 'deuxième essai'), 'applied/duplicate', 'P-56 appliqué une seule fois');
select is((select count(*)::int from public.audit_log where action = 'reconcile_payment' and entity_id = :'r_id'), 2, 'P-56 chaque rapprochement journalisé');

select * from finish();
