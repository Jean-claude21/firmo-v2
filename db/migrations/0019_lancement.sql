-- 0019 — Lancement en Afrique (spec 015).

-- Firmo se lance en Afrique : les pays européens restent en base mais ne sont plus proposés.
update public.countries set active = false where code in ('FR', 'BE');

-- ---------------------------------------------------------------- mention de TVA

-- La plupart des artisans ne sont pas assujettis à la TVA. Leur document le dit, avec la formule
-- du pays (donnée de référence, modifiable dans la console) ; jamais quand le document porte une taxe.
alter table public.countries add column tax_exempt_mention jsonb not null default '{}' check (app.is_labels(tax_exempt_mention) or tax_exempt_mention = '{}');

update public.countries set tax_exempt_mention = '{"fr":"Non assujetti à la TVA","en":"Not registered for VAT"}'
where code in ('BF', 'BJ', 'CD', 'CG', 'CI', 'CM', 'GA', 'GN', 'ML', 'NE', 'SN', 'TD', 'TG', 'MA');
update public.countries set tax_exempt_mention = '{"fr":"Non assujetti à la TVA","en":"Not registered for VAT"}'
where code in ('GH', 'NG', 'KE', 'RW');

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
    'brand_color', o.brand_color, 'logo_key', o.logo_key,
    'tax_mention', case when not o.tax_registered and c.tax_exempt_mention <> '{}' then app.label(c.tax_exempt_mention, o.locale) end
  )
  from public.organizations o
  join public.countries c on c.code = o.country_code
  left join public.trades t on t.code = o.trade_code
  where o.id = p_org
$$;

-- ---------------------------------------------------------------- changement de numéro

-- L'identité d'un artisan, c'est son numéro. S'il change de numéro, il écrit à Firmo depuis le
-- nouveau : une organisation vide est créée. L'équipe vérifie que c'est bien lui, puis rattache la
-- nouvelle identité à son organisation d'origine ; l'organisation vide disparaît. Motif au journal.
create or replace function app.move_identity(p_staff uuid, p_identity uuid, p_target_org uuid, p_reason text) returns void
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_source uuid;
begin
  perform app.require_staff(p_staff, true);
  select org_id into v_source from public.channel_identities where id = p_identity for update;
  if v_source is null then
    raise exception 'identité introuvable' using errcode = 'P0002';
  end if;
  if v_source = p_target_org then
    raise exception 'identité déjà rattachée à cette organisation' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_target_org and status <> 'deleted') then
    raise exception 'organisation cible introuvable' using errcode = 'P0002';
  end if;
  -- On ne fusionne jamais deux comptes réels : l'organisation d'origine du nouveau numéro doit être vide.
  if exists (select 1 from public.documents where org_id = v_source)
     or exists (select 1 from public.subscription_payments where org_id = v_source) then
    raise exception 'le nouveau numéro a déjà des documents ou des paiements : rattachement refusé' using errcode = '22023', hint = 'source_not_empty';
  end if;
  update public.messages set org_id = p_target_org where identity_id = p_identity;
  update public.channel_identities set org_id = p_target_org where id = p_identity;
  if not exists (select 1 from public.channel_identities where org_id = v_source) then
    delete from public.access_links where org_id = v_source;
    delete from public.subscriptions where org_id = v_source;
    delete from public.data_requests where org_id = v_source;
    delete from public.messages where org_id = v_source;
    delete from public.organizations where id = v_source;
  end if;
  perform app.audit('staff', p_staff::text, 'move_identity', 'channel_identity', p_identity::text,
    jsonb_build_object('org_id', v_source), jsonb_build_object('org_id', p_target_org, 'reason', v_reason));
end
$$;
