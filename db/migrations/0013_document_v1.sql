-- 0013 — Modèle documentaire de la v1 (spec 009, docs/product/PARITE_V1.md §1).
-- Un document est une suite de SECTIONS (titre et sous-total optionnels) ; une ligne est
-- « quantité × prix », un montant forfaitaire ou un texte non calculé ; la main-d'œuvre, le
-- transport, une remise sont des AJUSTEMENTS ordonnés (pourcentage OU montant, jamais converti
-- l'un en l'autre, base explicite). Ordre de calcul : lignes → sous-totaux → total des postes →
-- ajustements → base taxable → taxe → total → acompte → solde indicatif.
-- Le calcul est à l'artisan ; Firmo l'applique sans jamais inventer une valeur.

-- ---------------------------------------------------------------- organisation

alter table public.organizations
  -- Métier tel que l'artisan l'écrit (« Chaudronnerie - Soudure »), prioritaire sur trade_code.
  add column trade_label text check (trade_label is null or length(btrim(trade_label)) between 1 and 120),
  -- Valeurs reposées seules sur chaque nouveau devis ou proforma (P-06).
  add column default_validity_days integer check (default_validity_days is null or default_validity_days between 1 and 365),
  add column default_delivery_text text check (default_delivery_text is null or length(default_delivery_text) <= 200),
  add column default_warranty_text text check (default_warranty_text is null or length(default_warranty_text) <= 200),
  add column default_deposit_bp integer check (default_deposit_bp is null or default_deposit_bp between 1 and 10000);

-- ---------------------------------------------------------------- document

alter table public.documents drop constraint documents_status_check;
alter table public.documents add constraint documents_status_check check (status in (
  'draft', 'issued', 'accepted', 'refused', 'no_response', 'partially_paid', 'paid', 'cancelled', 'replaced'));

alter table public.documents
  -- Champs latents : rendus seulement s'ils sont remplis, jamais demandés (P-05).
  add column summary text check (summary is null or length(summary) <= 300),
  add column site text check (site is null or length(site) <= 200),
  add column delivery_text text check (delivery_text is null or length(delivery_text) <= 200),
  add column warranty_text text check (warranty_text is null or length(warranty_text) <= 200),
  add column assumptions text check (assumptions is null or length(assumptions) <= 1000),
  add column validity_days integer check (validity_days is null or validity_days between 1 and 365),
  add column deposit_bp integer check (deposit_bp is null or deposit_bp between 1 and 10000),
  -- Totaux calculés (vérité tant que brouillon, figés à l'émission).
  add column adjustments_total_minor bigint not null default 0,
  add column taxable_minor bigint not null default 0,
  add column deposit_minor bigint,
  -- Révisions (P-10) : racine commune, numéro racine + /R2, /R3.
  add column root_document_id uuid references public.documents (id),
  add column revision integer not null default 1 check (revision >= 1),
  add column manual_number boolean not null default false,
  add column template_version text;

-- ---------------------------------------------------------------- sections

create table public.document_sections (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position integer not null check (position >= 1),
  -- Null : liste plate (le cas simple).
  title text check (title is null or length(btrim(title)) between 1 and 160),
  show_subtotal boolean not null default false,
  subtotal_minor bigint not null default 0,
  unique (document_id, position) deferrable initially deferred
);
create index document_sections_document on public.document_sections (document_id);
alter table public.document_sections enable row level security;

-- ---------------------------------------------------------------- lignes

alter table public.document_lines
  add column section_id uuid references public.document_sections (id) on delete cascade,
  -- Précision du métier sous le libellé, en gris.
  add column description text check (description is null or length(description) <= 300),
  -- Unité telle que l'artisan la dit (« barre », « boîte », « m³ ») : jamais normalisée.
  add column unit text check (unit is null or length(btrim(unit)) between 1 and 24),
  add column flat_amount_minor bigint check (flat_amount_minor is null or flat_amount_minor >= 0),
  add column kind text not null default 'priced' check (kind in ('priced', 'flat', 'text'));

-- Reprise des documents existants (y compris émis) : les gardes sont suspendues le temps de la
-- reprise, les montants émis restent identiques.
alter table public.document_lines disable trigger user;
alter table public.documents disable trigger user;

-- Une section sans titre par document existant ; unités reprises de leur libellé court.
insert into public.document_sections (document_id, position)
select distinct l.document_id, 1 from public.document_lines l;
update public.document_lines l set section_id = s.id
from public.document_sections s where s.document_id = l.document_id;
update public.document_lines l set unit = coalesce(u.short_labels ->> d.locale, u.short_labels ->> 'fr')
from public.units u, public.documents d
where u.code = l.unit_code and d.id = l.document_id;

alter table public.document_lines alter column section_id set not null;
create index document_lines_section on public.document_lines (section_id);

alter table public.document_lines drop column line_total_minor;
alter table public.document_lines drop column unit_code;
alter table public.document_lines drop constraint document_lines_to_confirm_check;
alter table public.document_lines add constraint document_lines_to_confirm_check
  check (to_confirm <@ array['label', 'quantity', 'unit', 'unit_price', 'flat_amount']::text[]);
alter table public.document_lines add constraint document_lines_kind_values check (
  (kind = 'priced' and flat_amount_minor is null)
  or (kind = 'flat' and quantity is null and unit_price_minor is null)
  or (kind = 'text' and quantity is null and unit_price_minor is null and flat_amount_minor is null));
alter table public.document_lines add column line_total_minor bigint generated always as (
  case
    when kind = 'flat' then flat_amount_minor
    when kind = 'priced' and quantity is not null and unit_price_minor is not null
      then round(quantity * unit_price_minor)::bigint
  end
) stored;
update public.document_sections s set subtotal_minor = coalesce((
  select sum(l.line_total_minor) from public.document_lines l where l.section_id = s.id), 0);

-- ---------------------------------------------------------------- ajustements

create table public.document_adjustments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position integer not null check (position >= 1),
  label text not null check (length(btrim(label)) between 1 and 160),
  -- Le mode est un choix de l'artisan : « 30 % » expose la méthode, un forfait la protège.
  mode text not null check (mode in ('percent', 'amount')),
  sign smallint not null default 1 check (sign in (-1, 1)),
  base text not null default 'items_total' check (base in ('items_total', 'section', 'taxable_base')),
  section_id uuid references public.document_sections (id) on delete cascade,
  -- Pourcentage en centièmes de point (25 % = 2500) ; au-delà de 100 % admis.
  rate_bp integer check (rate_bp is null or rate_bp between 1 and 1000000),
  value_minor bigint check (value_minor is null or value_minor > 0),
  base_minor bigint,
  amount_minor bigint,
  -- Valeur lue mais incertaine, à confirmer.
  to_confirm boolean not null default false,
  source text not null default 'typed' check (source in ('read', 'typed')),
  check ((base = 'section') = (section_id is not null)),
  check ((mode = 'percent' and value_minor is null) or (mode = 'amount' and rate_bp is null)),
  unique (document_id, position) deferrable initially deferred
);
create index document_adjustments_document on public.document_adjustments (document_id);
alter table public.document_adjustments enable row level security;

-- Remises existantes (modèle précédent) → ajustements négatifs sur le total des postes.
insert into public.document_adjustments (document_id, position, label, mode, sign, rate_bp, value_minor,
  base_minor, amount_minor)
select d.id, 1, case d.locale when 'en' then 'Discount' else 'Remise' end,
  case when d.discount_bp is not null then 'percent' else 'amount' end, -1, d.discount_bp, d.discount_minor,
  d.subtotal_minor, -d.discount_total_minor
