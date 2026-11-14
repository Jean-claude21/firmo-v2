-- 0007 — Documents (spec 002 : DOC-3, DOC-4, DOC-6, DOC-7, OFF-2).
-- Règles : montants entiers en unités mineures ; quantités numeric(14,3) ; totaux, taxes,
-- numérotation et transitions décidés ici. Firmo ne fixe jamais une valeur : il calcule à partir
-- de ce que l'artisan a dit (constitution II).

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  phone text check (phone is null or length(phone) <= 32),
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address text check (address is null or length(address) <= 300),
  legal_id text check (legal_id is null or length(legal_id) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index clients_org_name on public.clients (org_id, lower(btrim(name)));
create trigger clients_updated_at before update on public.clients
  for each row execute function app.set_updated_at();

-- Mémoire de l'artisan : désignations et unités habituelles, jamais de prix (DOC-7).
create table public.memory_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 300),
  unit_code text references public.units (code),
  uses integer not null default 1,
  last_used_at timestamptz not null default now()
);
create unique index memory_items_org_label on public.memory_items (org_id, lower(btrim(label)));

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  type_code text not null references public.document_types (code),
  status text not null default 'draft'
    check (status in ('draft', 'issued', 'accepted', 'refused', 'partially_paid', 'paid', 'cancelled', 'replaced')),
  number text,
  number_year integer,
  number_seq integer,
  client_id uuid references public.clients (id) on delete set null,
  client_snapshot jsonb,
  issuer_snapshot jsonb,
  currency_code char(3) not null references public.currencies (code),
  locale text not null,
  template_code text not null references public.templates (code),
  title text check (title is null or length(title) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  issue_date date,
  valid_until date,
  -- Remise : en points de base OU en montant, jamais les deux (décidée par l'artisan).
  discount_bp integer check (discount_bp is null or discount_bp between 1 and 10000),
  discount_minor bigint check (discount_minor is null or discount_minor > 0),
  apply_tax boolean not null default false,
  tax_code text,
  tax_label text,
  tax_rate_bp integer not null default 0 check (tax_rate_bp between 0 and 10000),
  subtotal_minor bigint not null default 0,
  discount_total_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  -- Document d'origine : devis → facture, facture → reçu.
  source_document_id uuid references public.documents (id),
  -- Révision : le nouveau brouillon remplace l'original à son émission.
  revises_id uuid references public.documents (id),
  -- Canal ou surface qui a créé le brouillon (lecture IA, saisie web…).
  origin text not null default 'chat' check (origin in ('chat', 'web', 'system')),
  share_token_hash bytea unique check (share_token_hash is null or length(share_token_hash) = 32),
  share_expires_at timestamptz,
  shared_at timestamptz,
  viewed_at timestamptz,
  decided_at timestamptz,
  decision_by text check (decision_by is null or decision_by in ('org', 'client')),
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  render_version integer not null default 0,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_bp is null or discount_minor is null),
  check ((status = 'draft') = (number is null))
);
create unique index documents_org_number on public.documents (org_id, number) where number is not null;
create index documents_org_created on public.documents (org_id, created_at desc);
create index documents_org_status on public.documents (org_id, status);
create trigger documents_updated_at before update on public.documents
  for each row execute function app.set_updated_at();

create table public.document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position integer not null check (position >= 1),
  label text not null check (length(btrim(label)) between 1 and 300),
  -- Null : valeur manquante, à demander à l'artisan. Jamais devinée.
  quantity numeric(14, 3) check (quantity is null or quantity > 0),
  unit_code text references public.units (code),
  unit_price_minor bigint check (unit_price_minor is null or unit_price_minor >= 0),
  line_total_minor bigint generated always as (
    case when quantity is not null and unit_price_minor is not null
      then round(quantity * unit_price_minor)::bigint end
  ) stored,
  -- Valeurs lues mais incertaines : {label, quantity, unit_price}.
  to_confirm text[] not null default '{}'
    check (to_confirm <@ array['label', 'quantity', 'unit', 'unit_price']::text[]),
  source text not null default 'typed' check (source in ('read', 'typed')),
  unique (document_id, position) deferrable initially deferred
);

