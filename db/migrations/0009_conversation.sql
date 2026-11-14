-- 0009 — Conversation (spec 004 : CH-1, CH-3, CH-5, DOC-1, DOC-2).

-- Journal brut des webhooks (constitution V) : corps tel que reçu, signature vérifiée ou non.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  source text not null check (source ~ '^[a-z_]+$'),
  signature_valid boolean not null,
  body text not null,
  error text,
  received_at timestamptz not null default now()
);
create index webhook_events_source on public.webhook_events (source, received_at desc);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  identity_id uuid not null references public.channel_identities (id) on delete cascade,
  channel text not null references public.channels (code),
  direction text not null check (direction in ('in', 'out')),
  -- Entrant : identifiant du message chez le canal (idempotence). Sortant : identifiant renvoyé.
  external_id text,
  kind text not null check (kind in ('text', 'audio', 'image', 'document', 'interactive', 'form')),
  text text check (text is null or length(text) <= 8000),
  -- Référence du média chez le canal (entrant) ; clé de stockage une fois téléchargé.
  media_ref text,
  media_key text,
  media_type text,
  transcript text,
  status text not null check (status in ('received', 'processing', 'processed', 'failed', 'queued', 'sent')),
  error text,
  document_id uuid references public.documents (id) on delete set null,
  -- Boutons proposés avec un message sortant : [{"id":"cmd:issue","title":"Émettre"}].
  buttons jsonb check (buttons is null or jsonb_typeof(buttons) = 'array'),
  duration_ms integer,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index messages_inbound_unique on public.messages (channel, external_id)
  where direction = 'in' and external_id is not null;
create index messages_identity on public.messages (identity_id, created_at desc);
create index messages_org on public.messages (org_id, created_at desc);
create index messages_failed on public.messages (created_at desc) where status = 'failed';

-- État de la conversation par identité : brouillon en cours, question en attente.
create table public.conversation_states (
  identity_id uuid primary key references public.channel_identities (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  -- Question posée : business_name, client_name… ; null : rien en attente.
  awaiting text check (awaiting is null or awaiting ~ '^[a-z_]+$'),
  -- Geste à reprendre après la réponse (ex. émettre après avoir eu le nom).
  resume text check (resume is null or resume ~ '^[a-z_]+$'),
  updated_at timestamptz not null default now()
);

-- Documents à remettre dans le chat dès que leur rendu est prêt.
create table public.document_deliveries (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  identity_id uuid not null references public.channel_identities (id) on delete cascade,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (document_id, identity_id)
);

-- Coûts et durées de l'IA par tâche (ADM-7, constitution IX).
create table public.ai_usage (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations (id) on delete set null,
  task text not null,
  model text not null,
  ok boolean not null,
  input_tokens integer,
  output_tokens integer,
  audio_seconds numeric(8, 2),
  cost_micro_usd bigint,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);
create index ai_usage_created on public.ai_usage (created_at desc);

alter table public.webhook_events enable row level security;
alter table public.messages enable row level security;
alter table public.conversation_states enable row level security;
alter table public.document_deliveries enable row level security;
alter table public.ai_usage enable row level security;

-- Message entrant : identité (et organisation) au besoin, message idempotent, tâche de traitement.
create or replace function app.receive_message(
  p_channel text, p_external_id text, p_from text, p_display_name text, p_phone text, p_locale text,
  p_kind text, p_text text, p_media_ref text, p_media_type text
) returns table (message_id uuid, org_id uuid, identity_id uuid, duplicate boolean)
language plpgsql
as $$
declare
  v_ident record;
  v_id uuid;
begin
  select * into v_ident from app.ensure_identity(p_channel, p_from, p_display_name, p_phone, p_locale);
  insert into public.messages (org_id, identity_id, channel, direction, external_id, kind, text, media_ref, media_type, status)
  values (v_ident.org_id, v_ident.identity_id, p_channel, 'in', p_external_id, p_kind, p_text, p_media_ref, p_media_type, 'received')
  on conflict (channel, external_id) where direction = 'in' and external_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return query
      select m.id, m.org_id, m.identity_id, true from public.messages m
      where m.channel = p_channel and m.external_id = p_external_id and m.direction = 'in';
    return;
  end if;
  perform app.enqueue_job('process_message', jsonb_build_object('message_id', v_id), 'msg:' || v_id);
  perform app.emit('submission_received', v_ident.org_id, jsonb_build_object('channel', p_channel, 'kind', p_kind));
  return query select v_id, v_ident.org_id, v_ident.identity_id, false;
end
$$;

create or replace function app.set_conversation(
  p_identity uuid, p_document uuid, p_awaiting text, p_resume text
) returns void
language sql
as $$
  insert into public.conversation_states (identity_id, org_id, document_id, awaiting, resume)
  select ci.id, ci.org_id, p_document, p_awaiting, p_resume from public.channel_identities ci where ci.id = p_identity
  on conflict (identity_id) do update set
    document_id = excluded.document_id, awaiting = excluded.awaiting, resume = excluded.resume, updated_at = now()
$$;

-- Lecture IA terminée (métrique de fidélité, DOC-1).
create or replace function app.record_reading(
  p_org uuid, p_kind text, p_lines integer, p_to_confirm integer, p_duration_ms integer, p_cost bigint
) returns void
language sql
as $$
  select app.emit('reading_done', p_org, jsonb_build_object(
    'kind', p_kind, 'lines', p_lines, 'to_confirm', p_to_confirm, 'duration_ms', p_duration_ms,
    'cost_micro_usd', coalesce(p_cost, 0)))
$$;
