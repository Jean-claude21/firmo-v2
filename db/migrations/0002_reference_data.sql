-- 0002 — Données de référence (spec 001, constitution IV).
-- Pays, devises, taxes, métiers, unités, types de documents, modèles, canaux, IA, réglages.

create table public.currencies (
  code char(3) primary key check (code ~ '^[A-Z]{3}$'),
  labels jsonb not null check (app.is_labels(labels)),
  minor_units smallint not null check (minor_units between 0 and 4),
  symbol text not null,
  symbol_before boolean not null default false,
  thousands_separator text not null default ' ',
  decimal_separator text not null default ',',
  active boolean not null default true
);

create table public.countries (
  code char(2) primary key check (code ~ '^[A-Z]{2}$'),
  labels jsonb not null check (app.is_labels(labels)),
  currency_code char(3) not null references public.currencies (code),
  phone_prefix text not null check (phone_prefix ~ '^[0-9]{1,4}$'),
  default_locale text not null default 'fr' check (default_locale ~ '^[a-z]{2}$'),
  -- Identifiants légaux attendus : [{"code":"RCCM","labels":{...}}, ...]
  legal_ids jsonb not null default '[]' check (jsonb_typeof(legal_ids) = 'array'),
  active boolean not null default true
);
create index countries_phone_prefix on public.countries (phone_prefix);

create table public.taxes (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null references public.countries (code),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  -- Taux en points de base : 1800 = 18 %.
  rate_bp integer not null check (rate_bp between 0 and 10000),
  is_default boolean not null default false,
  active boolean not null default true,
  unique (country_code, code)
);
create unique index taxes_one_default on public.taxes (country_code) where is_default;

create table public.units (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  -- Abréviation imprimée : {"fr":"m²"}
  short_labels jsonb not null check (app.is_labels(short_labels)),
  position smallint not null default 0
);

create table public.trades (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  -- Vocabulaire du métier, aide la lecture (jamais de prix).
  vocabulary jsonb not null default '{}' check (jsonb_typeof(vocabulary) = 'object'),
  units text[] not null default '{}',
  position smallint not null default 0,
  active boolean not null default true
);

create table public.document_types (
  code text primary key check (code ~ '^[a-z_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  number_prefix text not null check (number_prefix ~ '^[A-Z]{1,6}$'),
  -- L'émission consomme une unité du quota.
  counts_quota boolean not null default true,
  -- Le client peut accepter ou refuser (devis).
  acceptable boolean not null default false,
  -- Validité par défaut (devis), en jours.
  validity_days integer check (validity_days is null or validity_days between 1 and 365),
  -- Les paiements peuvent être notés (factures).
  payable boolean not null default false,
  position smallint not null default 0,
  active boolean not null default true
);

create table public.templates (
  code text primary key check (code ~ '^[a-z_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  descriptions jsonb not null check (app.is_labels(descriptions)),
  position smallint not null default 0,
  active boolean not null default true
);

create table public.channels (
  code text primary key check (code ~ '^[a-z_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  enabled boolean not null default false,
  -- Réglages non secrets (identifiant de numéro, nom du bot…).
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object')
);

create table public.ai_tasks (
  task text primary key check (task ~ '^[a-z_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  provider text not null default 'openai',
  model text not null,
  enabled boolean not null default true,
  -- Prix indicatifs pour le suivi des coûts, en micro-dollars par million de jetons ou par minute.
  pricing jsonb not null default '{}' check (jsonb_typeof(pricing) = 'object'),
  updated_at timestamptz not null default now()
);
create trigger ai_tasks_updated_at before update on public.ai_tasks
  for each row execute function app.set_updated_at();

create table public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  enabled boolean not null default false,
  description text not null default ''
);

create table public.settings (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  value jsonb not null,
  description text not null default ''
);

-- RLS partout, aucun droit pour la Data API (décision 0002).
alter table public.currencies enable row level security;
alter table public.countries enable row level security;
alter table public.taxes enable row level security;
alter table public.units enable row level security;
alter table public.trades enable row level security;
alter table public.document_types enable row level security;
alter table public.templates enable row level security;
alter table public.channels enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.feature_flags enable row level security;
alter table public.settings enable row level security;

-- Réglage typé.
create or replace function app.setting(p_key text) returns jsonb
language sql stable
as $$
  select value from public.settings where key = p_key
$$;

-- Pays déduit d'un numéro international (« +228… » ou « 00228… », préfixe le plus long).
create or replace function app.country_from_phone(p_phone text) returns char(2)
language sql stable
as $$
  select c.code
  from public.countries c
  where c.active
    and regexp_replace(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '^00', '')
        like c.phone_prefix || '%'
  order by length(c.phone_prefix) desc, c.code
  limit 1
$$;
