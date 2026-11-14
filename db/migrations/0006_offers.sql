-- 0006 — Offres, essai et quota (spec 002 : OFF-1, OFF-2 ; le paiement arrive en spec 006).
-- Seule l'émission d'un document « counts_quota » consomme une unité ; les révisions non.

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  -- Une modification publie une nouvelle version ; un abonnement garde la sienne.
  version integer not null check (version >= 1),
  labels jsonb not null check (app.is_labels(labels)),
  currency_code char(3) not null references public.currencies (code),
  price_minor bigint not null check (price_minor > 0),
  period_days integer not null default 30 check (period_days between 1 and 366),
  quota integer not null check (quota between 1 and 100000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (code, currency_code, version)
);
create unique index plans_one_active on public.plans (code, currency_code) where active;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('trial', 'paid', 'grant')),
  plan_id uuid references public.plans (id),
  period_start timestamptz not null default now(),
  -- Essai : sans fin ; il s'achève quand le quota est atteint ou qu'un abonnement commence.
  period_end timestamptz,
  quota integer not null check (quota >= 0),
  used integer not null default 0 check (used >= 0),
  warned boolean not null default false,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check (kind <> 'paid' or (plan_id is not null and period_end is not null)),
  check (period_end is null or period_end > period_start)
);
create index subscriptions_org on public.subscriptions (org_id, created_at desc);

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;

insert into public.settings (key, value, description) values
  ('trial_documents', '3', 'Documents émis offerts à l''essai.'),
  ('quota_warning_percent', '80', 'Seuil d''avertissement du quota (pourcentage).');

insert into public.plans (code, version, labels, currency_code, price_minor, period_days, quota) values
  ('standard', 1, '{"fr":"Firmo mensuel","en":"Firmo monthly"}', 'XOF', 2000, 30, 30),
  ('standard', 1, '{"fr":"Firmo mensuel","en":"Firmo monthly"}', 'XAF', 2000, 30, 30),
  ('standard', 1, '{"fr":"Firmo mensuel","en":"Firmo monthly"}', 'EUR', 300, 30, 30);

-- Droit courant : l'abonnement en cours le plus récent (période non échue, non terminé).
create or replace function app.current_subscription(p_org uuid) returns public.subscriptions
language sql stable
as $$
  select s.* from public.subscriptions s
  where s.org_id = p_org and s.ended_at is null and s.period_start <= now()
    and (s.period_end is null or s.period_end > now())
  order by (s.kind = 'paid') desc, s.created_at desc
  limit 1
$$;

create or replace function app.entitlement(p_org uuid)
returns table (subscription_id uuid, kind text, quota integer, used integer, remaining integer,
               period_end timestamptz, plan_code text)
language sql stable
as $$
  select s.id, s.kind, s.quota, s.used, greatest(s.quota - s.used, 0), s.period_end, p.code
  from (select (app.current_subscription(p_org)).*) s
  left join public.plans p on p.id = s.plan_id
  where s.id is not null
$$;

-- Consomme une unité (dans la transaction d'émission). Refus explicite si le quota est épuisé.
create or replace function app.consume_unit(p_org uuid) returns void
language plpgsql
as $$
declare
  v_sub public.subscriptions;
  v_percent int := coalesce((app.setting('quota_warning_percent') #>> '{}')::int, 80);
begin
  select * into v_sub from public.subscriptions s
  where s.id = (app.current_subscription(p_org)).id
  for update;
  if v_sub.id is null or v_sub.used >= v_sub.quota then
    raise exception 'quota épuisé' using errcode = 'P0001', hint = 'quota_exhausted';
  end if;
  update public.subscriptions set used = used + 1 where id = v_sub.id;
  if not v_sub.warned and (v_sub.used + 1) * 100 >= v_sub.quota * v_percent then
    update public.subscriptions set warned = true where id = v_sub.id;
    perform app.emit('quota_warning', p_org, jsonb_build_object(
      'plan_code', coalesce((select code from public.plans where id = v_sub.plan_id), v_sub.kind)));
  end if;
end
$$;

-- Essai ouvert à la création d'une organisation (OFF-1).
create or replace function app.open_trial() returns trigger
language plpgsql
as $$
begin
  insert into public.subscriptions (org_id, kind, quota)
  values (new.id, 'trial', coalesce((app.setting('trial_documents') #>> '{}')::int, 3));
  return new;
end
$$;
create trigger organizations_open_trial after insert on public.organizations
  for each row execute function app.open_trial();

-- Démarre une période payée (appelée par le paiement confirmé, spec 006, ou par un admin).
-- Les unités non utilisées de l'essai sont perdues ; une période en cours est prolongée.
create or replace function app.start_paid_period(p_org uuid, p_plan uuid, p_kind text default 'paid')
returns uuid
language plpgsql
as $$
declare
  v_plan public.plans;
  v_current public.subscriptions;
  v_start timestamptz := now();
  v_id uuid;
begin
  select * into v_plan from public.plans where id = p_plan;
  if not found then
    raise exception 'offre introuvable' using errcode = 'P0002';
  end if;
  if (select currency_code from public.organizations where id = p_org) is distinct from v_plan.currency_code then
    raise exception 'offre dans une autre devise' using errcode = '22023';
  end if;
  select * into v_current from public.subscriptions s where s.id = (app.current_subscription(p_org)).id;
  if v_current.kind in ('paid', 'grant') and v_current.period_end > now() then
    -- Renouvellement anticipé : la nouvelle période commence à la fin de l'actuelle.
    v_start := v_current.period_end;
  end if;
  update public.subscriptions set ended_at = now()
  where org_id = p_org and kind = 'trial' and ended_at is null;
  insert into public.subscriptions (org_id, kind, plan_id, period_start, period_end, quota)
  values (p_org, p_kind, v_plan.id, v_start, v_start + make_interval(days => v_plan.period_days), v_plan.quota)
  returning id into v_id;
  return v_id;
end
$$;