from public.documents d
where d.discount_bp is not null or d.discount_minor is not null;
update public.documents set
  adjustments_total_minor = -discount_total_minor,
  taxable_minor = subtotal_minor - discount_total_minor;

alter table public.document_lines enable trigger user;
alter table public.documents enable trigger user;

drop trigger documents_recompute on public.documents;
alter table public.documents drop column discount_bp, drop column discount_minor, drop column discount_total_minor;

-- ---------------------------------------------------------------- clauses

-- Écrites une fois, réutilisées, activées par document (P-07). Firmo ajuste la forme, jamais le fond.
create table public.clauses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  title text check (title is null or length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 600),
  is_default boolean not null default false,
  position integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clauses_org on public.clauses (org_id, position);
create trigger clauses_updated_at before update on public.clauses
  for each row execute function app.set_updated_at();
alter table public.clauses enable row level security;

-- Clauses d'un document : copiées (pas référencées), donc figées à l'émission.
create table public.document_clauses (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  position integer not null check (position >= 1),
  clause_id uuid references public.clauses (id) on delete set null,
  title text check (title is null or length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 600),
  unique (document_id, position) deferrable initially deferred
);
create index document_clauses_document on public.document_clauses (document_id);
alter table public.document_clauses enable row level security;

-- ---------------------------------------------------------------- numérotation

-- Format par organisation et par type (P-08). Changer le format ne remet jamais un compteur à
-- zéro : le compteur dépend de (organisation, type, année ou 0 en continu), pas du format.
create table public.numbering_settings (
  org_id uuid not null references public.organizations (id) on delete cascade,
  type_code text not null references public.document_types (code),
  prefix text not null check (prefix ~ '^[A-Za-z0-9]{0,12}$'),
  separator text not null default '-' check (separator in ('-', '_', '/', '.')),
  include_year boolean not null default true,
  width smallint not null default 3 check (width between 1 and 12),
  cadence text not null default 'annual' check (cadence in ('annual', 'continuous')),
  updated_at timestamptz not null default now(),
  primary key (org_id, type_code)
);
alter table public.numbering_settings enable row level security;

-- ---------------------------------------------------------------- consultations

-- Lien direct (P-14) : première et dernière ouverture, compteur. Aucune IP, aucune empreinte.
create table public.document_views (
  document_id uuid primary key references public.documents (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1 check (view_count >= 1)
);
alter table public.document_views enable row level security;

-- ---------------------------------------------------------------- mémoire des postes

-- Ce qu'il a déjà chiffré : libellé tel qu'écrit, unité, DERNIER prix constaté (P-43).
-- Mémoire, jamais suggestion : aucun prix n'est proposé ni repris sans qu'il le dise.
alter table public.memory_items
  add column unit text check (unit is null or length(unit) <= 24),
  add column last_price_minor bigint check (last_price_minor is null or last_price_minor >= 0),
  add column currency_code char(3) references public.currencies (code);
update public.memory_items m set unit = coalesce(u.short_labels ->> 'fr', m.unit_code)
from public.units u where u.code = m.unit_code;
alter table public.memory_items drop column unit_code;

insert into public.settings (key, value, description) values
  ('number_width', '3', 'Largeur par défaut de la séquence des numéros (DEV-2026-001).'),
  ('document_template_version', '"firmo-v1.4"', 'Version du gabarit figée sur chaque document émis.');

-- ---------------------------------------------------------------- gardes d'immuabilité

create or replace function app.guard_issued_children() returns trigger
language plpgsql
as $$
declare
  v_doc uuid := coalesce(new.document_id, old.document_id);
begin
  if (select status from public.documents where id = v_doc) is distinct from 'draft' then
    raise exception 'document émis : son contenu ne se modifie plus' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
-- Les calculs (sous-totaux, montants d'ajustement) restent écrits par la base elle-même.
create or replace function app.guard_issued_calculated() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and current_setting('firmo.recomputing', true) = 'on' then
    return new;
  end if;
  if (select status from public.documents where id = coalesce(new.document_id, old.document_id)) is distinct from 'draft' then
    raise exception 'document émis : son contenu ne se modifie plus' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;
create trigger document_sections_guard before insert or update or delete on public.document_sections
  for each row execute function app.guard_issued_calculated();
create trigger document_adjustments_guard before insert or update or delete on public.document_adjustments
  for each row execute function app.guard_issued_calculated();
create trigger document_clauses_guard before insert or update or delete on public.document_clauses
  for each row execute function app.guard_issued_children();

-- ---------------------------------------------------------------- calcul

-- Totaux d'un brouillon (P-04). Arrondi au plus proche, demi vers le haut. Ne lève jamais :
-- une base négative ou une valeur manquante devient un blocage d'émission, pas une erreur
-- au milieu d'une correction.
create or replace function app.recompute_document(p_doc uuid) returns void
language plpgsql
as $$
declare
  v_doc public.documents;
  v_items bigint;
  v_taxable bigint;
  v_adj_total bigint := 0;
  v_base bigint;
  v_amount bigint;
  v_tax bigint;
  v_total bigint;
  a record;
begin
  select * into v_doc from public.documents where id = p_doc;
  if not found or v_doc.status <> 'draft' then
    return;
  end if;
  perform set_config('firmo.recomputing', 'on', true);

  update public.document_sections s set subtotal_minor = coalesce((
    select sum(l.line_total_minor) from public.document_lines l where l.section_id = s.id), 0)
  where s.document_id = p_doc;
  select coalesce(sum(subtotal_minor), 0) into v_items from public.document_sections where document_id = p_doc;

  v_taxable := v_items;
  for a in select * from public.document_adjustments where document_id = p_doc order by position loop
    v_base := case a.base
      when 'items_total' then v_items
      when 'taxable_base' then v_taxable
      else (select subtotal_minor from public.document_sections where id = a.section_id)
    end;
    v_amount := case
      when a.mode = 'percent' and a.rate_bp is not null then round(v_base * a.rate_bp / 10000.0)::bigint
      when a.mode = 'amount' then a.value_minor
    end;
    v_amount := v_amount * a.sign;
    update public.document_adjustments set base_minor = v_base, amount_minor = v_amount where id = a.id;
    v_adj_total := v_adj_total + coalesce(v_amount, 0);
    v_taxable := v_taxable + coalesce(v_amount, 0);
  end loop;

  v_tax := case when v_doc.apply_tax and v_doc.tax_rate_bp > 0 and v_taxable > 0
    then round(v_taxable * v_doc.tax_rate_bp / 10000.0)::bigint else 0 end;
  v_total := v_taxable + v_tax;

  update public.documents set
    subtotal_minor = v_items,
    adjustments_total_minor = v_adj_total,
    taxable_minor = v_taxable,
    tax_minor = v_tax,
    total_minor = v_total,
    deposit_minor = case when deposit_bp is not null and v_total > 0
      then round(v_total * deposit_bp / 10000.0)::bigint end
  where id = p_doc;
  perform set_config('firmo.recomputing', 'off', true);
end
$$;

-- Recalcul après chaque modification, sauf pendant un remplacement groupé (set_content), qui
-- recalcule une seule fois à la fin.
create or replace function app.content_changed() returns trigger
language plpgsql
as $$
begin
  if current_setting('firmo.recomputing', true) = 'on' or current_setting('firmo.bulk', true) = 'on' then
    return null;
  end if;
  perform app.recompute_document(coalesce(new.document_id, old.document_id));
  return null;
end
$$;
drop trigger document_lines_recompute on public.document_lines;
create trigger document_lines_recompute after insert or update or delete on public.document_lines
  for each row execute function app.content_changed();
create trigger document_adjustments_recompute after insert or update or delete on public.document_adjustments
  for each row execute function app.content_changed();
create trigger document_sections_recompute after insert or delete on public.document_sections
  for each row execute function app.content_changed();

create or replace function app.document_settings_changed() returns trigger
language plpgsql
as $$
begin
  if new.status = 'draft' and current_setting('firmo.recomputing', true) is distinct from 'on' and (
    new.apply_tax is distinct from old.apply_tax or new.tax_rate_bp is distinct from old.tax_rate_bp
    or new.deposit_bp is distinct from old.deposit_bp
  ) then
    perform app.recompute_document(new.id);
  end if;
  return null;
end
$$;
create trigger documents_recompute after update on public.documents
  for each row execute function app.document_settings_changed();

-- Positions des lignes : continues sur tout le document, dans l'ordre des sections (« ligne 3 »
-- dans le chat désigne la troisième ligne affichée).
create or replace function app.renumber(p_doc uuid) returns void
language plpgsql
as $$
begin
  update public.document_sections s set position = r.n
  from (select id, row_number() over (order by position, id) as n
        from public.document_sections where document_id = p_doc) r
  where s.id = r.id and s.position <> r.n;
  update public.document_lines l set position = r.n
  from (select l2.id, row_number() over (order by s.position, l2.position, l2.id) as n
        from public.document_lines l2 join public.document_sections s on s.id = l2.section_id
        where l2.document_id = p_doc) r
  where l.id = r.id and l.position <> r.n;
  update public.document_adjustments a set position = r.n
  from (select id, row_number() over (order by position, id) as n
        from public.document_adjustments where document_id = p_doc) r
  where a.id = r.id and a.position <> r.n;
end
$$;

-- ---------------------------------------------------------------- contenu

-- Ligne JSON → ligne typée. Les montants arrivent en unités mineures (entiers).
create or replace function app.insert_line(p_doc uuid, p_section uuid, p_position integer, p_line jsonb)
returns void
language plpgsql
as $$
declare
  v_kind text := coalesce(nullif(p_line ->> 'kind', ''),
    case when p_line ? 'flat_amount_minor' and nullif(p_line ->> 'flat_amount_minor', '') is not null then 'flat' else 'priced' end);
begin
  insert into public.document_lines (document_id, section_id, position, label, description, quantity, unit,
    unit_price_minor, flat_amount_minor, kind, to_confirm, source)
  values (
    p_doc, p_section, p_position,
    btrim(p_line ->> 'label'),
    nullif(btrim(p_line ->> 'description'), ''),
    case when v_kind = 'priced' then nullif(p_line ->> 'quantity', '')::numeric end,
    nullif(btrim(p_line ->> 'unit'), ''),
    case when v_kind = 'priced' then nullif(p_line ->> 'unit_price_minor', '')::bigint end,
    case when v_kind = 'flat' then nullif(p_line ->> 'flat_amount_minor', '')::bigint end,
    v_kind,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_line -> 'to_confirm', '[]'))), '{}'),
    coalesce(p_line ->> 'source', 'typed')
  );