create table public.number_counters (
  org_id uuid not null references public.organizations (id) on delete cascade,
  type_code text not null references public.document_types (code),
  year integer not null,
  last_seq integer not null default 0,
  primary key (org_id, type_code, year)
);

create table public.document_payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  amount_minor bigint not null check (amount_minor > 0),
  paid_on date not null default current_date,
  method text check (method is null or length(method) <= 80),
  note text check (note is null or length(note) <= 300),
  receipt_id uuid references public.documents (id),
  created_at timestamptz not null default now()
);
create index document_payments_document on public.document_payments (document_id);

alter table public.clients enable row level security;
alter table public.memory_items enable row level security;
alter table public.documents enable row level security;
alter table public.document_lines enable row level security;
alter table public.number_counters enable row level security;
alter table public.document_payments enable row level security;

-- ---------------------------------------------------------------- garde d'immuabilité

-- Un document émis ne change plus : seuls son statut, son suivi (partage, décision, paiements)
-- et sa version de rendu évoluent (constitution V).
create or replace function app.guard_issued_document() returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' and (
    (to_jsonb(old) - array['status','paid_minor','share_token_hash','share_expires_at','shared_at',
      'viewed_at','decided_at','decision_by','decision_note','render_version','updated_at'])
    is distinct from
    (to_jsonb(new) - array['status','paid_minor','share_token_hash','share_expires_at','shared_at',
      'viewed_at','decided_at','decision_by','decision_note','render_version','updated_at'])
  ) then
    raise exception 'document émis : il ne se modifie plus (créer une révision)' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger documents_guard_issued before update on public.documents
  for each row execute function app.guard_issued_document();

create or replace function app.guard_issued_lines() returns trigger
language plpgsql
as $$
declare
  v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  if (select status from public.documents where id = v_doc) is distinct from 'draft' then
    raise exception 'document émis : ses lignes ne se modifient plus' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger document_lines_guard before insert or update or delete on public.document_lines
  for each row execute function app.guard_issued_lines();

-- ---------------------------------------------------------------- totaux

-- Totaux d'un brouillon (DOC-4). Arrondi au plus proche, demi vers le haut (round numeric).
create or replace function app.recompute_document(p_doc uuid) returns void
language plpgsql
as $$
declare
  v_doc public.documents;
  v_subtotal bigint;
  v_discount bigint;
  v_tax bigint;
begin
  select * into v_doc from public.documents where id = p_doc;
  if not found or v_doc.status <> 'draft' then
    return;
  end if;
  select coalesce(sum(line_total_minor), 0) into v_subtotal
  from public.document_lines where document_id = p_doc;
  v_discount := case
    when v_doc.discount_bp is not null then round(v_subtotal * v_doc.discount_bp / 10000.0)::bigint
    when v_doc.discount_minor is not null then least(v_doc.discount_minor, v_subtotal)
    else 0 end;
  v_tax := case when v_doc.apply_tax and v_doc.tax_rate_bp > 0
    then round((v_subtotal - v_discount) * v_doc.tax_rate_bp / 10000.0)::bigint else 0 end;
  update public.documents
  set subtotal_minor = v_subtotal,
      discount_total_minor = v_discount,
      tax_minor = v_tax,
      total_minor = v_subtotal - v_discount + v_tax
  where id = p_doc;
end
$$;

create or replace function app.lines_changed() returns trigger
language plpgsql
as $$
begin
  perform app.recompute_document(coalesce(new.document_id, old.document_id));
  return null;
end
$$;
create trigger document_lines_recompute after insert or update or delete on public.document_lines
  for each row execute function app.lines_changed();

create or replace function app.document_settings_changed() returns trigger
language plpgsql
as $$
begin
  if new.status = 'draft' and (
    new.discount_bp is distinct from old.discount_bp or new.discount_minor is distinct from old.discount_minor
    or new.apply_tax is distinct from old.apply_tax or new.tax_rate_bp is distinct from old.tax_rate_bp
  ) then
    perform app.recompute_document(new.id);
  end if;
  return null;
