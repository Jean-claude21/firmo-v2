-- 0017 — Administration au niveau de la v1 (spec 013, PARITE_V1 §6).

-- ---------------------------------------------------------------- P-74 journal en ajout seul

-- Le journal d'audit ne se modifie ni ne s'efface, pas même par un administrateur.
create or replace function app.audit_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'le journal d''audit ne se modifie pas' using errcode = '42501';
end
$$;
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function app.audit_append_only();

-- Motif d'une action sensible : obligatoire, au moins 5 caractères utiles.
create or replace function app.require_reason(p_reason text) returns text
language plpgsql immutable
as $$
begin
  if p_reason is null or length(btrim(p_reason)) < 5 then
    raise exception 'motif obligatoire' using errcode = '22023', hint = 'reason_required';
  end if;
  return btrim(p_reason);
end
$$;

-- ---------------------------------------------------------------- P-75 durées réglables, bornées

insert into public.settings (key, value, description) values
  ('admin_link_minutes', '10', 'Durée d''un lien d''administration envoyé dans le chat (minutes, usage unique).'),
  ('price_reveal_minutes', '15', 'Durée pendant laquelle un membre de l''équipe voit les montants d''une organisation après avoir donné un motif.')
on conflict (key) do nothing;

create or replace function app.check_setting() returns trigger
language plpgsql
as $$
declare
  v_bounds jsonb := '{
    "portal_link_minutes": [5, 1440], "admin_link_minutes": [2, 60], "org_session_days": [1, 90],
    "staff_session_hours": [1, 72], "price_reveal_minutes": [1, 120], "subscription_warn_days": [0, 30],
    "trial_documents": [0, 100], "quota_warning_percent": [50, 99]
  }';
  v_n numeric;
