-- Référentiels (spec 001, constitution IV).
select plan(8);

select ok((select count(*) from public.countries where active) >= 10, 'des pays actifs existent');
select is_empty(
  $$ select c.code from public.countries c left join public.currencies cu on cu.code = c.currency_code where cu.code is null $$,
  'chaque pays a une devise connue');
select is((select minor_units from public.currencies where code = 'XOF'), 0::smallint, 'le franc CFA n''a pas de décimales');
select is(app.country_from_phone('+228 90 00 00 00'), 'TG'::char(2), 'préfixe 228 → Togo');
select is(app.country_from_phone('0033612345678'), 'FR'::char(2), 'préfixe 33 → France');
select is(app.country_from_phone('+1 555'), null, 'préfixe inconnu → aucun pays');
select throws_ok(
  $$ insert into public.trades (code, labels) values ('x', '{"fr":""}') $$,
  '23514', null, 'un libellé vide est refusé');
select is(app.label('{"fr":"Devis","en":"Quote"}', 'en-GB'), 'Quote', 'libellé dans la langue demandée');

select * from finish();
