-- Émission : blocages, numérotation sans trou, figeage, quota d'essai (DOC-5, OFF-1, OFF-2).
select plan(17);

select tests.new_org('iss') as org \gset

-- Prix manquant et nom d'entreprise manquant : refus explicite, rien n'est consommé.
select app.create_draft(:'org', 'quote', jsonb_build_array(
  jsonb_build_object('label', 'Grille', 'quantity', 2, 'unit', 'unit', 'to_confirm', '["quantity"]'::jsonb, 'source', 'read'),
  tests.line('Peinture', 1, 5000)
)) as doc \gset
select is(app.issue_blockers(:'org', :'doc'), array['missing_price', 'missing_business_name'], 'ce qui manque est listé');
select throws_ok(format('select app.issue_document(%L, %L)', :'org', :'doc'), 'P0001', null, 'émission refusée tant qu''il manque un prix');

update public.organizations set name = 'Soudure Kossi' where id = :'org';
select app.patch_line(:'org', :'doc', 1, '{"unit_price_minor": 25000}');
select is((select count(*)::int from public.analytics_events where name = 'reading_corrected' and org_id = :'org'), 1, 'valeur lue corrigée : mesurée');

select (app.issue_document(:'org', :'doc')).number as num \gset
select is(:'num', 'DEV-' || extract(year from current_date)::int || '-001', 'premier numéro du devis');
select is((select status from public.documents where id = :'doc'), 'issued', 'document émis');
select is((select to_confirm from public.document_lines where document_id = :'doc' and position = 1), '{}'::text[], 'valeurs confirmées à l''émission');
select is((select issuer_snapshot ->> 'name' from public.documents where id = :'doc'), 'Soudure Kossi', 'en-tête figé');
select is((select used from app.entitlement(:'org')), 1, 'une unité consommée');
select ok(exists (select 1 from public.jobs where dedupe_key = 'render:' || :'doc' || ':1'), 'rendu demandé');
select ok(exists (select 1 from public.memory_items where org_id = :'org' and label = 'Grille'), 'désignation mémorisée');

-- Immuabilité.
select throws_ok(format('select app.patch_line(%L, %L, 1, %L)', :'org', :'doc', '{"unit_price_minor": 1}'),
  '42501', null, 'un document émis ne se corrige pas');
select throws_ok(format('update public.documents set total_minor = 1 where id = %L', :'doc'),
  '42501', null, 'garde : montant figé même en SQL direct');

-- Numérotation par type : la facture commence à 1, le devis suivant à 2.
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('A', 1, 100))) as d2 \gset
select app.create_draft(:'org', 'invoice', jsonb_build_array(tests.line('B', 1, 100))) as d3 \gset
select is((app.issue_document(:'org', :'d3')).number, 'FAC-' || extract(year from current_date)::int || '-001', 'facture n°1');
select is((app.issue_document(:'org', :'d2')).number, 'DEV-' || extract(year from current_date)::int || '-002', 'devis n°2, sans trou');

-- Quota d'essai (3) épuisé.
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('C', 1, 100))) as d4 \gset
select throws_ok(format('select app.issue_document(%L, %L)', :'org', :'d4'), 'P0001', 'quota épuisé', 'quota d''essai épuisé');
select is((select number from public.documents where id = :'d4'), null, 'aucun numéro consommé par un refus');
select is((select count(*)::int from public.analytics_events where name = 'quota_warning' and org_id = :'org'), 1, 'avertissement à 80 % émis une fois');

select * from finish();