end
$$;
create trigger documents_recompute after update on public.documents
  for each row execute function app.document_settings_changed();

-- ---------------------------------------------------------------- brouillons

-- Document d'une organisation, verrouillé ; refus explicite s'il n'est pas à elle.
create or replace function app.lock_document(p_org uuid, p_doc uuid) returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents where id = p_doc for update;
  if not found or v_doc.org_id <> p_org then
    raise exception 'document introuvable' using errcode = 'P0002';
  end if;
  return v_doc;
end
$$;

create or replace function app.lock_draft(p_org uuid, p_doc uuid) returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
begin
  if v_doc.status <> 'draft' then
    raise exception 'document émis : créer une révision pour le modifier' using errcode = '42501';
  end if;
  return v_doc;
end
$$;

-- Ligne JSON → valeurs typées. Les montants arrivent déjà en unités mineures (entiers).
create or replace function app.insert_lines(p_doc uuid, p_lines jsonb, p_first_position integer default 1)
returns void
language plpgsql
as $$
declare
  v_line jsonb;
  v_pos integer := p_first_position;
begin
  if jsonb_typeof(coalesce(p_lines, '[]')) <> 'array' then
    raise exception 'lignes : tableau attendu' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    insert into public.document_lines
      (document_id, position, label, quantity, unit_code, unit_price_minor, to_confirm, source)
    values (
      p_doc, v_pos,
      btrim(v_line ->> 'label'),
      nullif(v_line ->> 'quantity', '')::numeric,
      nullif(v_line ->> 'unit', ''),
      nullif(v_line ->> 'unit_price_minor', '')::bigint,
      coalesce(array(select jsonb_array_elements_text(coalesce(v_line -> 'to_confirm', '[]'))), '{}'),
      coalesce(v_line ->> 'source', 'typed')
    );
    v_pos := v_pos + 1;
  end loop;
end
$$;

create or replace function app.create_draft(
  p_org uuid, p_type text, p_lines jsonb, p_origin text default 'chat', p_title text default null
) returns uuid
language plpgsql
as $$
declare
  v_org public.organizations;
  v_type public.document_types;
  v_tax public.taxes;
  v_id uuid;
begin
  select * into v_org from public.organizations where id = p_org;
  if not found then
    raise exception 'organisation introuvable' using errcode = 'P0002';
  end if;
  if v_org.status <> 'active' then
    raise exception 'organisation suspendue' using errcode = '42501';
  end if;
  select * into v_type from public.document_types where code = p_type and active;
  if not found or p_type = 'receipt' then
    raise exception 'type de document non disponible : %', p_type using errcode = '22023';
  end if;
  if v_org.tax_registered then
    select * into v_tax from public.taxes t
    where t.country_code = v_org.country_code and t.active
      and (t.code = v_org.tax_code or (v_org.tax_code is null and t.is_default))
    order by (t.code = v_org.tax_code) desc
    limit 1;
  end if;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, title, origin,
    apply_tax, tax_code, tax_label, tax_rate_bp)
  values (p_org, p_type, v_org.currency_code, v_org.locale, v_org.template_code, p_title, p_origin,
    v_tax.id is not null, v_tax.code, app.label(v_tax.labels, v_org.locale), coalesce(v_tax.rate_bp, 0))
  returning id into v_id;
  perform app.insert_lines(v_id, p_lines);
  return v_id;
end
$$;

-- Remplace toutes les lignes d'un brouillon.
create or replace function app.set_lines(p_org uuid, p_doc uuid, p_lines jsonb) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_lines where document_id = p_doc;
  perform app.insert_lines(p_doc, p_lines);
end
$$;

create or replace function app.add_lines(p_org uuid, p_doc uuid, p_lines jsonb) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  perform app.insert_lines(p_doc, p_lines,
    coalesce((select max(position) from public.document_lines where document_id = p_doc), 0) + 1);
end
$$;