end
$$;

-- Sections JSON → sections et lignes, à la suite de celles qui existent.
create or replace function app.insert_sections(p_doc uuid, p_sections jsonb) returns void
language plpgsql
as $$
declare
  v_section jsonb;
  v_line jsonb;
  v_section_id uuid;
  v_spos integer;
  v_lpos integer;
begin
  if jsonb_typeof(coalesce(p_sections, '[]')) <> 'array' then
    raise exception 'sections : tableau attendu' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) into v_spos from public.document_sections where document_id = p_doc;
  select coalesce(max(position), 0) into v_lpos from public.document_lines where document_id = p_doc;
  for v_section in select * from jsonb_array_elements(coalesce(p_sections, '[]')) loop
    v_spos := v_spos + 1;
    insert into public.document_sections (document_id, position, title, show_subtotal)
    values (p_doc, v_spos, nullif(btrim(v_section ->> 'title'), ''),
      coalesce((v_section ->> 'show_subtotal')::boolean, nullif(btrim(v_section ->> 'title'), '') is not null))
    returning id into v_section_id;
    for v_line in select * from jsonb_array_elements(coalesce(v_section -> 'lines', '[]')) loop
      v_lpos := v_lpos + 1;
      perform app.insert_line(p_doc, v_section_id, v_lpos, v_line);
    end loop;
  end loop;
end
$$;

-- Ajustements JSON (section désignée par sa position 1, 2…) → ajustements, à la suite.
create or replace function app.insert_adjustments(p_doc uuid, p_adjustments jsonb) returns void
language plpgsql
as $$
declare
  v_adj jsonb;
  v_pos integer;
  v_mode text;
  v_base text;
  v_section uuid;
begin
  if jsonb_typeof(coalesce(p_adjustments, '[]')) <> 'array' then
    raise exception 'ajustements : tableau attendu' using errcode = '22023';
  end if;
  select coalesce(max(position), 0) into v_pos from public.document_adjustments where document_id = p_doc;
  for v_adj in select * from jsonb_array_elements(coalesce(p_adjustments, '[]')) loop
    v_pos := v_pos + 1;
    v_mode := coalesce(v_adj ->> 'mode', 'amount');
    v_base := coalesce(v_adj ->> 'base', 'items_total');
    v_section := null;
    if v_base = 'section' then
      select id into v_section from public.document_sections
      where document_id = p_doc and position = (v_adj ->> 'section')::int;
      if v_section is null then
        raise exception 'ajustement : section % introuvable', v_adj ->> 'section' using errcode = '22023';
      end if;
    end if;
    insert into public.document_adjustments (document_id, position, label, mode, sign, base, section_id,
      rate_bp, value_minor, to_confirm, source)
    values (p_doc, v_pos, btrim(v_adj ->> 'label'), v_mode, coalesce((v_adj ->> 'sign')::smallint, 1),
      v_base, v_section,
      case when v_mode = 'percent' then nullif(v_adj ->> 'rate_bp', '')::int end,
      case when v_mode = 'amount' then nullif(v_adj ->> 'value_minor', '')::bigint end,
      coalesce((v_adj ->> 'to_confirm')::boolean, false), coalesce(v_adj ->> 'source', 'typed'));
  end loop;
end
$$;

-- Ajustements actuels au format JSON d'entrée (pour les conserver lors d'un remplacement).
create or replace function app.adjustments_json(p_doc uuid) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'label', a.label, 'mode', a.mode, 'sign', a.sign, 'base', a.base,
    'section', s.position, 'rate_bp', a.rate_bp, 'value_minor', a.value_minor,
    'to_confirm', a.to_confirm, 'source', a.source) order by a.position), '[]')
  from public.document_adjustments a left join public.document_sections s on s.id = a.section_id
  where a.document_id = p_doc
$$;

-- Champs du document (P-05) : objet, résumé, chantier, délai, garantie, hypothèses, validité,
-- acompte, type, taxe. Seuls les champs connus sont acceptés.
create or replace function app.update_draft(p_org uuid, p_doc uuid, p_patch jsonb) returns void
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_draft(p_org, p_doc);
  v_unknown text;
