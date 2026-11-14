-- 0005 — File de traitement et liens à usage unique (spec 001).

-- File de tâches du worker (décision 0005). Réclamation par `FOR UPDATE SKIP LOCKED`.
create table public.jobs (
  id bigint generated always as identity primary key,
  kind text not null check (kind ~ '^[a-z_]+$'),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  -- Évite deux tâches identiques (ex. un même message reçu deux fois).
  dedupe_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready on public.jobs (run_at) where status = 'pending';
create index jobs_running on public.jobs (locked_at) where status = 'running';
create trigger jobs_updated_at before update on public.jobs
  for each row execute function app.set_updated_at();
alter table public.jobs enable row level security;

create or replace function app.enqueue_job(
  p_kind text, p_payload jsonb, p_dedupe_key text default null, p_run_at timestamptz default now()
) returns bigint
language plpgsql
as $$
declare
  v_id bigint;
begin
  insert into public.jobs (kind, payload, dedupe_key, run_at)
  values (p_kind, coalesce(p_payload, '{}'), p_dedupe_key, coalesce(p_run_at, now()))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform pg_notify('firmo_jobs', p_kind);
  end if;
  return v_id;
end
$$;

-- Réclame jusqu'à `p_limit` tâches prêtes. Une tâche « running » abandonnée depuis plus de
-- `p_stale_seconds` (processus tué) est reprise.
create or replace function app.claim_jobs(p_worker text, p_limit integer, p_stale_seconds integer default 900)
returns setof public.jobs
language plpgsql
as $$
begin
  return query
  with ready as (
    select j.id from public.jobs j
    where (j.status = 'pending' and j.run_at <= now())
       or (j.status = 'running' and j.locked_at < now() - make_interval(secs => p_stale_seconds))
    order by j.run_at, j.id
    limit greatest(p_limit, 0)
    for update skip locked
  )
  update public.jobs j
  set status = 'running', attempts = j.attempts + 1, locked_at = now(), locked_by = p_worker
  from ready
  where j.id = ready.id
  returning j.*;
end
$$;

create or replace function app.complete_job(p_id bigint) returns void
language sql
as $$
  update public.jobs set status = 'done', locked_at = null, last_error = null where id = p_id
$$;

-- Échec : nouvelle tentative avec délai croissant (10 s, 40 s, 90 s…), sinon « failed ».
-- `p_retry` faux : erreur définitive (entrée invalide), pas de nouvelle tentative.
create or replace function app.fail_job(p_id bigint, p_error text, p_retry boolean default true)
returns text
language plpgsql
as $$
declare
  v_status text;
begin
  update public.jobs j
  set status = case when p_retry and j.attempts < j.max_attempts then 'pending' else 'failed' end,
      run_at = now() + make_interval(secs => 10 * j.attempts * j.attempts),
      locked_at = null,
      last_error = left(p_error, 2000)
  where j.id = p_id
  returning j.status into v_status;
  return v_status;
end
$$;

-- Relance manuelle d'une tâche échouée (console d'administration).
create or replace function app.retry_job(p_id bigint, p_actor uuid) returns void
language plpgsql
as $$
begin
  update public.jobs set status = 'pending', run_at = now(), attempts = 0, last_error = null
  where id = p_id and status = 'failed';
  if not found then
    raise exception 'tâche introuvable ou non échouée' using errcode = 'P0002';
  end if;
  perform app.audit('staff', p_actor::text, 'retry_job', 'job', p_id::text, null, null);
  perform pg_notify('firmo_jobs', 'retry');
end
$$;

-- Liens à usage unique envoyés dans le chat (ART-1, CH-4). Seule l'empreinte SHA-256 du
-- jeton est stockée ; le jeton est généré par l'API.
create table public.access_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  token_hash bytea not null unique check (length(token_hash) = 32),
  -- « portal » (espace artisan) ou « form:<nom> » (formulaire depuis le chat).
  purpose text not null check (purpose ~ '^(portal|form:[a-z_]+)$'),
  -- Page à ouvrir après l'échange (ex. /app/documents/<id>).
  target text check (target is null or target ~ '^/[A-Za-z0-9/_\-]*$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index access_links_org on public.access_links (org_id, created_at desc);
alter table public.access_links enable row level security;

create or replace function app.create_access_link(
  p_org uuid, p_token_hash bytea, p_purpose text, p_target text default null
) returns timestamptz
language plpgsql
as $$
declare
  v_expires timestamptz := now() + make_interval(mins => (app.setting('portal_link_minutes') #>> '{}')::int);
begin
  insert into public.access_links (org_id, token_hash, purpose, target, expires_at)
  values (p_org, p_token_hash, p_purpose, p_target, v_expires);
  return v_expires;
end
$$;

-- Échange un lien : une seule fois, avant expiration, organisation active.
create or replace function app.consume_access_link(p_token_hash bytea)
returns table (org_id uuid, purpose text, target text)
language plpgsql
as $$
declare
  v_link public.access_links;
begin
  update public.access_links l set used_at = now()
  where l.token_hash = p_token_hash and l.used_at is null and l.expires_at > now()
  returning * into v_link;
  if not found then
    raise exception 'lien invalide, expiré ou déjà utilisé' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.organizations o where o.id = v_link.org_id and o.status = 'active') then
    raise exception 'organisation suspendue' using errcode = '42501';
  end if;
  perform app.emit('portal_opened', v_link.org_id, jsonb_build_object('purpose', split_part(v_link.purpose, ':', 1)));
  return query select v_link.org_id, v_link.purpose, v_link.target;
end
$$;
