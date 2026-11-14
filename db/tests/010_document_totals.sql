-- Totaux, remise, taxe, arrondis (DOC-4).
select plan(12);

select tests.ready_org('tot') as org \gset

select app.create_draft(:'org', 'quote', jsonb_build_array(
  tests.line('Tôle 2 mm', 3, 15000),
  tests.line('Main d''œuvre', 1.5, 10000, 'day')
)) as doc \gset

select is((select subtotal_minor from public.documents where id = :'doc'), 60000::bigint, 'sous-total = 3×15000 + 1,5×10000');
select is((select total_minor from public.documents where id = :'doc'), 60000::bigint, 'sans taxe ni remise : total = sous-total');
select is((select line_total_minor from public.document_lines where document_id = :'doc' and position = 2), 15000::bigint, 'quantité décimale');

select app.update_draft(:'org', :'doc', '{"discount_bp": 1000}');
select is((select discount_total_minor from public.documents where id = :'doc'), 6000::bigint, 'remise 10 %');
select is((select total_minor from public.documents where id = :'doc'), 54000::bigint, 'total après remise');

select app.update_draft(:'org', :'doc', '{"discount_minor": 70000}');
select is((select discount_total_minor from public.documents where id = :'doc'), 60000::bigint, 'remise plafonnée au sous-total');
select is((select discount_bp from public.documents where id = :'doc'), null, 'une remise en montant remplace le pourcentage');

select throws_ok(format('select app.update_draft(%L, %L, %L)', :'org', :'doc', '{"discount_bp": 500, "discount_minor": 100}'),
  '22023', null, 'pourcentage et montant ensemble refusés');

-- Organisation assujettie : taxe par défaut du pays (Togo 18 %).
update public.organizations set tax_registered = true where id = :'org';
select app.create_draft(:'org', 'invoice', jsonb_build_array(tests.line('Portail', 1, 333333))) as inv \gset
select is((select tax_rate_bp from public.documents where id = :'inv'), 1800, 'taux de taxe du pays');
select is((select tax_minor from public.documents where id = :'inv'), 60000::bigint, 'taxe arrondie : 333333 × 18 % = 59999,94 → 60000');
select is((select total_minor from public.documents where id = :'inv'), 393333::bigint, 'total TTC');

select app.update_draft(:'org', :'inv', '{"apply_tax": false}');
select is((select total_minor from public.documents where id = :'inv'), 333333::bigint, 'taxe retirée par l''artisan');

select * from finish();