begin
  select string_agg(k, ', ') into v_unknown from jsonb_object_keys(p_patch) k
  where k not in ('type', 'title', 'summary', 'site', 'delivery_text', 'warranty_text', 'assumptions',
                  'notes', 'validity_days', 'deposit_bp', 'apply_tax', 'template');
  if v_unknown is not null then
    raise exception 'champs inconnus : %', v_unknown using errcode = '22023';
  end if;
  if p_patch ? 'type' and not exists (
    select 1 from public.document_types where code = p_patch ->> 'type' and active and code <> 'receipt'
  ) then
    raise exception 'type de document non disponible' using errcode = '22023';
  end if;
  update public.documents set
    type_code = coalesce(p_patch ->> 'type', type_code),
    title = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
    summary = case when p_patch ? 'summary' then nullif(btrim(p_patch ->> 'summary'), '') else summary end,
    site = case when p_patch ? 'site' then nullif(btrim(p_patch ->> 'site'), '') else site end,
    delivery_text = case when p_patch ? 'delivery_text' then nullif(btrim(p_patch ->> 'delivery_text'), '') else delivery_text end,
    warranty_text = case when p_patch ? 'warranty_text' then nullif(btrim(p_patch ->> 'warranty_text'), '') else warranty_text end,
    assumptions = case when p_patch ? 'assumptions' then nullif(btrim(p_patch ->> 'assumptions'), '') else assumptions end,
    notes = case when p_patch ? 'notes' then nullif(btrim(p_patch ->> 'notes'), '') else notes end,
    validity_days = case when p_patch ? 'validity_days' then nullif(p_patch ->> 'validity_days', '')::int else validity_days end,
    deposit_bp = case when p_patch ? 'deposit_bp' then nullif(p_patch ->> 'deposit_bp', '')::int else deposit_bp end,
    apply_tax = case when p_patch ? 'apply_tax' then (p_patch ->> 'apply_tax')::boolean and tax_rate_bp > 0 else apply_tax end,
    template_code = coalesce(p_patch ->> 'template', template_code)
  where id = v_doc.id;
end
$$;

-- Contenu d'un brouillon en un appel (éditeur web, nouvelle lecture) :
-- {sections:[{title, show_subtotal, lines:[…]}], adjustments:[…], …champs}. Les clés absentes
-- ne changent rien ; remplacer les sections conserve les ajustements non envoyés.
create or replace function app.set_content(p_org uuid, p_doc uuid, p_content jsonb) returns void
language plpgsql
as $$
declare
  v_adjustments jsonb;
  v_fields jsonb;
begin
  perform app.lock_draft(p_org, p_doc);
  perform set_config('firmo.bulk', 'on', true);
  if p_content ? 'sections' then
    v_adjustments := coalesce(p_content -> 'adjustments', app.adjustments_json(p_doc));
    delete from public.document_adjustments where document_id = p_doc;
    delete from public.document_sections where document_id = p_doc;
    perform app.insert_sections(p_doc, p_content -> 'sections');
    perform app.insert_adjustments(p_doc, v_adjustments);
  elsif p_content ? 'adjustments' then
    delete from public.document_adjustments where document_id = p_doc;
    perform app.insert_adjustments(p_doc, p_content -> 'adjustments');
  end if;
  v_fields := p_content - 'sections' - 'adjustments' - 'clauses';
  if v_fields <> '{}'::jsonb then
    perform app.update_draft(p_org, p_doc, v_fields);
  end if;
  if p_content ? 'clauses' then
    perform app.set_document_clauses(p_org, p_doc, p_content -> 'clauses');
  end if;
  perform set_config('firmo.bulk', 'off', true);
  perform app.recompute_document(p_doc);
end
$$;

-- Compatibilité : lignes à plat → une section sans titre.
create or replace function app.set_lines(p_org uuid, p_doc uuid, p_lines jsonb) returns void
language plpgsql
as $$
begin
  perform app.set_content(p_org, p_doc, jsonb_build_object('sections',
    jsonb_build_array(jsonb_build_object('lines', coalesce(p_lines, '[]')))));
end
$$;

-- Lignes ajoutées à une section (par défaut la dernière ; créée s'il n'y en a pas).
create or replace function app.add_lines(p_org uuid, p_doc uuid, p_lines jsonb, p_section integer default null)
returns void
language plpgsql
as $$
declare
  v_section uuid;
  v_line jsonb;
  v_pos integer;
begin
  perform app.lock_draft(p_org, p_doc);
  select id into v_section from public.document_sections
  where document_id = p_doc and (p_section is null or position = p_section)
  order by position desc limit 1;
  if v_section is null then
    if p_section is not null then
      raise exception 'section % introuvable', p_section using errcode = 'P0002';
    end if;
    insert into public.document_sections (document_id, position) values (p_doc, 1) returning id into v_section;
  end if;
  select coalesce(max(position), 0) + 1000 into v_pos from public.document_lines where document_id = p_doc;
  for v_line in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    v_pos := v_pos + 1;
    perform app.insert_line(p_doc, v_section, v_pos, v_line);
  end loop;
  perform app.renumber(p_doc);
end
$$;

-- Ajoute une section titrée avec ses lignes, à la fin.
create or replace function app.add_section(p_org uuid, p_doc uuid, p_section jsonb) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  perform app.insert_sections(p_doc, jsonb_build_array(p_section));
  perform app.renumber(p_doc);
end
$$;

-- Section : titre, sous-total affiché.
create or replace function app.patch_section(p_org uuid, p_doc uuid, p_position integer, p_patch jsonb)
returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  update public.document_sections set
    title = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
    show_subtotal = coalesce((p_patch ->> 'show_subtotal')::boolean, show_subtotal)
  where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'section % introuvable', p_position using errcode = 'P0002';
  end if;
end
$$;

create or replace function app.remove_section(p_org uuid, p_doc uuid, p_position integer) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_sections where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'section % introuvable', p_position using errcode = 'P0002';
  end if;
  perform app.renumber(p_doc);
end
$$;

-- Corrige une ligne (P-31). Une valeur corrigée n'est plus « à confirmer » ; si la valeur lue
-- change, `reading_corrected` mesure la fidélité de lecture.
create or replace function app.patch_line(p_org uuid, p_doc uuid, p_position integer, p_patch jsonb)
returns void
language plpgsql
as $$
declare
  v_line public.document_lines;
  v_kind text;
  v_fields text[] := array[]::text[];
  v_field text;
