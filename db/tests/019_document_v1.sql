-- Parité v1 du document (spec 009, PARITE_V1.md §1) : sections, lignes forfaitaires et
-- descriptives, ajustements ordonnés à base explicite, champs latents, valeurs par défaut, clauses
-- figées, numérotation configurable, numéro manuel, révision /R2, conversion, duplication,
-- consultations, « sans réponse », mémoire des postes.
select plan(45);

select tests.ready_org('v1') as org \gset
update public.organizations set default_validity_days = 15, default_delivery_text = '21 jours après acompte',
  default_warranty_text = '24 mois sur les soudures', default_deposit_bp = 3000, trade_label = 'Chaudronnerie - Soudure'
where id = :'org';
select app.save_clause(:'org', null, '{"body":"Acompte de 30 % à la commande.","is_default":true}') as c1 \gset
select app.save_clause(:'org', null, '{"body":"Clause rarement utilisée."}') as c2 \gset

-- ---------------------------------------------------------------- cas 03 : sections + % + forfait
select app.create_draft_content(:'org', 'quote', $${
  "title": "Portail et garde-corps d'une villa",
  "summary": "Fabrication, transport et pose compris.",
  "site": "Adidogomé, Lomé",
  "sections": [
    {"title": "Portail coulissant", "show_subtotal": true, "lines": [
      {"label": "Tube rectangulaire 80 x 40", "quantity": 12, "unit": "barre", "unit_price_minor": 18000},
      {"label": "Tôle noire 20/10", "quantity": 4, "unit": "feuille", "unit_price_minor": 32000}]},
    {"title": "Garde-corps", "show_subtotal": true, "lines": [
      {"label": "Tube carré 40 x 40", "quantity": 8, "unit": "barre", "unit_price_minor": 15000},
      {"label": "Peinture antirouille", "quantity": 2, "unit": "boîte", "unit_price_minor": 18000}]}],
  "adjustments": [
    {"label": "Main-d'œuvre", "mode": "percent", "rate_bp": 2500, "base": "items_total"},
    {"label": "Transport et pose", "mode": "amount", "value_minor": 30000}]
}$$::jsonb, 'web') as d3 \gset

select is((select array_agg(subtotal_minor order by position) from public.document_sections where document_id = :'d3'),
  array[344000, 156000]::bigint[], 'P-01 sous-totaux de section');
select is((select subtotal_minor from public.documents where id = :'d3'), 500000::bigint, 'P-04 total des postes');
select is((select adjustments_total_minor from public.documents where id = :'d3'), 155000::bigint, 'P-03 main-d''œuvre 25 % + transport');
select is((select total_minor from public.documents where id = :'d3'), 655000::bigint, 'P-04 total général 655 000');
select is((select deposit_minor from public.documents where id = :'d3'), 196500::bigint, 'P-06 acompte par défaut 30 % = 196 500');
select is((select validity_days || '/' || delivery_text || '/' || warranty_text from public.documents where id = :'d3'),
  '15/21 jours après acompte/24 mois sur les soudures', 'P-06 valeurs par défaut reposées');
select is((select string_agg(body, '|') from public.document_clauses where document_id = :'d3'),
  'Acompte de 30 % à la commande.', 'P-07 seules les clauses par défaut sont posées');
select is((select array_agg(position order by position) from public.document_lines where document_id = :'d3'),
  array[1,2,3,4], 'positions continues sur tout le document');
select is((select mode || ':' || rate_bp from public.document_adjustments where document_id = :'d3' and position = 1),
  'percent:2500', 'P-03 le mode pourcentage est conservé tel quel');

