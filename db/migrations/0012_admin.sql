-- 0012 — Administration (spec 007 : ADM-1 à ADM-7). Toute écriture est auditée.

-- Exige un membre de l'équipe ; `p_admin` : réservé aux admins.
create or replace function app.require_staff(p_user uuid, p_admin boolean) returns text
language plpgsql stable
as $$
declare
  v_role text;
begin
  select role into v_role from public.staff where user_id = p_user;
  if v_role is null or (p_admin and v_role <> 'admin') then
    raise exception 'rôle insuffisant' using errcode = '42501';
  end if;
  return v_role;
end
$$;

-- Tableau de bord (ADM-2). Fenêtre glissante de `p_days` jours.
create or replace function app.admin_dashboard(p_days integer default 30) returns jsonb
language sql stable
as $$
  with since as (select now() - make_interval(days => greatest(p_days, 1)) as t),
  cohort as (
    select e.org_id, e.created_at from public.analytics_events e, since
    where e.name = 'org_created' and e.created_at >= since.t and e.created_at <= now() - interval '7 days'
  ),
  reads as (
    select coalesce(sum((props ->> 'lines')::int * 3), 0) as values_read from public.analytics_events, since
    where name = 'reading_done' and created_at >= since.t
  ),
  corrections as (
    select count(*) as n from public.analytics_events, since where name = 'reading_corrected' and created_at >= since.t
  )
  select jsonb_build_object(
    'organizations', (select count(*) from public.organizations),
    'organizations_new', (select count(*) from public.organizations, since where created_at >= since.t),
    'organizations_active', (select count(distinct org_id) from public.messages, since where direction = 'in' and created_at >= since.t),
    'documents_issued', (select count(*) from public.documents, since where issued_at >= since.t and type_code <> 'receipt'),
    'documents_today', (select count(*) from public.documents where issued_at >= date_trunc('day', now()) and type_code <> 'receipt'),
    'messages', (select count(*) from public.messages, since where direction = 'in' and created_at >= since.t),
    'messages_failed', (select count(*) from public.messages, since where status = 'failed' and created_at >= since.t),
    'jobs_failed', (select count(*) from public.jobs where status = 'failed'),
    -- Indicateur décisif : part des organisations (créées il y a plus de 7 jours) qui ont partagé un
    -- document dans les 7 jours suivant leur premier message.
    'decisive_rate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (
        select 1 from public.analytics_events s where s.org_id = c.org_id and s.name = 'document_shared'
          and s.created_at <= c.created_at + interval '7 days')) / count(*), 1) end from cohort c),
    'decisive_cohort', (select count(*) from cohort),
    'reading_fidelity', (select case when r.values_read = 0 then null else round(100.0 * (1 - least(c.n::numeric / r.values_read, 1)), 1) end from reads r, corrections c),
    'quote_acceptance', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where d.status in ('accepted')) / count(*), 1) end
                         from public.documents d join public.document_types t on t.code = d.type_code, since
                         where t.acceptable and d.issued_at >= since.t and d.status in ('issued', 'accepted', 'refused')),
    'quote_conversion', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where exists (
                           select 1 from public.documents i where i.source_document_id = d.id and i.status <> 'draft')) / count(*), 1) end
                         from public.documents d join public.document_types t on t.code = d.type_code, since
                         where t.acceptable and d.issued_at >= since.t and d.status not in ('draft', 'cancelled', 'replaced')),
    'ai_cost_micro_usd', (select coalesce(sum(cost_micro_usd), 0) from public.ai_usage, since where created_at >= since.t),
    'ai_calls', (select count(*) from public.ai_usage, since where created_at >= since.t),
    'ai_cost_unknown', (select count(*) from public.ai_usage, since where created_at >= since.t and cost_micro_usd is null),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency_code, 'amount_minor', total)), '[]') from (
                  select currency_code, sum(amount_minor)::text as total from public.subscription_payments, since
                  where status = 'succeeded' and settled_at >= since.t group by currency_code) r),
    'subscribers', (select count(distinct org_id) from public.subscriptions where kind = 'paid' and ended_at is null and period_end > now()),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'documents', (
                  select count(*) from public.documents where issued_at >= d and issued_at < d + interval '1 day' and type_code <> 'receipt'),
                'messages', (select count(*) from public.messages where direction = 'in' and created_at >= d and created_at < d + interval '1 day')) order by d), '[]')
               from generate_series(date_trunc('day', now()) - make_interval(days => greatest(p_days, 1) - 1), date_trunc('day', now()), interval '1 day') d)
  )
$$;

-- Configuration (ADM-5) : seuls ces champs sont modifiables, table par table.
create or replace function app.admin_update_reference(p_table text, p_key text, p_patch jsonb, p_actor uuid)
returns void
language plpgsql
as $$
declare
  v_allowed jsonb := '{
    "countries": ["active", "labels", "default_locale", "legal_ids"],
    "currencies": ["active", "labels", "symbol", "symbol_before", "thousands_separator", "decimal_separator"],
    "trades": ["active", "labels", "position", "units", "vocabulary"],
    "units": ["labels", "short_labels", "position"],
    "document_types": ["active", "labels", "number_prefix", "validity_days", "position"],
    "templates": ["active", "labels", "descriptions", "position"],
    "channels": ["enabled", "labels", "settings"],
    "ai_tasks": ["enabled", "model", "provider", "pricing"],
    "feature_flags": ["enabled", "description"],
    "settings": ["value"],
    "payment_providers": ["enabled", "labels", "position"]
  }';
  v_keys jsonb := '{"countries":"code","currencies":"code","trades":"code","units":"code","document_types":"code",
    "templates":"code","channels":"code","ai_tasks":"task","feature_flags":"key","settings":"key","payment_providers":"code"}';
  v_key_col text := v_keys ->> p_table;
  v_field text;
  v_sets text[] := '{}';
  v_before jsonb;
  v_after jsonb;
