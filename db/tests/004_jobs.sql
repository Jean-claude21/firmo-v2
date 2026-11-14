-- File de traitement (décision 0005).
select plan(9);

select is(app.enqueue_job('demo', '{"a":1}', 'k1') is not null, true, 'tâche créée');
select is(app.enqueue_job('demo', '{"a":2}', 'k1'), null, 'clé de déduplication : pas de doublon');
select app.enqueue_job('later', '{}', null, now() + interval '1 hour');

select is((select count(*)::int from app.claim_jobs('w1', 10)), 1, 'seule la tâche prête est réclamée');
select is((select count(*)::int from app.claim_jobs('w2', 10)), 0, 'une tâche réclamée ne l''est pas deux fois');

select id as job from public.jobs where dedupe_key = 'k1' \gset
select is(app.fail_job(:job, 'boom'), 'pending', 'échec : nouvelle tentative prévue');
select ok((select run_at > now() from public.jobs where id = :job), 'délai avant la nouvelle tentative');
select is(app.fail_job(:job, 'entrée invalide', false), 'failed', 'erreur définitive : échouée');
select app.complete_job(:job);
select is((select status from public.jobs where id = :job), 'done', 'tâche terminée');

update public.jobs set status = 'running', locked_at = now() - interval '1 hour' where kind = 'later';
update public.jobs set run_at = now() where kind = 'later';
select is((select count(*)::int from app.claim_jobs('w3', 10, 900)), 1, 'tâche abandonnée reprise');

select * from finish();