-- ---------------------------------------------------------------- forfait, texte, base section, base taxable
select app.create_draft_content(:'org', 'quote', $${
  "sections": [
    {"title": "Structure", "lines": [
      {"label": "Ferraillage poteaux et poutres", "kind": "flat", "flat_amount_minor": 1250000},
      {"label": "Le béton est fourni par le client", "kind": "text"},
      {"label": "Coffrage traditionnel", "quantity": 180, "unit": "m²", "unit_price_minor": 8500,
       "description": "Bois de coffrage compris"}]},
    {"lines": [{"label": "Nettoyage", "quantity": 1, "unit_price_minor": 50000}]}],
  "adjustments": [
    {"label": "Imprévus structure", "mode": "percent", "rate_bp": 1000, "base": "section", "section": 1},
    {"label": "Remise", "mode": "percent", "sign": -1, "rate_bp": 1000, "base": "taxable_base"}]
}$$::jsonb, 'web') as d4 \gset
select is((select line_total_minor from public.document_lines where document_id = :'d4' and position = 1), 1250000::bigint, 'P-02 ligne forfaitaire');
select is((select line_total_minor from public.document_lines where document_id = :'d4' and position = 2), null::bigint, 'P-02 ligne descriptive non calculée');
select is((select description from public.document_lines where document_id = :'d4' and position = 3), 'Bois de coffrage compris', 'P-02 description de ligne');
select is((select show_subtotal from public.document_sections where document_id = :'d4' and position = 2), false, 'P-01 section sans titre : pas de sous-total par défaut');
-- Structure : 1 250 000 + 1 530 000 = 2 780 000 ; imprévus 10 % = 278 000 ; base taxable 3 108 000 ; remise 10 % = 310 800.
select is((select amount_minor from public.document_adjustments where document_id = :'d4' and position = 1), 278000::bigint, 'P-03 base section');
select is((select amount_minor from public.document_adjustments where document_id = :'d4' and position = 2), -310800::bigint, 'P-03 base taxable cumulée');
select is((select total_minor from public.documents where id = :'d4'), 2797200::bigint, 'P-04 ordre déterministe');
select is(app.issue_blockers(:'org', :'d4'), '{}'::text[], 'une ligne descriptive ne bloque pas');

-- Pourcentage au-delà de 100 %.
select app.add_adjustment(:'org', :'d4', '{"label":"Majoration","mode":"percent","rate_bp":15000,"base":"items_total"}');
select is((select amount_minor from public.document_adjustments where document_id = :'d4' and position = 3), 4245000::bigint, 'P-03 150 % admis');
select app.remove_adjustment(:'org', :'d4', 3);

-- Valeur manquante : bloque, puis corrigée.
select app.add_adjustment(:'org', :'d4', '{"label":"Transport","mode":"amount"}');
select ok('missing_adjustment' = any(app.issue_blockers(:'org', :'d4')), 'P-17 ajustement sans valeur bloque');
select app.patch_adjustment(:'org', :'d4', 3, '{"value_minor":25000}');
select is(app.issue_blockers(:'org', :'d4'), '{}'::text[], 'valeur donnée : plus de blocage');

-- Retirer la dernière ligne d'une section retire la section.
select app.remove_line(:'org', :'d4', 4);
select is((select count(*)::int from public.document_sections where document_id = :'d4'), 1, 'section vide retirée');

-- ---------------------------------------------------------------- numérotation configurable
select is(app.preview_number(:'org', 'quote'), 'DEV-' || extract(year from current_date)::int || '-001', 'P-08 aperçu du numéro par défaut');
select (app.issue_document(:'org', :'d3')).number as n3 \gset
select is(:'n3'::text, 'DEV-' || extract(year from current_date)::int || '-001', 'P-08 premier numéro DEV-AAAA-001');
select app.set_numbering(:'org', 'quote', '{"prefix":"D","separator":"/","include_year":false,"width":5,"cadence":"continuous"}');
select (app.issue_document(:'org', :'d4')).number as n4 \gset
select is(:'n4'::text, 'D/00002', 'P-08 nouveau format, le compteur ne repart pas de zéro');
select is((select count(*)::int from public.audit_log where action = 'set_numbering' and actor_id = :'org'), 1, 'changement de format audité');