begin
  perform app.lock_draft(p_org, p_doc);
  select * into v_line from public.document_lines where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'ligne % introuvable', p_position using errcode = 'P0002';
  end if;
  v_kind := coalesce(p_patch ->> 'kind',
    case
      when p_patch ? 'flat_amount_minor' and nullif(p_patch ->> 'flat_amount_minor', '') is not null then 'flat'
      when (p_patch ? 'quantity' and nullif(p_patch ->> 'quantity', '') is not null)
        or (p_patch ? 'unit_price_minor' and nullif(p_patch ->> 'unit_price_minor', '') is not null) then 'priced'
      else v_line.kind
    end);
  if p_patch ? 'label' and btrim(p_patch ->> 'label') is distinct from v_line.label then v_fields := v_fields || 'label'::text; end if;
  if p_patch ? 'quantity' and nullif(p_patch ->> 'quantity', '')::numeric is distinct from v_line.quantity then v_fields := v_fields || 'quantity'::text; end if;
  if p_patch ? 'unit' and nullif(btrim(p_patch ->> 'unit'), '') is distinct from v_line.unit then v_fields := v_fields || 'unit'::text; end if;
  if p_patch ? 'unit_price_minor' and nullif(p_patch ->> 'unit_price_minor', '')::bigint is distinct from v_line.unit_price_minor then v_fields := v_fields || 'unit_price'::text; end if;
  if p_patch ? 'flat_amount_minor' and nullif(p_patch ->> 'flat_amount_minor', '')::bigint is distinct from v_line.flat_amount_minor then v_fields := v_fields || 'flat_amount'::text; end if;

  update public.document_lines set
    kind = v_kind,
    label = case when p_patch ? 'label' then btrim(p_patch ->> 'label') else label end,
    description = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else description end,
    unit = case when p_patch ? 'unit' then nullif(btrim(p_patch ->> 'unit'), '') else unit end,
    quantity = case when v_kind <> 'priced' then null
      when p_patch ? 'quantity' then nullif(p_patch ->> 'quantity', '')::numeric else quantity end,
    unit_price_minor = case when v_kind <> 'priced' then null
      when p_patch ? 'unit_price_minor' then nullif(p_patch ->> 'unit_price_minor', '')::bigint else unit_price_minor end,
    flat_amount_minor = case when v_kind <> 'flat' then null
      when p_patch ? 'flat_amount_minor' then nullif(p_patch ->> 'flat_amount_minor', '')::bigint else flat_amount_minor end,
    to_confirm = array(
      select f from unnest(to_confirm) f
      where not (
        (f = 'label' and p_patch ? 'label') or (f = 'quantity' and p_patch ? 'quantity')
        or (f = 'unit' and p_patch ? 'unit') or (f = 'unit_price' and p_patch ? 'unit_price_minor')
        or (f = 'flat_amount' and p_patch ? 'flat_amount_minor')
        or (v_kind = 'text')
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

-- Retire une ligne ; une section vide disparaît avec ses ajustements propres.
create or replace function app.remove_line(p_org uuid, p_doc uuid, p_position integer) returns void
language plpgsql
as $$
declare
  v_section uuid;
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_lines where document_id = p_doc and position = p_position
  returning section_id into v_section;
  if v_section is null then
    raise exception 'ligne % introuvable', p_position using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.document_lines where section_id = v_section) then
    delete from public.document_sections where id = v_section;
  end if;
  perform app.renumber(p_doc);
end
$$;

-- Ajustements (P-03) : ajout, correction, retrait.
create or replace function app.add_adjustment(p_org uuid, p_doc uuid, p_adjustment jsonb) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  perform app.insert_adjustments(p_doc, jsonb_build_array(p_adjustment));
end
$$;

create or replace function app.patch_adjustment(p_org uuid, p_doc uuid, p_position integer, p_patch jsonb)
returns void
language plpgsql
as $$
declare
  v_adj public.document_adjustments;
  v_mode text;
  v_base text;
  v_section uuid;
begin
  perform app.lock_draft(p_org, p_doc);
  select * into v_adj from public.document_adjustments where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'ajustement % introuvable', p_position using errcode = 'P0002';
  end if;
  v_mode := coalesce(p_patch ->> 'mode', v_adj.mode);
  v_base := coalesce(p_patch ->> 'base', v_adj.base);
  v_section := v_adj.section_id;
  if v_base = 'section' and p_patch ? 'section' then
    select id into v_section from public.document_sections where document_id = p_doc and position = (p_patch ->> 'section')::int;
    if v_section is null then
      raise exception 'section introuvable' using errcode = '22023';
    end if;
  elsif v_base <> 'section' then
    v_section := null;
  end if;
  update public.document_adjustments set
    label = case when p_patch ? 'label' then btrim(p_patch ->> 'label') else label end,
    mode = v_mode,
    sign = coalesce((p_patch ->> 'sign')::smallint, sign),
    base = v_base,
    section_id = v_section,
    rate_bp = case when v_mode <> 'percent' then null
      when p_patch ? 'rate_bp' then nullif(p_patch ->> 'rate_bp', '')::int else rate_bp end,
    value_minor = case when v_mode <> 'amount' then null
      when p_patch ? 'value_minor' then nullif(p_patch ->> 'value_minor', '')::bigint else value_minor end,
    to_confirm = case when p_patch ? 'rate_bp' or p_patch ? 'value_minor' then false else to_confirm end
  where id = v_adj.id;
end
$$;

create or replace function app.remove_adjustment(p_org uuid, p_doc uuid, p_position integer) returns void
language plpgsql
as $$
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_adjustments where document_id = p_doc and position = p_position;
  if not found then
    raise exception 'ajustement % introuvable', p_position using errcode = 'P0002';
  end if;
  perform app.renumber(p_doc);
end
$$;

-- ---------------------------------------------------------------- clauses

create or replace function app.save_clause(p_org uuid, p_id uuid, p_patch jsonb) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p_id is null then
    insert into public.clauses (org_id, title, body, is_default, position)
    values (p_org, nullif(btrim(p_patch ->> 'title'), ''), btrim(p_patch ->> 'body'),
      coalesce((p_patch ->> 'is_default')::boolean, false),
      coalesce((p_patch ->> 'position')::int,
        (select coalesce(max(position), 0) + 1 from public.clauses where org_id = p_org)))
    returning id into v_id;
  else
    update public.clauses set
      title = case when p_patch ? 'title' then nullif(btrim(p_patch ->> 'title'), '') else title end,
      body = coalesce(nullif(btrim(p_patch ->> 'body'), ''), body),
      is_default = coalesce((p_patch ->> 'is_default')::boolean, is_default),
      position = coalesce((p_patch ->> 'position')::int, position),
      active = coalesce((p_patch ->> 'active')::boolean, active)
    where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then
      raise exception 'clause introuvable' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end
$$;

-- Clauses d'un brouillon : [{clause_id}|{title, body}] dans l'ordre voulu.
create or replace function app.set_document_clauses(p_org uuid, p_doc uuid, p_clauses jsonb) returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_pos integer := 0;
  v_clause public.clauses;
begin
  perform app.lock_draft(p_org, p_doc);
  delete from public.document_clauses where document_id = p_doc;
  for v_item in select * from jsonb_array_elements(coalesce(p_clauses, '[]')) loop
    v_pos := v_pos + 1;
    if v_item ? 'clause_id' and nullif(v_item ->> 'clause_id', '') is not null then
      select * into v_clause from public.clauses where id = (v_item ->> 'clause_id')::uuid and org_id = p_org;
      if not found then
        raise exception 'clause introuvable' using errcode = 'P0002';
      end if;
      insert into public.document_clauses (document_id, position, clause_id, title, body)
      values (p_doc, v_pos, v_clause.id, v_clause.title, v_clause.body);
    else
      insert into public.document_clauses (document_id, position, title, body)
      values (p_doc, v_pos, nullif(btrim(v_item ->> 'title'), ''), btrim(v_item ->> 'body'));
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------- création

-- Brouillon avec contenu structuré. Valeurs par défaut de l'organisation et clauses par défaut
-- reposées seules (P-06, P-07) ; le contenu fourni les remplace champ par champ.
create or replace function app.create_draft_content(
  p_org uuid, p_type text, p_content jsonb, p_origin text default 'chat'
) returns uuid
language plpgsql
as $$
declare
  v_org public.organizations;
  v_type public.document_types;
  v_tax public.taxes;
  v_id uuid;
  v_defaults boolean;
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
  -- Délai, garantie, acompte : propres aux offres (devis, proforma), pas aux factures.
  v_defaults := v_type.validity_days is not null;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, origin,
    apply_tax, tax_code, tax_label, tax_rate_bp, validity_days, delivery_text, warranty_text, deposit_bp)
  values (p_org, p_type, v_org.currency_code, v_org.locale, v_org.template_code, p_origin,
    v_tax.id is not null, v_tax.code, app.label(v_tax.labels, v_org.locale), coalesce(v_tax.rate_bp, 0),
    case when v_defaults then coalesce(v_org.default_validity_days, v_type.validity_days) end,
    case when v_defaults then v_org.default_delivery_text end,
    case when v_defaults then v_org.default_warranty_text end,
    case when v_defaults then v_org.default_deposit_bp end)
  returning id into v_id;
  insert into public.document_clauses (document_id, position, clause_id, title, body)
  select v_id, row_number() over (order by c.position, c.created_at), c.id, c.title, c.body
  from public.clauses c where c.org_id = p_org and c.active and c.is_default;
  perform app.set_content(p_org, v_id, coalesce(p_content, '{}'));
  return v_id;
