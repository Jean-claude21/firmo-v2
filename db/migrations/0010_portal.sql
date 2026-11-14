-- 0010 — Espace artisan (spec 005 : ART-2, ART-4, ART-5).

-- Profil et en-tête (ART-5). Seuls les champs connus sont acceptés ; les identifiants légaux sont
-- ceux du pays. Le pays (donc la devise) ne change plus après un premier document émis.
create or replace function app.update_profile(p_org uuid, p_patch jsonb) returns void
language plpgsql
as $$
declare
  v_before public.organizations;
  v_after public.organizations;
  v_country text;
  v_unknown text;
  v_legal jsonb;
begin
  select * into v_before from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(p_patch) k
  where k not in ('name', 'trade_code', 'country_code', 'locale', 'phone', 'email', 'address', 'legal_ids',
                  'tax_registered', 'tax_code', 'brand_color', 'template_code', 'payment_methods', 'footer_note');
  if v_unknown is not null then
    raise exception 'champs inconnus : %', v_unknown using errcode = '22023';
  end if;

  v_country := coalesce(p_patch ->> 'country_code', v_before.country_code);
  if v_country <> v_before.country_code then
    if exists (select 1 from public.documents where org_id = p_org and status <> 'draft') then
      raise exception 'pays verrouillé après le premier document émis' using errcode = '42501';
    end if;
    if not exists (select 1 from public.countries where code = v_country and active) then
      raise exception 'pays inconnu' using errcode = '22023';
    end if;
  end if;

  -- Identifiants légaux : uniquement ceux du pays, valeurs nettoyées, vides retirées.
  if p_patch ? 'legal_ids' then
    select coalesce(jsonb_object_agg(e.key, btrim(e.value #>> '{}')), '{}') into v_legal
    from jsonb_each(p_patch -> 'legal_ids') e
    where e.key in (select li ->> 'code' from public.countries c, jsonb_array_elements(c.legal_ids) li where c.code = v_country)
      and btrim(coalesce(e.value #>> '{}', '')) <> ''
      and length(e.value #>> '{}') <= 80;
  end if;

  update public.organizations o set
    name = case when p_patch ? 'name' then nullif(btrim(p_patch ->> 'name'), '') else o.name end,
    trade_code = case when p_patch ? 'trade_code' then nullif(p_patch ->> 'trade_code', '') else o.trade_code end,
    country_code = v_country,
    currency_code = case when v_country <> o.country_code then (select currency_code from public.countries where code = v_country) else o.currency_code end,
    locale = coalesce(nullif(p_patch ->> 'locale', ''), o.locale),
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else o.phone end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else o.email end,
    address = case when p_patch ? 'address' then nullif(btrim(p_patch ->> 'address'), '') else o.address end,
    legal_ids = coalesce(v_legal, case when v_country <> o.country_code then '{}'::jsonb else o.legal_ids end),
    tax_registered = coalesce((p_patch ->> 'tax_registered')::boolean, o.tax_registered),
    tax_code = case when p_patch ? 'tax_code' then nullif(p_patch ->> 'tax_code', '') else o.tax_code end,
    brand_color = coalesce(nullif(p_patch ->> 'brand_color', ''), o.brand_color),
    template_code = coalesce(nullif(p_patch ->> 'template_code', ''), o.template_code),
    payment_methods = case when p_patch ? 'payment_methods' then nullif(btrim(p_patch ->> 'payment_methods'), '') else o.payment_methods end,
    footer_note = case when p_patch ? 'footer_note' then nullif(btrim(p_patch ->> 'footer_note'), '') else o.footer_note end
  where o.id = p_org
  returning * into v_after;

  if v_after.tax_code is not null and not exists (
    select 1 from public.taxes where country_code = v_after.country_code and code = v_after.tax_code and active
  ) then
    raise exception 'taxe inconnue pour ce pays' using errcode = '22023';
  end if;
  perform app.audit('org', p_org::text, 'update_profile', 'organization', p_org::text,
    to_jsonb(v_before) - 'created_at' - 'updated_at', to_jsonb(v_after) - 'created_at' - 'updated_at');
end
$$;

create or replace function app.set_logo(p_org uuid, p_key text) returns void
language sql
as $$
  update public.organizations set logo_key = p_key where id = p_org
$$;

-- Client de l'organisation (ART-4) : création ou modification.
create or replace function app.save_client(p_org uuid, p_id uuid, p_patch jsonb) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.clients (org_id, name, phone, email, address, legal_id)
    values (p_org, btrim(p_patch ->> 'name'), nullif(btrim(p_patch ->> 'phone'), ''), nullif(btrim(p_patch ->> 'email'), ''),
            nullif(btrim(p_patch ->> 'address'), ''), nullif(btrim(p_patch ->> 'legal_id'), ''))
    returning id into v_id;
    return v_id;
  end if;
  update public.clients c set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), c.name),
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else c.phone end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else c.email end,
    address = case when p_patch ? 'address' then nullif(btrim(p_patch ->> 'address'), '') else c.address end,
    legal_id = case when p_patch ? 'legal_id' then nullif(btrim(p_patch ->> 'legal_id'), '') else c.legal_id end
  where c.id = p_id and c.org_id = p_org
  returning c.id into v_id;
  if v_id is null then
    raise exception 'client introuvable' using errcode = 'P0002';
  end if;
  return v_id;
end
$$;

-- Tableau de bord de l'artisan (ART-2) : mois en cours, dans la devise de l'organisation.
create or replace function app.org_dashboard(p_org uuid) returns jsonb
language sql stable
as $$
  with month as (select date_trunc('month', now()) as start)
  select jsonb_build_object(
    'issued_this_month', (select count(*) from public.documents d, month
                          where d.org_id = p_org and d.issued_at >= month.start and d.type_code <> 'receipt'),
    'drafts', (select count(*) from public.documents where org_id = p_org and status = 'draft'),
    'quotes_pending', (select count(*) from public.documents d join public.document_types t on t.code = d.type_code
                       where d.org_id = p_org and t.acceptable and d.status = 'issued'),
    'quotes_pending_minor', (select coalesce(sum(d.total_minor), 0) from public.documents d join public.document_types t on t.code = d.type_code
                             where d.org_id = p_org and t.acceptable and d.status = 'issued'),
    'invoiced_this_month_minor', (select coalesce(sum(d.total_minor), 0) from public.documents d join public.document_types t on t.code = d.type_code, month
                                  where d.org_id = p_org and t.payable and d.status in ('issued', 'partially_paid', 'paid') and d.issued_at >= month.start),
    'collected_this_month_minor', (select coalesce(sum(p.amount_minor), 0) from public.document_payments p
                                   join public.documents d on d.id = p.document_id, month
                                   where d.org_id = p_org and p.paid_on >= month.start::date),
    'outstanding_minor', (select coalesce(sum(d.total_minor - d.paid_minor), 0) from public.documents d join public.document_types t on t.code = d.type_code
                          where d.org_id = p_org and t.payable and d.status in ('issued', 'partially_paid')),
    'clients', (select count(*) from public.clients where org_id = p_org)
  )
$$;