begin
  perform app.require_staff(p_actor, true);
  if v_key_col is null then
    raise exception 'table non configurable : %', p_table using errcode = '22023';
  end if;
  for v_field in select jsonb_object_keys(p_patch) loop
    if not (v_allowed -> p_table) ? v_field then
      raise exception 'champ non modifiable : %.%', p_table, v_field using errcode = '22023';
    end if;
    v_sets := v_sets || format('%I = (jsonb_populate_record(null::public.%I, jsonb_build_object(%L, $1 -> %L))).%I',
                               v_field, p_table, v_field, v_field, v_field);
  end loop;
  if cardinality(v_sets) = 0 then
    return;
  end if;
  execute format('select to_jsonb(t) from public.%I t where %I = $1', p_table, v_key_col) into v_before using p_key;
  if v_before is null then
    raise exception 'élément introuvable' using errcode = 'P0002';
  end if;
  execute format('update public.%I set %s where %I = $2 returning to_jsonb(%I)', p_table, array_to_string(v_sets, ', '), v_key_col, p_table)
    into v_after using p_patch, p_key;
  perform app.audit('staff', p_actor::text, 'update_reference', p_table, p_key, v_before, v_after);
end
$$;

-- Nouvelle version d'une offre (les abonnements gardent la leur).
create or replace function app.publish_plan(
  p_code text, p_currency text, p_labels jsonb, p_price bigint, p_quota integer, p_period_days integer, p_actor uuid
) returns uuid
language plpgsql
as $$
declare
  v_version integer;
  v_id uuid;
begin
  perform app.require_staff(p_actor, true);
  select coalesce(max(version), 0) + 1 into v_version from public.plans where code = p_code and currency_code = p_currency;
  update public.plans set active = false where code = p_code and currency_code = p_currency and active;
  insert into public.plans (code, version, labels, currency_code, price_minor, period_days, quota)
  values (p_code, v_version, p_labels, upper(p_currency), p_price, p_period_days, p_quota)
  returning id into v_id;
  perform app.audit('staff', p_actor::text, 'publish_plan', 'plan', v_id::text, null,
    jsonb_build_object('code', p_code, 'currency', p_currency, 'version', v_version, 'price_minor', p_price, 'quota', p_quota));
  return v_id;
end
$$;

create or replace function app.retire_plan(p_id uuid, p_actor uuid) returns void
language plpgsql
as $$
begin
  perform app.require_staff(p_actor, true);
  update public.plans set active = false where id = p_id;
  perform app.audit('staff', p_actor::text, 'retire_plan', 'plan', p_id::text, null, null);
end
$$;

-- Suspension ou réactivation d'une organisation (ADM-3).
create or replace function app.set_org_status(p_org uuid, p_status text, p_actor uuid) returns void
language plpgsql
as $$
declare
  v_before text;
begin
  perform app.require_staff(p_actor, true);
  select status into v_before from public.organizations where id = p_org for update;
  if v_before is null then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;
  update public.organizations set status = p_status where id = p_org;
  perform app.audit('staff', p_actor::text, 'set_org_status', 'organization', p_org::text,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
end
$$;

-- Accès offert (geste commercial, support) : une période de l'offre, sans paiement.
create or replace function app.grant_period(p_org uuid, p_plan_code text, p_actor uuid) returns uuid
language plpgsql
as $$
declare
  v_plan uuid;
  v_sub uuid;
begin
  perform app.require_staff(p_actor, true);
  select p.id into v_plan from public.plans p join public.organizations o on o.currency_code = p.currency_code
  where o.id = p_org and p.code = p_plan_code and p.active;
  if v_plan is null then
    raise exception 'offre indisponible dans la devise de l''organisation' using errcode = 'P0002';
  end if;
  v_sub := app.start_paid_period(p_org, v_plan, 'grant');
  perform app.audit('staff', p_actor::text, 'grant_period', 'organization', p_org::text, null,
    jsonb_build_object('plan_code', p_plan_code, 'subscription_id', v_sub));
  return v_sub;
end
$$;

-- Membre de l'équipe par e-mail (compte Neon Auth existant).
create or replace function app.grant_staff_by_email(p_email text, p_role text, p_actor uuid) returns void
language plpgsql
as $$
declare
  v_user uuid;
begin
  execute 'select id from neon_auth."user" where lower(email) = lower($1)' into v_user using p_email;
  if v_user is null then
    raise exception 'aucun compte avec cet e-mail : la personne doit d''abord créer son compte' using errcode = 'P0002';
  end if;
  perform app.grant_staff(v_user, p_role, p_actor);
end
$$;
