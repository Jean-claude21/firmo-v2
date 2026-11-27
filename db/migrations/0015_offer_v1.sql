-- 0015 — Offre au niveau de la v1 (spec 011, PARITE_V1 §4).
-- Versions d'offre : un abonnement garde la sienne ; une modification publie une nouvelle version.
-- Recharges : des documents en plus sur la période payée en cours. Période de grâce : quelques
-- jours après la fin de période, pendant lesquels tout continue. Chariow : fournisseur de la v1.
-- Conditions de fin (reprises de Struo) : pas de reconduction automatique ; l'artisan est prévenu
-- dans son chat avant la fin, à la fin et à la fin de la grâce, une seule fois par période ; après
-- la grâce, plus aucun document final, mais tout reste lisible et téléchargeable.

alter table public.plans
  add column grace_days integer not null default 0 check (grace_days between 0 and 60),
  -- Recharge : taille (documents) et prix ; prix absent = recharge non proposée.
  add column top_up_documents integer check (top_up_documents is null or top_up_documents between 1 and 10000),
  add column top_up_price_minor bigint check (top_up_price_minor is null or top_up_price_minor > 0),
  -- Produit chez chaque fournisseur qui en exige un : {"chariow": "prd_…"}.
  add column provider_products jsonb not null default '{}' check (jsonb_typeof(provider_products) = 'object');

-- Décision commerciale publique de la v1 (migration v1 20260817001000) : 2 000 F CFA par mois pour
-- 15 documents finaux, produit Chariow prd_s1bcdqkm ; recharge de 10 documents. Nouvelle version :
-- les abonnements en cours gardent la leur. Grâce de 3 jours (conditions reprises de Struo).
-- Le prix d'une recharge n'a jamais été fixé en v1 : il reste à renseigner dans la console.
with previous as (
  update public.plans set active = false where code = 'standard' and active
  returning code, version, labels, currency_code, price_minor, period_days
)
insert into public.plans (code, version, labels, currency_code, price_minor, period_days, quota, top_up_documents,
                          grace_days, provider_products, active)
select code, version + 1, labels, currency_code, price_minor, period_days, 15, 10, 3,
       case when currency_code = 'XOF' then '{"chariow":"prd_s1bcdqkm"}'::jsonb else '{}'::jsonb end, true
from previous;

insert into public.settings (key, value, description) values
  ('subscription_warn_days', '3', 'Jours avant la fin d''une période où l''artisan est prévenu dans son chat (puis la veille).');

-- Droit courant : période en cours, période de grâce comprise.
create or replace function app.current_subscription(p_org uuid) returns public.subscriptions
language sql stable
as $$
  select s.* from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
  where s.org_id = p_org and s.ended_at is null and s.period_start <= now()
    and (s.period_end is null or s.period_end + make_interval(days => coalesce(p.grace_days, 0)) > now())
  order by (s.kind = 'paid') desc, s.created_at desc
  limit 1
$$;

-- ---------------------------------------------------------------- paiements : abonnement ou recharge

alter table public.subscription_payments
  add column kind text not null default 'subscription' check (kind in ('subscription', 'top_up')),
  add column units integer check (units is null or units > 0);

insert into public.payment_providers (code, labels, enabled, simulated, position) values
  ('chariow', '{"fr":"Mobile Money et carte (Chariow)","en":"Mobile Money and card (Chariow)"}', false, false, 2);

drop function app.start_subscription_payment(uuid, text, text, text);
create or replace function app.start_subscription_payment(
  p_org uuid, p_plan_code text, p_provider text, p_idempotency_key text, p_kind text default 'subscription'
) returns public.subscription_payments
language plpgsql
as $$
declare
  v_org public.organizations;
  v_plan public.plans;
  v_current public.subscriptions;
  v_payment public.subscription_payments;
