-- Rendus des documents (DOC-5).
select plan(4);

select tests.ready_org('rnd') as org \gset
select app.create_draft(:'org', 'quote', jsonb_build_array(tests.line('A', 1, 1000))) as doc \gset
select is((app.latest_render(:'doc')).id, null, 'pas de rendu pour un brouillon');
select app.issue_document(:'org', :'doc');

select app.record_render(:'doc', 1, 'a.pdf', 'a.png', 'a.svg', repeat('a', 64), 1, 100, 20) as r1 \gset
select is(app.record_render(:'doc', 1, 'b.pdf', 'b.png', 'b.svg', repeat('b', 64), 1, 100, 20), :'r1'::uuid, 'tâche rejouée : même rendu');
select is((app.latest_render(:'doc')).pdf_key, 'a.pdf', 'rendu courant');
select throws_ok(
  format('select app.record_render(%L, 2, %L, %L, %L, %L, 1, 100, 20)', :'doc', 'x', 'x', 'x', 'pas-un-hash'),
  '23514', null, 'empreinte invalide refusée');

select * from finish();