-- Corrige une ligne (DOC-2). Une valeur corrigée n'est plus « à confirmer ». Si la valeur lue
-- par l'IA change, `reading_corrected` mesure la fidélité de lecture.
create or replace function app.patch_line(p_org uuid, p_doc uuid, p_position integer, p_patch jsonb)
returns void
language plpgsql
as $$
declare
  v_line public.document_lines;
  v_field text;
  v_fields text[] := array[]::text[];
begin
  perform app.lock_draft(p_org, p_doc);
  select * into v_line from public.document_lines where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'ligne % introuvable', p_position using errcode = 'P0002';
  end if;
  if p_patch ? 'label' then
    if btrim(p_patch ->> 'label') is distinct from v_line.label then v_fields := v_fields || 'label'::text; end if;
  end if;
  if p_patch ? 'quantity' then
    if nullif(p_patch ->> 'quantity', '')::numeric is distinct from v_line.quantity then v_fields := v_fields || 'quantity'::text; end if;
  end if;
  if p_patch ? 'unit' then
    if nullif(p_patch ->> 'unit', '') is distinct from v_line.unit_code then v_fields := v_fields || 'unit'::text; end if;
  end if;
  if p_patch ? 'unit_price_minor' then
    if nullif(p_patch ->> 'unit_price_minor', '')::bigint is distinct from v_line.unit_price_minor then v_fields := v_fields || 'unit_price'::text; end if;
  end if;

  update public.document_lines
  set label = case when p_patch ? 'label' then btrim(p_patch ->> 'label') else label end,
      quantity = case when p_patch ? 'quantity' then nullif(p_patch ->> 'quantity', '')::numeric else quantity end,
      unit_code = case when p_patch ? 'unit' then nullif(p_patch ->> 'unit', '') else unit_code end,
      unit_price_minor = case when p_patch ? 'unit_price_minor' then nullif(p_patch ->> 'unit_price_minor', '')::bigint else unit_price_minor end,
      to_confirm = array(
        select f from unnest(to_confirm) f
        where not (
          (f = 'label' and p_patch ? 'label') or (f = 'quantity' and p_patch ? 'quantity')
          or (f = 'unit' and p_patch ? 'unit') or (f = 'unit_price' and p_patch ? 'unit_price_minor')
        )
      )
  where id = v_line.id;

  if v_line.source = 'read' then
    foreach v_field in array v_fields loop
      perform app.emit('reading_corrected', p_org, jsonb_build_object('field', v_field));
    end loop;
  end if;
end
$$;

create or replace function app.remove_line(p_org uuid, p_doc uuid, p_position integer) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_lines where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'ligne % introuvable', p_position using errcode = 'P0002';
  end if;
  update public.document_lines set position = position - 1
  where document_id = p_doc and position > p_position;
end
$$;

-- Réglages d'un brouillon : type, objet, notes, remise, taxe.
create or replace function app.update_draft(p_org uuid, p_doc uuid, p_patch jsonb) returns void
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_draft(p_org, p_doc);
begin
  if p_patch ? 'type' and not exists (
    select 1 from public.document_types where code = p_patch ->> 'type' and active and code <> 'receipt'
  ) then
    raise exception 'type de document non disponible' using errcode = '22023';
  end if;
  if (p_patch ? 'discount_bp') and (p_patch ? 'discount_minor')
     and p_patch ->> 'discount_bp' is not null and p_patch ->> 'discount_minor' is not null then
    raise exception 'remise : pourcentage ou montant, pas les deux' using errcode = '22023';
  end if;
  update public.documents set
    type_code = coalesce(p_patch ->> 'type', type_code),
    title = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
    notes = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else notes end,
    discount_bp = case
      when p_patch ? 'discount_bp' then nullif(p_patch ->> 'discount_bp', '')::int
      when p_patch ? 'discount_minor' then null else discount_bp end,
    discount_minor = case
      when p_patch ? 'discount_minor' then nullif(p_patch ->> 'discount_minor', '')::bigint
      when p_patch ? 'discount_bp' then null else discount_minor end,
    apply_tax = case when p_patch ? 'apply_tax' then (p_patch ->> 'apply_tax')::boolean and tax_rate_bp > 0 else apply_tax end,
    template_code = coalesce(p_patch ->> 'template', template_code)
  where id = v_doc.id;