begin
  select * into v_payment from public.subscription_payments where org_id = p_org and idempotency_key = p_idempotency_key;
  if found then
    return v_payment;
  end if;
  if p_kind not in ('subscription', 'top_up') then
    raise exception 'type de paiement inconnu' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_org;
  if not found or v_org.status <> 'active' then
    raise exception 'organisation introuvable ou suspendue' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payment_providers where code = p_provider and enabled) then
    raise exception 'moyen de paiement indisponible' using errcode = '22023';
  end if;
  if p_kind = 'top_up' then
    -- Une recharge s'ajoute à la période payée en cours, au prix de son offre.
    v_current := app.current_subscription(p_org);
    -- Pendant la grâce, la période est échue : on se réabonne, on ne recharge pas.
    if v_current.id is null or v_current.kind <> 'paid' or v_current.period_end <= now() then
      raise exception 'recharge réservée à un abonnement en cours' using errcode = '42501', hint = 'top_up_needs_subscription';
    end if;
    select * into v_plan from public.plans where id = v_current.plan_id;
    if v_plan.top_up_price_minor is null or v_plan.top_up_documents is null then
      raise exception 'recharge non proposée pour cette offre' using errcode = 'P0002', hint = 'top_up_unavailable';
    end if;
  else
    select * into v_plan from public.plans where code = p_plan_code and currency_code = v_org.currency_code and active;
    if not found then
      raise exception 'offre indisponible dans cette devise' using errcode = 'P0002';
    end if;
  end if;
  insert into public.subscription_payments (org_id, plan_id, provider_code, amount_minor, currency_code, reference,
    idempotency_key, kind, units)
  values (p_org, v_plan.id, p_provider,
          case when p_kind = 'top_up' then v_plan.top_up_price_minor else v_plan.price_minor end,
          v_plan.currency_code,
          'PAY-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)), p_idempotency_key,
          p_kind, case when p_kind = 'top_up' then v_plan.top_up_documents end)
  returning * into v_payment;
  return v_payment;
end
$$;

-- Recharge confirmée : les documents s'ajoutent à la période payée en cours, sans réécrire le passé.
create or replace function app.add_top_up(p_org uuid, p_units integer) returns uuid
language plpgsql
as $$
declare
  v_sub public.subscriptions;
begin
  select * into v_sub from public.subscriptions where id = (app.current_subscription(p_org)).id for update;
  if v_sub.id is null or v_sub.kind <> 'paid' then
    raise exception 'aucune période payée en cours' using errcode = '42501';
  end if;
  update public.subscriptions set quota = quota + p_units, warned = false where id = v_sub.id;
  return v_sub.id;
end
$$;

-- Confirmation du fournisseur : appliquée une seule fois (événement), montant et devise vérifiés.
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
    if v_payment.kind = 'top_up' then
      v_sub := app.add_top_up(v_payment.org_id, v_payment.units);
      perform app.emit('top_up_paid', v_payment.org_id, jsonb_build_object('units', v_payment.units, 'provider', p_provider));
    else
      v_sub := app.start_paid_period(v_payment.org_id, v_payment.plan_id);
      perform app.emit('subscription_paid', v_payment.org_id, jsonb_build_object(
        'plan_code', (select code from public.plans where id = v_payment.plan_id),
        'plan_version', (select version from public.plans where id = v_payment.plan_id), 'provider', p_provider));
    end if;
  end if;
  update public.subscription_payments set status = p_outcome, settled_at = now(), subscription_id = v_sub where id = p_payment;
  insert into public.payment_events values (p_provider, p_event_id, p_payment, p_outcome, true, null);
  -- P-57 file de confirmation : le message au chat part dans la même transaction que le paiement.
  -- S'il échoue, la tâche est reprise (tentatives de la file) ; le paiement, lui, reste acquis.
  perform app.enqueue_job('notify_subscription', jsonb_build_object(
    'org_id', v_payment.org_id, 'payment_id', p_payment, 'subscription_id', v_sub, 'outcome', p_outcome, 'kind', v_payment.kind,
    'units', v_payment.units), 'payment_notice:' || p_payment);
  perform app.audit('system', p_provider, 'settle_payment', 'subscription_payment', p_payment::text, null,
    jsonb_build_object('outcome', p_outcome, 'kind', v_payment.kind, 'amount_minor', v_payment.amount_minor, 'currency', v_payment.currency_code));
  return 'applied';
end
$$;

-- Rapprochement par l'équipe (v1) : une vente vérifiée chez le fournisseur mais dont l'avis n'est
-- jamais arrivé est appliquée une seule fois, avec le motif et l'auteur au journal.
create or replace function app.reconcile_payment(
  p_staff uuid, p_payment uuid, p_outcome text, p_amount bigint, p_currency text, p_reason text
) returns text
language plpgsql
as $$
declare
  v_payment public.subscription_payments;
  v_result text;
begin
  perform app.require_staff(p_staff, true);
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'motif obligatoire' using errcode = '22023', hint = 'reason_required';
  end if;
  select * into v_payment from public.subscription_payments where id = p_payment;
  if not found then
    raise exception 'paiement introuvable' using errcode = 'P0002';
  end if;
  v_result := app.settle_subscription_payment(v_payment.provider_code, 'reconcile:' || p_payment, p_payment,
    p_outcome, p_amount, p_currency);
  perform app.audit('staff', p_staff::text, 'reconcile_payment', 'subscription_payment', p_payment::text, null,
    jsonb_build_object('result', v_result, 'outcome', p_outcome, 'reason', btrim(p_reason)));
  return v_result;
