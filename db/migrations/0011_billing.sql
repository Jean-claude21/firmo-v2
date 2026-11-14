-- 0011 — Paiement de l'abonnement (spec 006 : OFF-1, OFF-3, ART-6).
-- Le seul argent que Firmo traite est celui de l'abonnement de l'artisan (décision 0003).
-- Le montant vient toujours de l'offre en base ; la confirmation du fournisseur est vérifiée
-- (montant, devise) et appliquée une seule fois.

create table public.payment_providers (
  code text primary key check (code ~ '^[a-z_]+$'),
  labels jsonb not null check (app.is_labels(labels)),
  enabled boolean not null default false,
  -- Simulateur : jamais en production (l'API le refuse aussi).
  simulated boolean not null default false,
  position smallint not null default 0
);

insert into public.payment_providers (code, labels, enabled, simulated, position) values
  ('moneroo', '{"fr":"Mobile Money et carte (Moneroo)","en":"Mobile Money and card (Moneroo)"}', false, false, 1),
  ('simulator', '{"fr":"Paiement simulé","en":"Simulated payment"}', true, true, 9);

create table public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  provider_code text not null references public.payment_providers (code),
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'cancelled')),
  amount_minor bigint not null check (amount_minor > 0),
  currency_code char(3) not null references public.currencies (code),
  -- Référence courte affichée et transmise au fournisseur (PAY-XXXXXX).
  reference text not null unique,
  idempotency_key text not null,
  provider_reference text,
  checkout_url text,
  subscription_id uuid references public.subscriptions (id),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (org_id, idempotency_key)
);
create index subscription_payments_org on public.subscription_payments (org_id, created_at desc);

-- Événements des fournisseurs déjà appliqués (idempotence des webhooks).
create table public.payment_events (
  provider_code text not null,
  event_id text not null,
  payment_id uuid references public.subscription_payments (id) on delete set null,
  outcome text not null,
  applied boolean not null,
  note text,
  received_at timestamptz not null default now(),
  primary key (provider_code, event_id)
);

alter table public.payment_providers enable row level security;
alter table public.subscription_payments enable row level security;
alter table public.payment_events enable row level security;

-- Démarre un paiement : offre active dans la devise de l'organisation, fournisseur actif.
-- Même clé d'idempotence → même paiement.
create or replace function app.start_subscription_payment(
  p_org uuid, p_plan_code text, p_provider text, p_idempotency_key text
) returns public.subscription_payments
language plpgsql
as $$
declare
  v_org public.organizations;
  v_plan public.plans;
  v_payment public.subscription_payments;
begin
  select * into v_payment from public.subscription_payments where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return v_payment;
  end if;
  select * into v_org from public.organizations where id = p_org;
  if not found or v_org.status <> 'active' then
    raise exception 'organisation introuvable ou suspendue' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where code = p_plan_code and currency_code = v_org.currency_code and active;
  if not found then
    raise exception 'offre indisponible dans cette devise' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.payment_providers where code = p_provider and enabled) then
    raise exception 'moyen de paiement indisponible' using errcode = '22023';
  end if;
  insert into public.subscription_payments (org_id, plan_id, provider_code, amount_minor, currency_code, reference, idempotency_key)
  values (p_org, v_plan.id, p_provider, v_plan.price_minor, v_plan.currency_code,
          'PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), p_idempotency_key)
  returning * into v_payment;
  return v_payment;
end
$$;

create or replace function app.set_payment_checkout(p_payment uuid, p_provider_reference text, p_checkout_url text)
returns void
language sql
as $$
  update public.subscription_payments set provider_reference = p_provider_reference, checkout_url = p_checkout_url
  where id = p_payment and status = 'pending'
$$;

-- Confirmation du fournisseur : appliquée une seule fois (événement), montant et devise vérifiés.
-- Réussite → période payée (app.start_paid_period) et événement subscription_paid.
create or replace function app.settle_subscription_payment(
  p_provider text, p_event_id text, p_payment uuid, p_outcome text, p_amount bigint, p_currency text
) returns text
language plpgsql
as $$
declare
  v_payment public.subscription_payments;
  v_sub uuid;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'issue de paiement inconnue' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_events where provider_code = p_provider and event_id = p_event_id) then
    return 'duplicate';
  end if;
  select * into v_payment from public.subscription_payments where id = p_payment for update;
  if not found or v_payment.provider_code <> p_provider then
    insert into public.payment_events values (p_provider, p_event_id, null, p_outcome, false, 'paiement inconnu');
    return 'unknown';
  end if;
  if v_payment.status <> 'pending' then
    insert into public.payment_events values (p_provider, p_event_id, p_payment, p_outcome, false, 'déjà réglé');
    return 'already_settled';
  end if;
  if p_outcome = 'succeeded' and (p_amount <> v_payment.amount_minor or upper(p_currency) <> v_payment.currency_code) then
    insert into public.payment_events values (p_provider, p_event_id, p_payment, p_outcome, false, 'montant ou devise incohérents');
    update public.subscription_payments set status = 'failed', settled_at = now() where id = p_payment;
    return 'mismatch';
  end if;
  if p_outcome = 'succeeded' then
    v_sub := app.start_paid_period(v_payment.org_id, v_payment.plan_id);
    perform app.emit('subscription_paid', v_payment.org_id, jsonb_build_object(
      'plan_code', (select code from public.plans where id = v_payment.plan_id), 'provider', p_provider));
  end if;
  update public.subscription_payments set status = p_outcome, settled_at = now(), subscription_id = v_sub where id = p_payment;
  insert into public.payment_events values (p_provider, p_event_id, p_payment, p_outcome, true, null);
  perform app.audit('system', p_provider, 'settle_payment', 'subscription_payment', p_payment::text, null,
    jsonb_build_object('outcome', p_outcome, 'amount_minor', v_payment.amount_minor, 'currency', v_payment.currency_code));
  return 'applied';
end
$$;