end
$$;

-- Client d'un brouillon : retrouvé par son nom dans l'organisation, sinon créé.
create or replace function app.set_document_client(p_org uuid, p_doc uuid, p_name text, p_details jsonb default '{}')
returns uuid
language plpgsql
as $$
declare
  v_client uuid;
begin
  perform app.lock_draft(p_org, p_doc);
  if p_name is null or btrim(p_name) = '' then
    update public.documents set client_id = null where id = p_doc;
    return null;
  end if;
  insert into public.clients (org_id, name, phone, email, address, legal_id)
  values (p_org, btrim(p_name), p_details ->> 'phone', p_details ->> 'email', p_details ->> 'address', p_details ->> 'legal_id')
  on conflict (org_id, lower(btrim(name))) do update set
    phone = coalesce(excluded.phone, public.clients.phone),
    email = coalesce(excluded.email, public.clients.email),
    address = coalesce(excluded.address, public.clients.address),
    legal_id = coalesce(excluded.legal_id, public.clients.legal_id)
  returning id into v_client;
  update public.documents set client_id = v_client where id = p_doc;
  return v_client;
end
$$;

-- ---------------------------------------------------------------- émission

-- Ce qui manque pour émettre (affiché ou demandé dans le chat).
create or replace function app.issue_blockers(p_org uuid, p_doc uuid) returns text[]
language sql stable
as $$
  select array_remove(array[
    case when not exists (select 1 from public.document_lines where document_id = p_doc) then 'no_lines' end,
    case when exists (select 1 from public.document_lines where document_id = p_doc and quantity is null) then 'missing_quantity' end,
    case when exists (select 1 from public.document_lines where document_id = p_doc and unit_price_minor is null) then 'missing_price' end,
    case when (select name from public.organizations where id = p_org) is null then 'missing_business_name' end
  ], null)
$$;

create or replace function app.issuer_snapshot(p_org uuid) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'name', o.name, 'phone', o.phone, 'email', o.email, 'address', o.address,
    'country', app.label(c.labels, o.locale),
    'trade', app.label(t.labels, o.locale),
    'legal_ids', coalesce((
      select jsonb_agg(jsonb_build_object('label', app.label(li -> 'labels', o.locale), 'value', o.legal_ids ->> (li ->> 'code')))
      from jsonb_array_elements(c.legal_ids) li
      where coalesce(o.legal_ids ->> (li ->> 'code'), '') <> ''
    ), '[]'),
    'payment_methods', o.payment_methods, 'footer_note', o.footer_note,
    'brand_color', o.brand_color, 'logo_key', o.logo_key
  )
  from public.organizations o
  join public.countries c on c.code = o.country_code
  left join public.trades t on t.code = o.trade_code
  where o.id = p_org
$$;

-- Émission interne : numéro sans trou, figeage, quota si demandé.
create or replace function app.issue_internal(p_doc uuid, p_consume boolean) returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents;
  v_type public.document_types;
  v_year integer := extract(year from current_date)::int;
  v_seq integer;
  v_blockers text[];
