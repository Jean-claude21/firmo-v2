-- Liens d'accès (ART-1), réutilisables pendant leur durée (P-68).
select plan(9);

select tests.new_org('chat-links') as org \gset

select ok(app.create_access_link(:'org', sha256('jeton-1'), 'portal', '/app') > now(), 'lien créé avec expiration');
select is((select org_id from app.consume_access_link(sha256('jeton-1'))), :'org'::uuid, 'échange du lien');
select is((select org_id from app.consume_access_link(sha256('jeton-1'))), :'org'::uuid, 'P-68 le lien se rouvre pendant sa durée');
select is((select uses from public.access_links where token_hash = sha256('jeton-1')), 2, 'deux ouvertures comptées');
select is((select count(*)::int from public.analytics_events where name = 'portal_opened' and org_id = :'org'), 1, 'portal_opened compté une fois par lien');

select app.create_access_link(:'org', sha256('jeton-2'), 'form:profile');
update public.access_links set expires_at = now() - interval '1 minute' where token_hash = sha256('jeton-2');
select throws_ok($$ select * from app.consume_access_link(sha256('jeton-2')) $$, 'P0002', 'lien expiré', 'lien expiré refusé, motif distinct');

select app.create_access_link(:'org', sha256('jeton-3'), 'portal');
update public.organizations set status = 'suspended' where id = :'org';
select throws_ok($$ select * from app.consume_access_link(sha256('jeton-3')) $$, '42501', null, 'organisation suspendue refusée');
select throws_ok($$ select * from app.consume_access_link(sha256('inconnu')) $$, 'P0002', 'lien inconnu', 'lien inconnu refusé');

select throws_ok(
  format('select app.create_access_link(%L, sha256(%L), %L)', :'org', 'j4', 'admin'),
  '23514', null, 'objet de lien inconnu refusé');

select * from finish();