-- Clauses figées à l'émission.
select app.save_clause(:'org', :'c1', '{"body":"Acompte de 50 % à la commande."}');
select is((select body from public.document_clauses where document_id = :'d3'), 'Acompte de 30 % à la commande.', 'P-07 clause figée après émission');
select throws_ok(format('select app.set_document_clauses(%L, %L, %L)', :'org', :'d3', '[]'), '42501', null, 'P-13 clauses d''un document émis immuables');
select throws_ok(format('update public.document_sections set title = %L where document_id = %L', 'X', :'d3'), '42501', null, 'P-13 sections d''un document émis immuables');
select throws_ok(format('update public.document_adjustments set rate_bp = 1 where document_id = %L', :'d3'), '42501', null, 'P-13 ajustements d''un document émis immuables');
select is((select issuer_snapshot ->> 'trade' from public.documents where id = :'d3'), 'Chaudronnerie - Soudure', 'P-13 métier libre figé dans l''entête');
select isnt((select template_version from public.documents where id = :'d3'), null, 'P-13 version du gabarit figée');

-- ---------------------------------------------------------------- numéro manuel
select app.create_draft(:'org', 'invoice', jsonb_build_array(tests.line('Portail', 1, 100000))) as inv \gset
select throws_ok(format('select app.issue_document(%L, %L, %L)', :'org', :'inv', 'avec espace'), '22023', null, 'P-09 numéro invalide refusé');
select throws_ok(format('select app.issue_document(%L, %L, %L)', :'org', :'inv', :'n3'), '23505', null, 'P-09 numéro déjà utilisé refusé');
select is((app.issue_document(:'org', :'inv', 'FAC-MAIRIE-7')).number, 'FAC-MAIRIE-7', 'P-09 numéro manuel');
select is((select count(*)::int from public.audit_log where action = 'manual_number' and entity_id = :'inv'), 1, 'P-09 numéro manuel audité');

-- ---------------------------------------------------------------- révision /R2, /R3
select app.revise_document(:'org', :'d3') as r2 \gset
select is((app.issue_document(:'org', :'r2')).number, :'n3' || '/R2', 'P-10 révision numérotée /R2');
select app.revise_document(:'org', :'r2') as r3 \gset
select is((app.issue_document(:'org', :'r3')).number, :'n3' || '/R3', 'P-10 révision suivante /R3');
select is((select total_minor from public.documents where id = :'r3'), 655000::bigint, 'P-10 contenu repris à l''identique');
select is((select count(*)::int from public.document_clauses where document_id = :'r3'), 1, 'P-10 clauses reprises');

-- ---------------------------------------------------------------- conversion, duplication
select app.convert_document(:'org', :'r3', 'proforma') as pro \gset
select is((select type_code || ':' || source_document_id from public.documents where id = :'pro'), 'proforma:' || :'r3', 'P-11 devis → proforma lié');
select is((select count(*)::int from public.document_sections where document_id = :'pro'), 2, 'P-11 sections reprises');
select app.duplicate_document(:'org', :'r3') as dup \gset
select is((select status || ':' || coalesce(source_document_id::text, '-') || ':' || total_minor from public.documents where id = :'dup'),
  'draft:-:655000', 'P-12 duplication : brouillon indépendant');

-- ---------------------------------------------------------------- consultations, sans réponse
select app.share_document(:'org', :'r3', sha256('v1-share'));
select app.document_by_share(sha256('v1-share'));
select app.document_by_share(sha256('v1-share'));
select is((select view_count from public.document_views where document_id = :'r3'), 2, 'P-14 compteur d''ouvertures');
select app.decide_document(:'org', :'r3', 'no_response');
select is((select status from public.documents where id = :'r3'), 'no_response', 'P-15 sans réponse');

-- ---------------------------------------------------------------- mémoire
select is((select last_price_minor || ' ' || unit from public.memory_items where org_id = :'org' and label = 'Tôle noire 20/10'),
  '32000 feuille', 'P-43 dernier prix constaté et unité mémorisés');

select * from finish();
