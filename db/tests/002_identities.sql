-- Organisation créée en silence au premier message (CH-2).
select plan(9);

select tests.new_org('chat-1', '+22890112233') as org \gset

select is((select country_code from public.organizations where id = :'org'), 'TG'::char(2), 'pays déduit du numéro');
select is((select currency_code from public.organizations where id = :'org'), 'XOF'::char(3), 'devise du pays');
select is((select count(*)::int from public.analytics_events where name = 'org_created' and org_id = :'org'), 1, 'org_created émis');

select is(
  (select org_id from app.ensure_identity('simulator', 'chat-1', 'Autre nom', null, null)),
  :'org'::uuid, 'deuxième message : même organisation');
select is((select created from app.ensure_identity('simulator', 'chat-1', null, null, null)), false, 'pas de création au deuxième message');
select is((select count(*)::int from public.channel_identities where channel = 'simulator' and external_id = 'chat-1'), 1, 'une seule identité, donc une seule organisation');
select is((select display_name from public.channel_identities where external_id = 'chat-1'), 'Autre nom', 'nom affiché mis à jour');

select tests.new_org('chat-2', '+999') as org2 \gset
select is((select country_code from public.organizations where id = :'org2'),
  'TG'::char(2), 'numéro inconnu → pays par défaut');

select throws_ok(
  $$ select * from app.ensure_identity('whatsapp', 'x', null, null, null) $$,
  '22023', null, 'canal inactif refusé');

select * from finish();