end
$$;

-- Compatibilité : lignes à plat.
create or replace function app.create_draft(
  p_org uuid, p_type text, p_lines jsonb, p_origin text default 'chat', p_title text default null
) returns uuid
language plpgsql
as $$
begin
  return app.create_draft_content(p_org, p_type, jsonb_strip_nulls(jsonb_build_object(
    'title', p_title,
    'sections', case when jsonb_array_length(coalesce(p_lines, '[]')) > 0
      then jsonb_build_array(jsonb_build_object('lines', p_lines)) end)), p_origin);
end
$$;

-- Copie le contenu d'un document dans un brouillon vide (révision, conversion, duplication).
create or replace function app.copy_content(p_src uuid, p_dst uuid) returns void
language plpgsql
as $$
declare
  v_map jsonb := '{}';
  s record;
  v_new uuid;
begin
  perform set_config('firmo.bulk', 'on', true);
  for s in select * from public.document_sections where document_id = p_src order by position loop
    insert into public.document_sections (document_id, position, title, show_subtotal)
    values (p_dst, s.position, s.title, s.show_subtotal) returning id into v_new;
    v_map := v_map || jsonb_build_object(s.id::text, v_new);
  end loop;
  insert into public.document_lines (document_id, section_id, position, label, description, quantity, unit,
    unit_price_minor, flat_amount_minor, kind, source)
  select p_dst, (v_map ->> l.section_id::text)::uuid, l.position, l.label, l.description, l.quantity, l.unit,
    l.unit_price_minor, l.flat_amount_minor, l.kind, 'typed'
  from public.document_lines l where l.document_id = p_src;
  insert into public.document_adjustments (document_id, position, label, mode, sign, base, section_id, rate_bp, value_minor)
  select p_dst, a.position, a.label, a.mode, a.sign, a.base, (v_map ->> a.section_id::text)::uuid, a.rate_bp, a.value_minor
  from public.document_adjustments a where a.document_id = p_src;
  insert into public.document_clauses (document_id, position, clause_id, title, body)
  select p_dst, c.position, c.clause_id, c.title, c.body from public.document_clauses c where c.document_id = p_src;
  perform set_config('firmo.bulk', 'off', true);
  perform app.recompute_document(p_dst);
end
$$;

-- Nouveau brouillon depuis un document : mêmes champs, type au choix.
create or replace function app.clone_document(p_src public.documents, p_type text, p_lineage text) returns uuid
language plpgsql
as $$
declare
  v_new uuid;
  v_type public.document_types;
begin
  select * into v_type from public.document_types where code = p_type and active;
  insert into public.documents (org_id, type_code, currency_code, locale, template_code, title, summary, notes,
    site, delivery_text, warranty_text, assumptions, validity_days, deposit_bp,
    client_id, apply_tax, tax_code, tax_label, tax_rate_bp, source_document_id, revises_id,
    root_document_id, revision, origin)
  values (p_src.org_id, p_type, p_src.currency_code, p_src.locale, p_src.template_code, p_src.title, p_src.summary,
    p_src.notes, p_src.site,
    case when v_type.validity_days is not null then p_src.delivery_text end,
    p_src.warranty_text, p_src.assumptions,
    case when v_type.validity_days is not null then coalesce(p_src.validity_days, v_type.validity_days) end,
    case when v_type.validity_days is not null then p_src.deposit_bp end,
    p_src.client_id, p_src.apply_tax, p_src.tax_code, p_src.tax_label, p_src.tax_rate_bp,
    case when p_lineage = 'convert' then p_src.id end,
    case when p_lineage = 'revise' then p_src.id end,
    case when p_lineage = 'revise' then coalesce(p_src.root_document_id, p_src.id) end,
    case when p_lineage = 'revise' then (
      select max(revision) + 1 from public.documents
      where id = coalesce(p_src.root_document_id, p_src.id) or root_document_id = coalesce(p_src.root_document_id, p_src.id)
    ) else 1 end,
    p_src.origin)
  returning id into v_new;
  perform app.copy_content(p_src.id, v_new);
  return v_new;
end
$$;

-- Révision d'un document émis (P-10) : brouillon identique, numéro racine + /Rn à l'émission.
create or replace function app.revise_document(p_org uuid, p_doc uuid) returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_existing uuid;
begin
  if v_doc.status not in ('issued', 'accepted', 'refused', 'no_response') then
    raise exception 'seul un document émis non payé se révise' using errcode = '42501';
  end if;
  select d.id into v_existing from public.documents d where d.revises_id = p_doc and d.status = 'draft' limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  return app.clone_document(v_doc, v_doc.type_code, 'revise');
end
$$;

-- Conversion (P-11) : devis → proforma ou facture, proforma → facture. Lien vers l'original.
create or replace function app.convert_document(p_org uuid, p_doc uuid, p_type text default 'invoice')
returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
  v_new uuid;
begin
  if v_doc.status not in ('issued', 'accepted', 'no_response', 'partially_paid', 'paid')
     or v_doc.type_code in ('receipt', 'delivery_note') then
    raise exception 'seul un devis, une proforma ou une facture émis se convertit' using errcode = '42501';
  end if;
  if p_type = v_doc.type_code or p_type in ('receipt')
     or not exists (select 1 from public.document_types where code = p_type and active) then
    raise exception 'type cible invalide' using errcode = '22023';
  end if;
  select d.id into v_new from public.documents d
  where d.source_document_id = p_doc and d.type_code = p_type and d.status not in ('cancelled', 'replaced')
  limit 1;
  if v_new is not null then
    return v_new;
  end if;
  v_new := app.clone_document(v_doc, p_type, 'convert');
  perform app.emit('quote_converted', p_org, jsonb_build_object('from', v_doc.type_code, 'to', p_type));
  return v_new;
end
$$;

-- Duplication (P-12) : nouveau brouillon indépendant, même contenu, sans lien.
create or replace function app.duplicate_document(p_org uuid, p_doc uuid) returns uuid
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_document(p_org, p_doc);
begin
  if v_doc.type_code = 'receipt' then
    raise exception 'un reçu ne se duplique pas' using errcode = '42501';
  end if;
  return app.clone_document(v_doc, v_doc.type_code, 'duplicate');
end
$$;

-- ---------------------------------------------------------------- numérotation

create or replace function app.set_numbering(p_org uuid, p_type text, p_patch jsonb) returns void
language plpgsql
as $$
declare
  v_type public.document_types;
  v_before jsonb;
