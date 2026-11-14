-- Espace artisan : profil, clients, tableau de bord (ART-2, ART-4, ART-5).
select plan(10);

select tests.ready_org('portal') as org \gset

select app.update_profile(:'org', '{"name":"Couture Afi","trade_code":"tailoring","brand_color":"#7A1F5C","legal_ids":{"rccm":"TG-LOM-1","nif":"","inconnu":"x"},"payment_methods":"Flooz 90 00 00 00"}');
select is((select name || '/' || trade_code || '/' || brand_color from public.organizations where id = :'org'), 'Couture Afi/tailoring/#7A1F5C', 'profil mis à jour');
select is((select legal_ids from public.organizations where id = :'org'), '{"rccm":"TG-LOM-1"}'::jsonb, 'identifiants légaux du pays seulement, vides retirés');
select ok(exists (select 1 from public.audit_log where action = 'update_profile' and entity_id = :'org'), 'modification auditée');
select throws_ok(format('select app.update_profile(%L, %L)', :'org', '{"plan":"gratuit"}'), '22023', null, 'champ inconnu refusé');
select throws_ok(format('select app.update_profile(%L, %L)', :'org', '{"brand_color":"rouge"}'), '23514', null, 'couleur invalide refusée');

-- Changer de pays avant tout document : devise suivie.
select app.update_profile(:'org', '{"country_code":"CM"}');
select is((select currency_code from public.organizations where id = :'org'), 'XAF'::char(3), 'devise du nouveau pays');
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('Robe', 1, 25000))) as d \gset
select app.issue_document(:'org', :'d');
select throws_ok(format('select app.update_profile(%L, %L)', :'org', '{"country_code":"TG"}'), '42501', null, 'pays verrouillé après émission');

select app.save_client(:'org', null, '{"name":"Mairie de Douala","phone":"+237600000000"}') as c \gset
select app.save_client(:'org', :'c', '{"email":"contact@mairie.test"}');
select is((select email from public.clients where id = :'c'), 'contact@mairie.test', 'client modifié');
select tests.ready_org('other-portal', '+22991000000') as other \gset
select throws_ok(format('select app.save_client(%L, %L, %L)', :'other', :'c', '{"name":"x"}'), 'P0002', null, 'client d''une autre organisation introuvable');

select is((app.org_dashboard(:'org') ->> 'quotes_pending')::int, 1, 'devis en attente au tableau de bord');

select * from finish();