begin
  select * into v_doc from public.documents where id = p_doc for update;
  if v_doc.status <> 'draft' then
    raise exception 'document déjà émis' using errcode = '42501';
  end if;
  v_blockers := app.issue_blockers(v_doc.org_id, p_doc);
  if cardinality(v_blockers) > 0 then
    raise exception 'émission impossible : %', array_to_string(v_blockers, ', ')
      using errcode = 'P0001', hint = array_to_string(v_blockers, ',');
  end if;
  select * into v_type from public.document_types where code = v_doc.type_code;
  if p_consume and v_type.counts_quota then
    perform app.consume_unit(v_doc.org_id);
  end if;

  insert into public.number_counters (org_id, type_code, year, last_seq)
  values (v_doc.org_id, v_doc.type_code, v_year, 1)
  on conflict (org_id, type_code, year) do update set last_seq = public.number_counters.last_seq + 1
  returning last_seq into v_seq;

  update public.document_lines set to_confirm = '{}' where document_id = p_doc and to_confirm <> '{}';

  update public.documents d set
    status = 'issued',
    number = v_type.number_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0'),
    number_year = v_year,
    number_seq = v_seq,
    issue_date = current_date,
    valid_until = case when v_type.validity_days is not null then current_date + v_type.validity_days end,
    issuer_snapshot = app.issuer_snapshot(v_doc.org_id),
    client_snapshot = (select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email,
                         'address', c.address, 'legal_id', c.legal_id)
                       from public.clients c where c.id = v_doc.client_id),
    render_version = 1,
    issued_at = now()
  where d.id = p_doc
  returning * into v_doc;

  -- Mémoire : désignations et unités, jamais les prix.
  insert into public.memory_items (org_id, label, unit_code)
  select v_doc.org_id, btrim(l.label), l.unit_code from public.document_lines l where l.document_id = p_doc
  on conflict (org_id, lower(btrim(label))) do update set
    uses = public.memory_items.uses + 1, last_used_at = now(),
    unit_code = coalesce(excluded.unit_code, public.memory_items.unit_code);

  perform app.enqueue_job('render_document', jsonb_build_object('document_id', p_doc, 'version', 1),
    'render:' || p_doc || ':1');
  perform app.emit('document_issued', v_doc.org_id, jsonb_build_object(
    'doc_type', v_doc.type_code, 'template', v_doc.template_code,
    'lines', (select count(*) from public.document_lines where document_id = p_doc),
    'currency_code', v_doc.currency_code));
  return v_doc;
end
$$;

-- Émission par l'artisan (DOC-5). Une révision ne consomme pas d'unité et remplace l'original.
create or replace function app.issue_document(p_org uuid, p_doc uuid) returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_draft(p_org, p_doc);
  v_issued public.documents;
begin
  v_issued := app.issue_internal(p_doc, v_doc.revises_id is null);
  if v_doc.revises_id is not null then
    update public.documents set status = 'replaced'
    where id = v_doc.revises_id and status in ('issued', 'accepted', 'refused');
  end if;
  return v_issued;
end
$$;

-- Révision d'un document émis : nouveau brouillon identique (DOC-2 après émission).
create or replace function app.revise_document(p_org uuid, p_doc uuid) returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_new uuid;
begin
  if v_doc.status not in ('issued', 'accepted', 'refused') then
    raise exception 'seul un document émis non payé se révise' using errcode = '42501';
  end if;
  if exists (select 1 from public.documents d where d.revises_id = p_doc and d.status = 'draft') then
    return (select d.id from public.documents d where d.revises_id = p_doc and d.status = 'draft' limit 1);
  end if;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, title, notes,
    client_id, discount_bp, discount_minor, apply_tax, tax_code, tax_label, tax_rate_bp,
    source_document_id, revises_id, origin)
  select org_id, type_code, currency_code, locale, template_code, title, notes,
    client_id, discount_bp, discount_minor, apply_tax, tax_code, tax_label, tax_rate_bp,
    source_document_id, id, origin
  from public.documents where id = p_doc
  returning id into v_new;
  insert into public.document_lines (document_id, position, label, quantity, unit_code, unit_price_minor, source)
  select v_new, position, label, quantity, unit_code, unit_price_minor, 'typed'
  from public.document_lines where document_id = p_doc;
  return v_new;
end
$$;

