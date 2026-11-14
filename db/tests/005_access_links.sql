-- Liens à usage unique (ART-1).
select plan(6);

select tests.new_org('chat-links') as org \gset

select ok(app.create_access_link(:'org', sha256('jeton-1'), 'portal', '/app') > now(), 'lien créé avec expiration');
select is((select org_id from app.consume_access_link(sha256('jeton-1'))), :'org'::uuid, 'échange du lien');
select throws_ok($$ select * from app.consume_access_link(sha256('jeton-1')) $$, 'P0002', null, 'un lien ne sert qu''une fois');

select app.create_access_link(:'org', sha256('jeton-2'), 'form:profile');
update public.access_links set expires_at = now() - interval '1 minute' where token_hash = sha256('jeton-2');
select throws_ok($$ select * from app.consume_access_link(sha256('jeton-2')) $$, 'P0002', null, 'lien expiré refusé');

select app.create_access_link(:'org', sha256('jeton-3'), 'portal');
update public.organizations set status = 'suspended' where id = :'org';
select throws_ok($$ select * from app.consume_access_link(sha256('jeton-3')) $$, '42501', null, 'organisation suspendue refusée');

select throws_ok(
  format('select app.create_access_link(%L, sha256(%L), %L)', :'org', 'j4', 'admin'),
  '23514', null, 'objet de lien inconnu refusé');

select * from finish();
