-- Conversation : messages idempotents, état, livraisons (CH-1, CH-5).
select plan(8);

select * from app.receive_message('simulator', 'ext-1', 'conv-1', 'Afi', '+22890000000', 'fr', 'text', 'bonjour', null, null) \gset r1_
select is(:'r1_duplicate'::boolean, false, 'premier message enregistré');
select ok(exists (select 1 from public.jobs where dedupe_key = 'msg:' || :'r1_message_id'), 'tâche de traitement créée');
select is((select count(*)::int from public.analytics_events where name = 'submission_received' and org_id = :'r1_org_id'), 1, 'submission_received émis');

select * from app.receive_message('simulator', 'ext-1', 'conv-1', 'Afi', '+22890000000', 'fr', 'text', 'bonjour', null, null) \gset r2_
select is(:'r2_duplicate'::boolean, true, 'message rejoué : doublon');
select is(:'r2_message_id'::uuid, :'r1_message_id'::uuid, 'même message');
select is((select count(*)::int from public.jobs where dedupe_key like 'msg:%' and payload ->> 'message_id' = :'r1_message_id'), 1, 'une seule tâche');

select app.set_conversation(:'r1_identity_id', null, 'business_name', 'issue');
select is((select awaiting || '/' || resume from public.conversation_states where identity_id = :'r1_identity_id'), 'business_name/issue', 'question en attente');
select app.set_conversation(:'r1_identity_id', null, null, null);
select is((select awaiting from public.conversation_states where identity_id = :'r1_identity_id'), null, 'question levée');

select * from finish();