end
$$;

-- ---------------------------------------------------------------- console : publier une version

-- Une version reprend recharge, grâce et produits de la précédente, sauf valeur donnée.
drop function app.publish_plan(text, text, jsonb, bigint, integer, integer, uuid);
create or replace function app.publish_plan(
  p_code text, p_currency text, p_labels jsonb, p_price bigint, p_quota integer, p_period_days integer, p_actor uuid,
  p_grace_days integer default null, p_top_up_documents integer default null, p_top_up_price bigint default null,
  p_provider_products jsonb default null
) returns uuid
language plpgsql
as $$
declare
  v_prev public.plans;
  v_version integer;
  v_id uuid;
begin
  perform app.require_staff(p_actor, true);
  select * into v_prev from public.plans where code = p_code and currency_code = upper(p_currency)
  order by version desc limit 1;
  v_version := coalesce(v_prev.version, 0) + 1;
  update public.plans set active = false where code = p_code and currency_code = upper(p_currency) and active;
  insert into public.plans (code, version, labels, currency_code, price_minor, period_days, quota,
                            grace_days, top_up_documents, top_up_price_minor, provider_products)
  values (p_code, v_version, p_labels, upper(p_currency), p_price, p_period_days, p_quota,
          coalesce(p_grace_days, v_prev.grace_days, 0),
          coalesce(p_top_up_documents, v_prev.top_up_documents),
          coalesce(p_top_up_price, v_prev.top_up_price_minor),
          coalesce(p_provider_products, v_prev.provider_products, '{}'))
  returning id into v_id;
  perform app.audit('staff', p_actor::text, 'publish_plan', 'plan', v_id::text,
    case when v_prev.id is null then null else to_jsonb(v_prev) - 'labels' end,
    (select to_jsonb(p) - 'labels' from public.plans p where id = v_id));
  return v_id;
end
$$;

-- ---------------------------------------------------------------- conditions de fin (Struo)

-- Chaque période payée ou offerte programme ses rappels dès sa création : avant la fin
-- (`subscription_warn_days`, puis la veille), à la fin (si une grâce existe), à la fin de la grâce.
-- Une clé par période et par étape : chaque rappel part une seule fois.
create or replace function app.schedule_period_notices() returns trigger
language plpgsql
as $$
declare
  v_warn int := coalesce((app.setting('subscription_warn_days') #>> '{}')::int, 3);
  v_grace int := coalesce((select grace_days from public.plans where id = new.plan_id), 0);
  v_day int;
begin
  if new.kind not in ('paid', 'grant') or new.period_end is null then
    return new;
  end if;
  foreach v_day in array (select array_agg(distinct d) from unnest(array[v_warn, 1]) d where d > 0 and d <= v_warn) loop
    if new.period_end - make_interval(days => v_day) > new.period_start then
      perform app.enqueue_job('subscription_notice', jsonb_build_object('subscription_id', new.id, 'stage', 'ending', 'days', v_day),
        'period_notice:' || new.id || ':ending:' || v_day, new.period_end - make_interval(days => v_day));
    end if;
  end loop;
  if v_grace > 0 then
    perform app.enqueue_job('subscription_notice', jsonb_build_object('subscription_id', new.id, 'stage', 'ended'),
      'period_notice:' || new.id || ':ended', new.period_end);
  end if;
  perform app.enqueue_job('subscription_notice', jsonb_build_object('subscription_id', new.id, 'stage', 'closed'),
    'period_notice:' || new.id || ':closed', new.period_end + make_interval(days => v_grace));
  return new;
end
$$;
create trigger subscriptions_schedule_notices after insert on public.subscriptions
  for each row execute function app.schedule_period_notices();

-- Au moment d'envoyer : rien si l'artisan a déjà renouvelé (une période suivante existe), si la
-- période a été close ou si l'organisation est suspendue. Sinon, ce qu'il faut lui dire.
create or replace function app.period_notice(p_subscription uuid)
returns table (org_id uuid, send boolean, period_end timestamptz, grace_end timestamptz, plan_code text, quota integer, used integer)
language sql stable
as $$
  select s.org_id,
         s.ended_at is null and o.status = 'active'
           and not exists (select 1 from public.subscriptions n
                           where n.org_id = s.org_id and n.id <> s.id and n.kind in ('paid', 'grant')
                             and n.ended_at is null
                             and n.period_end > s.period_end),
         s.period_end,
         s.period_end + make_interval(days => coalesce(p.grace_days, 0)),
         p.code, s.quota, s.used
  from public.subscriptions s
  join public.organizations o on o.id = s.org_id
  left join public.plans p on p.id = s.plan_id
  where s.id = p_subscription
$$;