-- Devis ou proforma → facture (DOC-6). Nouveau brouillon lié à l'original.
create or replace function app.convert_document(p_org uuid, p_doc uuid, p_type text default 'invoice')
returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_new uuid;
begin
  if v_doc.type_code not in (select code from public.document_types where acceptable)
     or v_doc.status not in ('issued', 'accepted') then
    raise exception 'seul un devis émis ou accepté se convertit' using errcode = '42501';
  end if;
  if not exists (select 1 from public.document_types where code = p_type and payable and active) then
    raise exception 'type cible invalide' using errcode = '22023';
  end if;
  select d.id into v_new from public.documents d
  where d.source_document_id = p_doc and d.type_code = p_type and d.status <> 'cancelled'
  limit 1;
  if v_new is not null then
    return v_new;
  end if;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, title, notes,
    client_id, discount_bp, discount_minor, apply_tax, tax_code, tax_label, tax_rate_bp,
    source_document_id, origin)
  select org_id, p_type, currency_code, locale, template_code, title, notes,
    client_id, discount_bp, discount_minor, apply_tax, tax_code, tax_label, tax_rate_bp, id, origin
  from public.documents where id = p_doc
  returning id into v_new;
  insert into public.document_lines (document_id, position, label, quantity, unit_code, unit_price_minor, source)
  select v_new, position, label, quantity, unit_code, unit_price_minor, 'typed'
  from public.document_lines where document_id = p_doc;
  perform app.emit('quote_converted', p_org, '{}');
  return v_new;
end
$$;

-- Annulation : un brouillon est supprimé ; un document émis sans paiement est annulé.
create or replace function app.cancel_document(p_org uuid, p_doc uuid) returns void
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
begin
  if v_doc.status = 'draft' then
    delete from public.documents where id = p_doc;
  elsif v_doc.status in ('issued', 'accepted', 'refused') and v_doc.paid_minor = 0 then
    update public.documents set status = 'cancelled' where id = p_doc;
  else
    raise exception 'document payé ou déjà clos : annulation impossible' using errcode = '42501';
  end if;
end
$$;

-- ---------------------------------------------------------------- suivi

create or replace function app.decide_internal(p_doc public.documents, p_decision text, p_by text, p_note text)
returns void
language plpgsql
as $$
begin
  if p_decision not in ('accepted', 'refused') then
    raise exception 'décision invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from public.document_types where code = p_doc.type_code and acceptable) then
    raise exception 'ce document ne s''accepte pas' using errcode = '42501';
  end if;
  if p_doc.status <> 'issued' then
    raise exception 'décision déjà prise ou document clos' using errcode = '42501';
  end if;
  if p_by = 'client' and p_doc.valid_until is not null and p_doc.valid_until < current_date then
    raise exception 'devis expiré' using errcode = '42501';
  end if;
  update public.documents set status = p_decision, decided_at = now(), decision_by = p_by,
    decision_note = nullif(btrim(p_note), '')
  where id = p_doc.id;
  perform app.emit(case p_decision when 'accepted' then 'quote_accepted' else 'quote_refused' end,
    p_doc.org_id, jsonb_build_object('by', p_by));
end
$$;

-- L'artisan note la réponse de son client (chat ou web).
create or replace function app.decide_document(p_org uuid, p_doc uuid, p_decision text, p_note text default null)
returns void
language plpgsql
as $$
begin
  perform app.decide_internal(app.lock_document(p_org, p_doc), p_decision, 'org', p_note);
end
$$;