begin
  select * into v_type from public.document_types where code = p_type;
  if not found then
    raise exception 'type inconnu' using errcode = '22023';
  end if;
  select to_jsonb(n) into v_before from public.numbering_settings n where org_id = p_org and type_code = p_type;
  insert into public.numbering_settings (org_id, type_code, prefix, separator, include_year, width, cadence)
  values (p_org, p_type,
    coalesce(p_patch ->> 'prefix', v_type.number_prefix),
    coalesce(p_patch ->> 'separator', '-'),
    coalesce((p_patch ->> 'include_year')::boolean, true),
    coalesce((p_patch ->> 'width')::smallint, (app.setting('number_width') #>> '{}')::smallint),
    coalesce(p_patch ->> 'cadence', 'annual'))
  on conflict (org_id, type_code) do update set
    prefix = coalesce(p_patch ->> 'prefix', public.numbering_settings.prefix),
    separator = coalesce(p_patch ->> 'separator', public.numbering_settings.separator),
    include_year = coalesce((p_patch ->> 'include_year')::boolean, public.numbering_settings.include_year),
    width = coalesce((p_patch ->> 'width')::smallint, public.numbering_settings.width),
    cadence = coalesce(p_patch ->> 'cadence', public.numbering_settings.cadence),
    updated_at = now();
  perform app.audit('org', p_org::text, 'set_numbering', 'numbering', p_type, v_before,
    (select to_jsonb(n) from public.numbering_settings n where org_id = p_org and type_code = p_type));
end
$$;

-- Format effectif d'un type pour une organisation (réglage ou valeurs par défaut).
create or replace function app.numbering(p_org uuid, p_type text) returns public.numbering_settings
language sql stable
as $$
  select coalesce(
    (select n from public.numbering_settings n where n.org_id = p_org and n.type_code = p_type),
    (select row(p_org, t.code, t.number_prefix, '-', true, (app.setting('number_width') #>> '{}')::smallint,
       'annual', now())::public.numbering_settings
     from public.document_types t where t.code = p_type))
$$;

create or replace function app.format_number(p_fmt public.numbering_settings, p_year integer, p_seq bigint)
returns text
language sql immutable
as $$
  select array_to_string(array_remove(array[
    nullif(p_fmt.prefix, ''),
    case when p_fmt.include_year then p_year::text end,
    lpad(p_seq::text, greatest(p_fmt.width, length(p_seq::text)), '0')
  ], null), p_fmt.separator)
$$;

-- Aperçu d'un numéro (« DEV-2026-001 ») pour l'écran de présentation.
create or replace function app.preview_number(p_org uuid, p_type text) returns text
language plpgsql stable
as $$
declare
  v_fmt public.numbering_settings := app.numbering(p_org, p_type);
  v_year integer := extract(year from current_date)::int;
  v_key integer := case when v_fmt.cadence = 'annual' then v_year else 0 end;
begin
  return app.format_number(v_fmt, v_year, coalesce((
    select last_seq from public.number_counters where org_id = p_org and type_code = p_type and year = v_key), 0) + 1);
end
$$;

-- Prochain numéro libre de la série (sans trou ; saute un numéro déjà pris à la main).
create or replace function app.next_number(p_org uuid, p_type text) returns text
language plpgsql
as $$
declare
  v_fmt public.numbering_settings := app.numbering(p_org, p_type);
  v_year integer := extract(year from current_date)::int;
  v_key integer := case when v_fmt.cadence = 'annual' then v_year else 0 end;
  v_seq integer;
  v_number text;
begin
  -- Un passage en séquence continue repart du plus haut compteur existant, jamais de zéro.
  insert into public.number_counters (org_id, type_code, year, last_seq)
  values (p_org, p_type, v_key, case when v_key = 0 then coalesce((
    select max(last_seq) from public.number_counters where org_id = p_org and type_code = p_type), 0) else 0 end)
  on conflict (org_id, type_code, year) do nothing;
  loop
    update public.number_counters set last_seq = last_seq + 1
    where org_id = p_org and type_code = p_type and year = v_key
    returning last_seq into v_seq;
    v_number := app.format_number(v_fmt, v_year, v_seq);
    exit when not exists (select 1 from public.documents where org_id = p_org and number = v_number);
  end loop;
  return v_number;
end
$$;

-- ---------------------------------------------------------------- émission

-- Ce qui manque pour émettre (P-17), affiché ou demandé dans le chat (une question à la fois).
create or replace function app.issue_blockers(p_org uuid, p_doc uuid) returns text[]
language sql stable
as $$
  select array_remove(array[
    case when not exists (select 1 from public.document_lines where document_id = p_doc and kind <> 'text') then 'no_lines' end,
    case when exists (select 1 from public.document_lines where document_id = p_doc and kind = 'priced' and quantity is null) then 'missing_quantity' end,
    case when exists (select 1 from public.document_lines where document_id = p_doc
      and ((kind = 'priced' and unit_price_minor is null) or (kind = 'flat' and flat_amount_minor is null))) then 'missing_price' end,
    case when exists (select 1 from public.document_adjustments where document_id = p_doc
      and rate_bp is null and value_minor is null) then 'missing_adjustment' end,
    case when exists (select 1 from public.document_sections s where s.document_id = p_doc
      and not exists (select 1 from public.document_lines l where l.section_id = s.id)) then 'empty_section' end,
    case when exists (select 1 from public.document_adjustments where document_id = p_doc
      and sign < 0 and base_minor + amount_minor < 0)
      or (select taxable_minor < 0 from public.documents where id = p_doc) then 'negative_total' end,
    case when (select name from public.organizations where id = p_org) is null then 'missing_business_name' end
  ], null)
$$;

create or replace function app.issuer_snapshot(p_org uuid) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'name', o.name, 'phone', o.phone, 'email', o.email, 'address', o.address,
    'country', app.label(c.labels, o.locale),
    'trade', coalesce(o.trade_label, app.label(t.labels, o.locale)),
    'legal_ids', coalesce((
      select jsonb_agg(jsonb_build_object('code', li ->> 'code', 'label', app.label(li -> 'labels', o.locale), 'value', o.legal_ids ->> (li ->> 'code')))
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

-- Émission interne : numéro (série, manuel ou révision), figeage, quota si demandé.
drop function app.issue_internal(uuid, boolean);
create or replace function app.issue_internal(p_doc uuid, p_consume boolean, p_number text default null)
returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents;
  v_type public.document_types;
  v_root public.documents;
  v_number text;
  v_manual boolean := false;
  v_blockers text[];
begin
  select * into v_doc from public.documents where id = p_doc for update;
  if v_doc.status <> 'draft' then
    raise exception 'document déjà émis' using errcode = '42501';
  end if;
  perform app.recompute_document(p_doc);
  v_blockers := app.issue_blockers(v_doc.org_id, p_doc);
  if cardinality(v_blockers) > 0 then
    raise exception 'émission impossible : %', array_to_string(v_blockers, ', ')
      using errcode = 'P0001', hint = array_to_string(v_blockers, ',');
  end if;
  select * into v_type from public.document_types where code = v_doc.type_code;

  if v_doc.revises_id is not null then
    select * into v_root from public.documents where id = v_doc.root_document_id;
    v_number := v_root.number || '/R' || v_doc.revision;
  elsif nullif(btrim(p_number), '') is not null then
    v_number := btrim(p_number);
    if v_number !~ '^[A-Za-z0-9][A-Za-z0-9_./-]{0,63}$' then
      raise exception 'numéro invalide' using errcode = '22023', hint = 'invalid_number';
    end if;
    if exists (select 1 from public.documents where org_id = v_doc.org_id and number = v_number) then
      raise exception 'numéro déjà utilisé' using errcode = '23505', hint = 'number_taken';
    end if;
    v_manual := true;
  end if;

  if p_consume and v_type.counts_quota then
    perform app.consume_unit(v_doc.org_id);
  end if;
  if v_number is null then
    v_number := app.next_number(v_doc.org_id, v_doc.type_code);
  end if;

  update public.document_lines set to_confirm = '{}' where document_id = p_doc and to_confirm <> '{}';
  update public.document_adjustments set to_confirm = false where document_id = p_doc and to_confirm;

  update public.documents d set
    status = 'issued',
    number = v_number,
    number_year = extract(year from current_date)::int,
    number_seq = null,
    manual_number = v_manual,
    issue_date = current_date,
    validity_days = case when v_type.validity_days is not null then coalesce(d.validity_days, v_type.validity_days) end,
    valid_until = case when v_type.validity_days is not null
      then current_date + coalesce(d.validity_days, v_type.validity_days) end,
    issuer_snapshot = app.issuer_snapshot(v_doc.org_id),
    client_snapshot = (select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email,
                         'address', c.address, 'legal_id', c.legal_id)
                       from public.clients c where c.id = v_doc.client_id),
    template_version = app.setting('document_template_version') #>> '{}',
    render_version = 1,
    issued_at = now()
  where d.id = p_doc
  returning * into v_doc;

  if v_manual then
    perform app.audit('org', v_doc.org_id::text, 'manual_number', 'document', p_doc::text, null,
      jsonb_build_object('number', v_number));
  end if;

  -- Mémoire : libellé, unité et dernier prix constaté (jamais proposé à sa place).
  insert into public.memory_items (org_id, label, unit, last_price_minor, currency_code)
  select v_doc.org_id, btrim(l.label), l.unit, coalesce(l.unit_price_minor, l.flat_amount_minor), v_doc.currency_code
  from public.document_lines l where l.document_id = p_doc and l.kind <> 'text'
  on conflict (org_id, lower(btrim(label))) do update set
    uses = public.memory_items.uses + 1, last_used_at = now(),
    unit = coalesce(excluded.unit, public.memory_items.unit),
    last_price_minor = coalesce(excluded.last_price_minor, public.memory_items.last_price_minor),
    currency_code = excluded.currency_code;

  perform app.enqueue_job('render_document', jsonb_build_object('document_id', p_doc, 'version', 1),
    'render:' || p_doc || ':1');
  perform app.emit('document_issued', v_doc.org_id, jsonb_build_object(
    'doc_type', v_doc.type_code, 'template', v_doc.template_code,
    'lines', (select count(*) from public.document_lines where document_id = p_doc),
    'sections', (select count(*) from public.document_sections where document_id = p_doc),
    'adjustments', (select count(*) from public.document_adjustments where document_id = p_doc),
    'currency_code', v_doc.currency_code));
  return v_doc;
end
$$;

-- Émission par l'artisan (P-09, P-10). Une révision ne consomme pas d'unité et remplace l'original.
drop function app.issue_document(uuid, uuid);
create or replace function app.issue_document(p_org uuid, p_doc uuid, p_number text default null)
returns public.documents
language plpgsql
as $$
declare
  v_doc public.documents := app.lock_draft(p_org, p_doc);
  v_issued public.documents;
begin
  v_issued := app.issue_internal(p_doc, v_doc.revises_id is null, p_number);
  if v_doc.revises_id is not null then
    update public.documents set status = 'replaced'
    where id = v_doc.revises_id and status in ('issued', 'accepted', 'refused', 'no_response');
  end if;
  return v_issued;
end
$$;

-- ---------------------------------------------------------------- suivi

-- Décision : accepté, refusé (client ou artisan), sans réponse (artisan seulement, P-15).
create or replace function app.decide_internal(p_doc public.documents, p_decision text, p_by text, p_note text)
returns void
language plpgsql
as $$
begin
  if p_decision not in ('accepted', 'refused', 'no_response') or (p_decision = 'no_response' and p_by <> 'org') then
    raise exception 'décision invalide' using errcode = '22023';
  end if;
  if not exists (select 1 from public.document_types where code = p_doc.type_code and acceptable) then
    raise exception 'ce document ne s''accepte pas' using errcode = '42501';
  end if;
  if p_doc.status not in ('issued', 'no_response') or (p_doc.status = 'no_response' and p_decision = 'no_response') then
    raise exception 'décision déjà prise ou document clos' using errcode = '42501';
  end if;
  if p_by = 'client' and p_doc.valid_until is not null and p_doc.valid_until < current_date then
    raise exception 'devis expiré' using errcode = '42501';
  end if;
  update public.documents set status = p_decision, decided_at = now(), decision_by = p_by,
    decision_note = nullif(btrim(p_note), '')
  where id = p_doc.id;
  perform app.emit(case p_decision when 'accepted' then 'quote_accepted' when 'refused' then 'quote_refused'
    else 'quote_no_response' end, p_doc.org_id, jsonb_build_object('by', p_by));
end
$$;

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

-- Document public par jeton (P-14) : chaque ouverture compte, sans rien savoir du lecteur.
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
  insert into public.document_views (document_id) values (v_doc.id)
  on conflict (document_id) do update set
    last_viewed_at = now(), view_count = public.document_views.view_count + 1;
  if v_doc.viewed_at is null then
    update public.documents set viewed_at = now() where id = v_doc.id;
    perform app.emit('document_viewed', v_doc.org_id, jsonb_build_object('doc_type', v_doc.type_code));
  end if;
  return v_doc.id;
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
    v_invoice.client_id, v_invoice.id, 'system', v_invoice.title, v_payment.method)
  returning id into v_receipt;
  perform app.insert_sections(v_receipt, jsonb_build_array(jsonb_build_object('lines', jsonb_build_array(
    jsonb_build_object('label', v_invoice.number, 'kind', 'flat', 'flat_amount_minor', v_payment.amount_minor)))));
  perform app.recompute_document(v_receipt);
  perform app.issue_internal(v_receipt, false);
  update public.document_payments set receipt_id = v_receipt where id = p_payment;
  return v_receipt;
end
$$;

-- Profil : métier libre et valeurs par défaut des devis (P-06), en plus des champs existants.
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
  where k not in ('name', 'trade_code', 'trade_label', 'country_code', 'locale', 'phone', 'email', 'address', 'legal_ids',
                  'tax_registered', 'tax_code', 'brand_color', 'template_code', 'payment_methods', 'footer_note',
                  'default_validity_days', 'default_delivery_text', 'default_warranty_text', 'default_deposit_bp');
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
    trade_label = case when p_patch ? 'trade_label' then nullif(btrim(p_patch ->> 'trade_label'), '') else o.trade_label end,
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
    footer_note = case when p_patch ? 'footer_note' then nullif(btrim(p_patch ->> 'footer_note'), '') else o.footer_note end,
    default_validity_days = case when p_patch ? 'default_validity_days' then nullif(p_patch ->> 'default_validity_days', '')::int else o.default_validity_days end,
    default_delivery_text = case when p_patch ? 'default_delivery_text' then nullif(btrim(p_patch ->> 'default_delivery_text'), '') else o.default_delivery_text end,
    default_warranty_text = case when p_patch ? 'default_warranty_text' then nullif(btrim(p_patch ->> 'default_warranty_text'), '') else o.default_warranty_text end,
    default_deposit_bp = case when p_patch ? 'default_deposit_bp' then nullif(p_patch ->> 'default_deposit_bp', '')::int else o.default_deposit_bp end
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

-- ---------------------------------------------------------------- gabarit unique

-- Le document suit la direction validée de la v1 (P-20) : un seul gabarit, la couleur et le logo
-- de l'artisan suffisent à le rendre sien. Les anciens modèles sont retirés de l'offre.
update public.templates set active = false where code <> 'classic';
update public.templates set
  labels = '{"fr":"Firmo","en":"Firmo"}',
  descriptions = '{"fr":"Document validé : entête à votre nom, objet, détail par sections, total mis en avant.","en":"Validated layout: your letterhead, subject, sections, highlighted total."}'
where code = 'classic';
alter table public.organizations disable trigger user;
update public.organizations set template_code = 'classic' where template_code <> 'classic';
alter table public.organizations enable trigger user;
update public.documents set template_code = 'classic' where status = 'draft' and template_code <> 'classic';
