-- Essai et périodes payées (OFF-1).
select plan(7);

select tests.ready_org('off') as org \gset

select is((select kind || '/' || quota from app.entitlement(:'org')), 'trial/3', 'essai de 3 documents à la création');

select id as plan from public.plans where code = 'standard' and currency_code = 'XOF' and active \gset
select app.start_paid_period(:'org', :'plan');
select is((select kind || '/' || quota || '/' || used from app.entitlement(:'org')), 'paid/30/0', 'période payée : quota du plan');
select ok((select period_end > now() + interval '29 days' from app.entitlement(:'org')), 'période de 30 jours');
select ok((select ended_at is not null from public.subscriptions where org_id = :'org' and kind = 'trial'), 'essai terminé');

-- Renouvellement anticipé : la nouvelle période commence à la fin de l'actuelle.
select app.start_paid_period(:'org', :'plan');
select is((select count(*)::int from public.subscriptions where org_id = :'org' and kind = 'paid'), 2, 'deux périodes');
select is((select used from app.entitlement(:'org')), 0, 'la période en cours reste la première');

select id as eur from public.plans where currency_code = 'EUR' \gset
select throws_ok(format('select app.start_paid_period(%L, %L)', :'org', :'eur'), '22023', null, 'offre dans une autre devise refusée');

select * from finish();