-- Lien de partage (ART-7) : empreinte du jeton, durée en réglage. Remplace l'ancien lien.
create or replace function app.share_document(p_org uuid, p_doc uuid, p_token_hash bytea)
returns timestamptz
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_expires timestamptz := now() + make_interval(days => (app.setting('share_link_days') #>> '{}')::int);
begin
  if v_doc.status in ('draft', 'cancelled', 'replaced') then
    raise exception 'seul un document émis se partage' using errcode = '42501';
  end if;
  update public.documents set share_token_hash = p_token_hash, share_expires_at = v_expires where id = p_doc;
  return v_expires;
end
$$;

-- Le document a été envoyé au client (PDF ou lien), par le chat ou le web.
create or replace function app.mark_shared(p_org uuid, p_doc uuid, p_via text) returns void
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
begin
  if v_doc.status in ('draft', 'cancelled', 'replaced') then
    raise exception 'seul un document émis se partage' using errcode = '42501';
  end if;
  update public.documents set shared_at = coalesce(shared_at, now()) where id = p_doc;
  perform app.emit('document_shared', p_org, jsonb_build_object('doc_type', v_doc.type_code, 'via', p_via));
end
$$;

-- Document public par jeton : consultation (première vue mesurée).
create or replace function app.document_by_share(p_token_hash bytea) returns uuid
language plpgsql
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents
  where share_token_hash = p_token_hash and share_expires_at > now()
    and status not in ('draft', 'cancelled', 'replaced');
  if not found then
    raise exception 'lien invalide ou expiré' using errcode = 'P0002';
  end if;
  if v_doc.viewed_at is null then
    update public.documents set viewed_at = now() where id = v_doc.id;
    perform app.emit('document_viewed', v_doc.org_id, jsonb_build_object('doc_type', v_doc.type_code));
  end if;
  return v_doc.id;
end
$$;

-- Réponse du client par le lien.
create or replace function app.client_decision(p_token_hash bytea, p_decision text, p_note text default null)
returns uuid
language plpgsql
as $$
declare
  v_doc public.documents;
begin
  select * into v_doc from public.documents
  where share_token_hash = p_token_hash and share_expires_at > now()
  for update;
  if not found then
    raise exception 'lien invalide ou expiré' using errcode = 'P0002';
  end if;
  perform app.decide_internal(v_doc, p_decision, 'client', p_note);
  return v_doc.id;
end
$$;

-- Paiement noté par l'artisan (DOC-6). Firmo n'encaisse rien (décision 0003).
create or replace function app.record_payment(
  p_org uuid, p_doc uuid, p_amount bigint, p_paid_on date default current_date,
  p_method text default null, p_note text default null
) returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_id uuid;
  v_paid bigint;
begin
  if not exists (select 1 from public.document_types where code = v_doc.type_code and payable) then
    raise exception 'les paiements se notent sur une facture' using errcode = '42501';
  end if;
  if v_doc.status not in ('issued', 'partially_paid') then
    raise exception 'facture non émise, soldée ou annulée' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'montant invalide' using errcode = '22023';
  end if;
  if v_doc.paid_minor + p_amount > v_doc.total_minor then
    raise exception 'le paiement dépasse le reste à payer' using errcode = '22023';
  end if;
  insert into public.document_payments (document_id, amount_minor, paid_on, method, note)
  values (p_doc, p_amount, coalesce(p_paid_on, current_date), nullif(btrim(p_method), ''), nullif(btrim(p_note), ''))
  returning id into v_id;
  v_paid := v_doc.paid_minor + p_amount;
  update public.documents
  set paid_minor = v_paid, status = case when v_paid = total_minor then 'paid' else 'partially_paid' end
  where id = p_doc;
  perform app.emit('payment_recorded', p_org, jsonb_build_object('partial', v_paid < v_doc.total_minor));
  return v_id;
end
$$;

-- Reçu d'un paiement noté : émis aussitôt, sans consommer d'unité.
create or replace function app.issue_receipt(p_org uuid, p_payment uuid) returns uuid
language plpgsql
as $$
declare
  v_payment public.document_payments;
  v_invoice public.documents;
  v_receipt uuid;
begin
  select * into v_payment from public.document_payments where id = p_payment for update;
  if not found then
    raise exception 'paiement introuvable' using errcode = 'P0002';
  end if;
  v_invoice := app.lock_document(p_org, v_payment.document_id);
  if v_payment.receipt_id is not null then
    return v_payment.receipt_id;
  end if;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, client_id,
    source_document_id, origin, title, notes)
  values (p_org, 'receipt', v_invoice.currency_code, v_invoice.locale, v_invoice.template_code,
    v_invoice.client_id, v_invoice.id, 'system', v_invoice.number, v_payment.method)
  returning id into v_receipt;
  insert into public.document_lines (document_id, position, label, quantity, unit_code, unit_price_minor)
  values (v_receipt, 1, v_invoice.number, 1, null, v_payment.amount_minor);
  perform app.issue_internal(v_receipt, false);
  update public.document_payments set receipt_id = v_receipt where id = p_payment;
  return v_receipt;
end
$$;
