-- 0004 — Organisations, identités de messagerie, équipe, audit, événements (spec 001 : CH-2, ADM-1).

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  -- Nom sous lequel partent les documents (demandé au premier document).
  name text check (name is null or length(btrim(name)) between 1 and 120),
  trade_code text references public.trades (code),
  country_code char(2) not null references public.countries (code),
  currency_code char(3) not null references public.currencies (code),
  locale text not null default 'fr' check (locale ~ '^[a-z]{2}$'),
  phone text check (phone is null or length(phone) <= 32),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text check (address is null or length(address) <= 300),
  -- {"rccm":"TG-LOM-...","nif":"..."} selon countries.legal_ids
  legal_ids jsonb not null default '{}' check (jsonb_typeof(legal_ids) = 'object'),
  tax_registered boolean not null default false,
  tax_code text,
  brand_color text not null default '#1F3A5F' check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_key text,
  template_code text not null default 'classic' references public.templates (code),
  -- Moyens de paiement imprimés : « Mobile Money 90 00 00 00 », « Espèces »…
  payment_methods text check (payment_methods is null or length(payment_methods) <= 400),
  footer_note text check (footer_note is null or length(footer_note) <= 400),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

create table public.channel_identities (
  id uuid primary key default gen_random_uuid(),
  channel text not null references public.channels (code),
  -- Identifiant fourni par le canal : numéro WhatsApp, id de chat Telegram…
  external_id text not null check (length(external_id) between 1 and 128),
  org_id uuid not null references public.organizations (id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 120),
  phone text,
  locale text check (locale is null or locale ~ '^[a-z]{2}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index channel_identities_org on public.channel_identities (org_id);

create table public.staff (
  -- Identifiant Neon Auth (neon_auth."user".id).
  user_id uuid primary key,
  email text not null,
  role text not null check (role in ('admin', 'support')),
  granted_by uuid,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('staff', 'org', 'system')),
  actor_id text,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_entity on public.audit_log (entity, entity_id, created_at desc);
create index audit_log_created on public.audit_log (created_at desc);

create table public.analytics_events (
  id bigint generated always as identity primary key,
  name text not null check (name ~ '^[a-z_]+$'),
  org_id uuid references public.organizations (id) on delete set null,
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object'),
  -- Relais PostHog : null tant que non envoyé.
  forwarded_at timestamptz,
  created_at timestamptz not null default now()
);
create index analytics_events_name on public.analytics_events (name, created_at desc);
create index analytics_events_org on public.analytics_events (org_id, created_at desc);
create index analytics_events_unforwarded on public.analytics_events (id) where forwarded_at is null;

alter table public.organizations enable row level security;
alter table public.channel_identities enable row level security;
alter table public.staff enable row level security;
alter table public.audit_log enable row level security;
alter table public.analytics_events enable row level security;

-- Journal d'audit (constitution V).
create or replace function app.audit(
  p_actor_type text, p_actor_id text, p_action text, p_entity text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null
) returns void
language sql
as $$
  insert into public.audit_log (actor_type, actor_id, action, entity, entity_id, before, after)
  values (p_actor_type, p_actor_id, p_action, p_entity, p_entity_id, p_before, p_after)
$$;

-- Événement produit (constitution IX) : aucune donnée personnelle dans `props`.
create or replace function app.emit(p_name text, p_org uuid, p_props jsonb default '{}') returns void
language sql
as $$
  insert into public.analytics_events (name, org_id, props) values (p_name, p_org, coalesce(p_props, '{}'))
$$;

-- Identité de messagerie → organisation. Crée l'organisation en silence au premier message
-- (CH-2). Idempotent sur (canal, identifiant).
create or replace function app.ensure_identity(
  p_channel text, p_external_id text, p_display_name text, p_phone text, p_locale text
) returns table (org_id uuid, identity_id uuid, created boolean)
language plpgsql
as $$
declare
  v_identity public.channel_identities;
  v_country public.countries;
  v_org uuid;
begin
  select * into v_identity from public.channel_identities ci
  where ci.channel = p_channel and ci.external_id = p_external_id;

  if found then
    update public.channel_identities ci
    set last_seen_at = now(),
        display_name = coalesce(p_display_name, ci.display_name),
        phone = coalesce(p_phone, ci.phone)
    where ci.id = v_identity.id;
    return query select v_identity.org_id, v_identity.id, false;
    return;
  end if;

  if not exists (select 1 from public.channels c where c.code = p_channel and c.enabled) then
    raise exception 'canal inactif : %', p_channel using errcode = '22023';
  end if;

  select * into v_country from public.countries c
  where c.code = coalesce(app.country_from_phone(p_phone), app.setting('default_country') #>> '{}');
  if not found then
    raise exception 'pays par défaut absent' using errcode = 'P0002';
  end if;

  insert into public.organizations (country_code, currency_code, locale)
  values (
    v_country.code,
    v_country.currency_code,
    coalesce(nullif(p_locale, ''), v_country.default_locale)
  )
  returning id into v_org;

  insert into public.channel_identities (channel, external_id, org_id, display_name, phone, locale)
  values (p_channel, p_external_id, v_org, p_display_name, p_phone, nullif(p_locale, ''))
  on conflict (channel, external_id) do nothing
  returning id into v_identity.id;

  if v_identity.id is null then
    -- Course : une autre transaction a créé l'identité entre-temps.
    delete from public.organizations o where o.id = v_org;
    return query
      select ci.org_id, ci.id, false from public.channel_identities ci
      where ci.channel = p_channel and ci.external_id = p_external_id;
    return;
  end if;

  perform app.emit('org_created', v_org,
    jsonb_build_object('channel', p_channel, 'country_code', v_country.code));
  return query select v_org, v_identity.id, true;
end
$$;

-- Rôle d'équipe (ADM-1). `p_actor` null : attribution par l'outil en ligne de commande.
create or replace function app.grant_staff(p_user_id uuid, p_role text, p_actor uuid) returns void
language plpgsql
as $$
declare
  v_email text;
  v_before jsonb;
begin
  if p_user_id is null then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;
  if p_actor is not null and not exists (
    select 1 from public.staff s where s.user_id = p_actor and s.role = 'admin'
  ) then
    raise exception 'réservé aux admins' using errcode = '42501';
  end if;
  execute 'select email from neon_auth."user" where id = $1' into v_email using p_user_id;
  if v_email is null then
    raise exception 'compte introuvable' using errcode = 'P0002';
  end if;
  select to_jsonb(s) into v_before from public.staff s where s.user_id = p_user_id;
  insert into public.staff (user_id, email, role, granted_by)
  values (p_user_id, v_email, p_role, p_actor)
  on conflict (user_id) do update set role = excluded.role, email = excluded.email,
    granted_by = excluded.granted_by;
  perform app.audit('staff', coalesce(p_actor::text, 'cli'), 'grant_staff', 'staff',
    p_user_id::text, v_before, jsonb_build_object('role', p_role, 'email', v_email));
end
$$;

create or replace function app.revoke_staff(p_user_id uuid, p_actor uuid) returns void
language plpgsql
as $$
declare
  v_before jsonb;
begin
  if not exists (select 1 from public.staff s where s.user_id = p_actor and s.role = 'admin') then
    raise exception 'réservé aux admins' using errcode = '42501';
  end if;
  if p_user_id = p_actor then
    raise exception 'un admin ne peut pas se retirer lui-même' using errcode = '22023';
  end if;
  delete from public.staff s where s.user_id = p_user_id returning to_jsonb(s) into v_before;
  if v_before is null then
    raise exception 'membre introuvable' using errcode = 'P0002';
  end if;
  perform app.audit('staff', p_actor::text, 'revoke_staff', 'staff', p_user_id::text, v_before, null);
end
$$;