begin
  if v_bounds ? new.key then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'valeur numérique attendue pour %', new.key using errcode = '22023';
    end if;
    v_n := (new.value #>> '{}')::numeric;
    if v_n <> trunc(v_n) or v_n < (v_bounds -> new.key ->> 0)::numeric or v_n > (v_bounds -> new.key ->> 1)::numeric then
      raise exception '% doit être un entier entre % et %', new.key, v_bounds -> new.key ->> 0, v_bounds -> new.key ->> 1 using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;
create trigger settings_bounds before insert or update on public.settings
  for each row execute function app.check_setting();

-- ---------------------------------------------------------------- P-74 montants sur motif

-- Les prix d'un artisan sont sa position de négociation : l'équipe ne les voit pas par défaut.
-- Les afficher demande un motif, journalisé, valable quelques minutes pour une organisation.
create table public.price_reveals (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null,
  org_id uuid not null references public.organizations (id) on delete cascade,
  reason text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index price_reveals_lookup on public.price_reveals (staff_user_id, org_id, expires_at desc);
alter table public.price_reveals enable row level security;

create or replace function app.reveal_prices(p_staff uuid, p_org uuid, p_reason text) returns timestamptz
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_until timestamptz := now() + make_interval(mins => coalesce((app.setting('price_reveal_minutes') #>> '{}')::int, 15));
begin
  perform app.require_staff(p_staff, false);
  if not exists (select 1 from public.organizations where id = p_org) then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;
  insert into public.price_reveals (staff_user_id, org_id, reason, expires_at) values (p_staff, p_org, v_reason, v_until);
  perform app.audit('staff', p_staff::text, 'reveal_prices', 'organization', p_org::text, null,
    jsonb_build_object('reason', v_reason, 'until', v_until));
  return v_until;
end
$$;

create or replace function app.prices_revealed(p_staff uuid, p_org uuid) returns timestamptz
language sql stable
as $$
  select max(expires_at) from public.price_reveals
  where staff_user_id = p_staff and org_id = p_org and expires_at > now()
$$;

-- ---------------------------------------------------------------- P-72, P-74 actions sensibles

-- Suspension ou réactivation : motif obligatoire.
drop function app.set_org_status(uuid, text, uuid);
create or replace function app.set_org_status(p_org uuid, p_status text, p_actor uuid, p_reason text) returns void
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_before text;
begin
  perform app.require_staff(p_actor, true);
  select status into v_before from public.organizations where id = p_org for update;
  if v_before is null then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;
  update public.organizations set status = p_status where id = p_org;
  perform app.audit('staff', p_actor::text, 'set_org_status', 'organization', p_org::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status, 'reason', v_reason));
end
$$;

-- Réinitialiser le quota de la période en cours (action exceptionnelle, auditée).
create or replace function app.reset_quota(p_org uuid, p_actor uuid, p_reason text) returns void
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_sub public.subscriptions;
begin
  perform app.require_staff(p_actor, true);
  select * into v_sub from public.subscriptions where id = (app.current_subscription(p_org)).id for update;
  if v_sub.id is null then
    raise exception 'aucune période en cours' using errcode = 'P0002';
  end if;
  update public.subscriptions set used = 0, warned = false where id = v_sub.id;
  perform app.audit('staff', p_actor::text, 'reset_quota', 'subscription', v_sub.id::text,
    jsonb_build_object('used', v_sub.used, 'quota', v_sub.quota), jsonb_build_object('used', 0, 'reason', v_reason));
end
$$;

-- Accès offert : motif obligatoire.
drop function app.grant_period(uuid, text, uuid);
create or replace function app.grant_period(p_org uuid, p_plan_code text, p_actor uuid, p_reason text) returns uuid
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_plan uuid;
  v_sub uuid;
begin
  perform app.require_staff(p_actor, true);
  select p.id into v_plan from public.plans p join public.organizations o on o.currency_code = p.currency_code
  where o.id = p_org and p.code = p_plan_code and p.active;
  if v_plan is null then
    raise exception 'offre introuvable pour cette organisation' using errcode = 'P0002';
  end if;
  v_sub := app.start_paid_period(p_org, v_plan, 'grant');
  perform app.audit('staff', p_actor::text, 'grant_period', 'subscription', v_sub::text, null,
    jsonb_build_object('plan_code', p_plan_code, 'reason', v_reason));
  return v_sub;
end
$$;

-- ---------------------------------------------------------------- P-71 incidents

-- Un incident est un message dont le traitement a échoué, ou une tâche échouée. On le clôt avec
-- une note ; il reste lisible.
create table public.incident_resolutions (
  subject_type text not null check (subject_type in ('message', 'job')),
  subject_id text not null,
  staff_user_id uuid not null,
  note text,
  resolved_at timestamptz not null default now(),
  primary key (subject_type, subject_id)
);
alter table public.incident_resolutions enable row level security;

create or replace function app.resolve_incident(p_staff uuid, p_type text, p_id text, p_note text) returns void
language plpgsql
as $$
begin
  perform app.require_staff(p_staff, false);
  insert into public.incident_resolutions (subject_type, subject_id, staff_user_id, note)
  values (p_type, p_id, p_staff, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (subject_type, subject_id) do update set staff_user_id = excluded.staff_user_id, note = excluded.note, resolved_at = now();
  perform app.audit('staff', p_staff::text, 'resolve_incident', p_type, p_id, null, jsonb_build_object('note', p_note));
end
$$;

create or replace view app.open_incidents as
  select 'message'::text as subject_type, m.id::text as subject_id, m.org_id, m.channel, m.kind as stage,
         m.error, m.created_at
  from public.messages m
  where m.direction = 'in' and m.status = 'failed'
    and not exists (select 1 from public.incident_resolutions r where r.subject_type = 'message' and r.subject_id = m.id::text)
  union all
  select 'job', j.id::text, coalesce(o.id, (select org_id from public.messages where id::text = j.payload ->> 'message_id')), null, j.kind,
         j.last_error, j.updated_at
  from public.jobs j
  left join public.organizations o on o.id::text = j.payload ->> 'org_id'
  where j.status = 'failed'
    and not exists (select 1 from public.incident_resolutions r where r.subject_type = 'job' and r.subject_id = j.id::text);

-- ---------------------------------------------------------------- P-76 accès admin depuis le chat

-- Une identité de messagerie autorisée (celle d'un membre de l'équipe) obtient en écrivant ADMIN un
-- lien à usage unique, court (`admin_link_minutes`, 10 par défaut).
create table public.staff_identities (
  identity_id uuid primary key references public.channel_identities (id) on delete cascade,
  staff_user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.staff_identities enable row level security;

create table public.admin_links (
  token_hash bytea primary key check (length(token_hash) = 32),
  staff_user_id uuid not null,
  identity_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.admin_links enable row level security;

create or replace function app.authorize_staff_identity(p_actor uuid, p_staff_user uuid, p_identity uuid, p_allow boolean) returns void
language plpgsql
as $$
begin
  perform app.require_staff(p_actor, true);
  if not exists (select 1 from public.staff where user_id = p_staff_user) then
    raise exception 'membre introuvable' using errcode = 'P0002';
  end if;
  if p_allow then
    insert into public.staff_identities (identity_id, staff_user_id) values (p_identity, p_staff_user)
    on conflict (identity_id) do update set staff_user_id = excluded.staff_user_id;
  else
    delete from public.staff_identities where identity_id = p_identity and staff_user_id = p_staff_user;
  end if;
  perform app.audit('staff', p_actor::text, case when p_allow then 'authorize_identity' else 'revoke_identity' end,
    'channel_identity', p_identity::text, null, jsonb_build_object('staff_user_id', p_staff_user));
end
$$;

-- Lien d'administration pour une identité ; null si elle n'est pas autorisée (ou le membre retiré).
create or replace function app.create_admin_link(p_identity uuid, p_token_hash bytea) returns integer
language plpgsql
as $$
declare
  v_user uuid;
  v_minutes int := coalesce((app.setting('admin_link_minutes') #>> '{}')::int, 10);
begin
  select si.staff_user_id into v_user from public.staff_identities si join public.staff s on s.user_id = si.staff_user_id
  where si.identity_id = p_identity;
  if v_user is null then
    return null;
  end if;
  insert into public.admin_links (token_hash, staff_user_id, identity_id, expires_at)
  values (p_token_hash, v_user, p_identity, now() + make_interval(mins => v_minutes));
  perform app.audit('staff', v_user::text, 'admin_link_sent', 'channel_identity', p_identity::text, null, jsonb_build_object('minutes', v_minutes));
  return v_minutes;
end
$$;

create or replace function app.consume_admin_link(p_token_hash bytea) returns uuid
language plpgsql
as $$
declare
  v_link public.admin_links;
begin
  update public.admin_links set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning * into v_link;
  if not found then
    raise exception 'lien invalide, expiré ou déjà utilisé' using errcode = 'P0002', hint = 'link_invalid';
  end if;
  if not exists (select 1 from public.staff where user_id = v_link.staff_user_id) then
    raise exception 'membre retiré' using errcode = '42501';
  end if;
  perform app.audit('staff', v_link.staff_user_id::text, 'admin_link_used', 'channel_identity', v_link.identity_id::text, null, null);
  return v_link.staff_user_id;
end
$$;

-- ---------------------------------------------------------------- P-77 recherche globale

create or replace function app.admin_search(p_staff uuid, p_query text) returns jsonb
language plpgsql stable
as $$
declare
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
begin
  perform app.require_staff(p_staff, false);
  if length(v_q) < 2 then
    return jsonb_build_object('organizations', '[]'::jsonb, 'documents', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'organizations', coalesce((
      select jsonb_agg(x) from (
        select distinct on (o.id) jsonb_build_object('id', o.id, 'name', o.name, 'status', o.status, 'phone', coalesce(o.phone, ci.phone),
                      'match', case when lower(coalesce(o.name, '')) like '%' || v_q || '%' then 'name' else 'phone' end) as x
        from public.organizations o
        left join public.channel_identities ci on ci.org_id = o.id
        where lower(coalesce(o.name, '')) like '%' || v_q || '%'
           or (length(v_digits) >= 4 and (regexp_replace(coalesce(o.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
                                          or regexp_replace(coalesce(ci.phone, ''), '\D', '', 'g') like '%' || v_digits || '%'
                                          or ci.external_id like '%' || v_digits || '%'))
        order by o.id limit 10
      ) s), '[]'::jsonb),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'org_id', d.org_id, 'org_name', o.name, 'number', d.number, 'type', d.type_code, 'status', d.status))
      from (select * from public.documents where lower(coalesce(number, '')) like '%' || v_q || '%' order by created_at desc limit 10) d
      join public.organizations o on o.id = d.org_id), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------- P-78 pilotage

-- Entonnoir d'activation, coûts et échecs par étape, sur des agrégats réels.
create or replace function app.admin_pilotage(p_days integer default 30) returns jsonb
language sql stable
as $$
  with since as (select now() - make_interval(days => greatest(p_days, 1)) as t),
  orgs as (select e.org_id, e.created_at from public.analytics_events e, since where e.name = 'org_created' and e.created_at >= since.t),
  step as (
    select o.org_id,
           exists (select 1 from public.analytics_events x where x.org_id = o.org_id and x.name = 'reading_done') as read,
           exists (select 1 from public.analytics_events x where x.org_id = o.org_id and x.name = 'preview_sent') as previewed,
           exists (select 1 from public.analytics_events x where x.org_id = o.org_id and x.name = 'document_issued') as issued,
           exists (select 1 from public.analytics_events x where x.org_id = o.org_id and x.name = 'document_shared' and x.created_at <= o.created_at + interval '7 days') as shared7,
           exists (select 1 from public.analytics_events x where x.org_id = o.org_id and x.name = 'subscription_paid') as paid
    from orgs o
  )
  select jsonb_build_object(
    'days', p_days,
    'funnel', jsonb_build_object(
      'created', (select count(*) from step),
      'read', (select count(*) from step where read),
      'previewed', (select count(*) from step where previewed),
      'issued', (select count(*) from step where issued),
      'shared7', (select count(*) from step where shared7),
      'paid', (select count(*) from step where paid)),
    'ai_by_task', coalesce((select jsonb_agg(jsonb_build_object('task', task, 'calls', calls, 'failed', failed, 'cost_micro_usd', cost, 'p95_ms', p95) order by calls desc)
      from (select task, count(*) as calls, count(*) filter (where not ok) as failed, coalesce(sum(cost_micro_usd), 0) as cost,
                   percentile_disc(0.95) within group (order by duration_ms) as p95
            from public.ai_usage, since where created_at >= since.t group by task) a), '[]'),
    'failures_by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', stage, 'count', n) order by n desc)
      from (select coalesce(kind, '?') as stage, count(*) as n from public.messages, since
            where direction = 'in' and status = 'failed' and created_at >= since.t group by kind) f), '[]'),
    'jobs_failed_by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'count', n) order by n desc)
      from (select kind, count(*) as n from public.jobs, since where status = 'failed' and updated_at >= since.t group by kind) j), '[]'),
    'cost_per_document_micro_usd', (select case when count(d.*) = 0 then null else round((select coalesce(sum(cost_micro_usd), 0) from public.ai_usage, since where created_at >= since.t)::numeric / count(d.*)) end
      from public.documents d, since where d.issued_at >= since.t and d.type_code <> 'receipt'),
    'render_p95_ms', (select percentile_disc(0.95) within group (order by duration_ms) from public.document_renders, since where created_at >= since.t)
  )
$$;
