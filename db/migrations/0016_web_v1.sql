-- 0016 — Espace artisan au niveau de la v1 (spec 012, PARITE_V1 §5).

-- P-68 : un lien d'accès envoyé dans le chat se rouvre autant de fois que voulu pendant sa durée
-- (v1). L'artisan touche le lien deux fois, ou rouvre la conversation plus tard : ça marche. Durée
-- réglable dans la console (`portal_link_minutes`), 60 minutes par défaut comme la v1.
alter table public.access_links add column uses integer not null default 0;

update public.settings set value = '60', description = 'Durée pendant laquelle un lien d''accès envoyé dans le chat peut être ouvert (minutes).'
where key = 'portal_link_minutes' and value = '15';

-- Échange un lien : avant expiration, organisation active, autant de fois que nécessaire.
-- Erreurs distinctes : lien inconnu (P0002, link_invalid) et lien expiré (P0002, link_expired),
-- pour que l'écran explique quoi faire.
create or replace function app.consume_access_link(p_token_hash bytea)
returns table (org_id uuid, purpose text, target text)
language plpgsql
as $$
declare
  v_link public.access_links;
begin
  select * into v_link from public.access_links l where l.token_hash = p_token_hash for update;
  if not found then
    raise exception 'lien inconnu' using errcode = 'P0002', hint = 'link_invalid';
  end if;
  if v_link.expires_at <= now() then
    raise exception 'lien expiré' using errcode = 'P0002', hint = 'link_expired';
  end if;
  if not exists (select 1 from public.organizations o where o.id = v_link.org_id and o.status = 'active') then
    raise exception 'organisation suspendue' using errcode = '42501', hint = 'org_suspended';
  end if;
  update public.access_links set used_at = coalesce(used_at, now()), uses = uses + 1 where id = v_link.id;
  -- Première ouverture seulement : `portal_opened` compte les liens ouverts, pas les rechargements.
  if v_link.uses = 0 then
    perform app.emit('portal_opened', v_link.org_id, jsonb_build_object('purpose', split_part(v_link.purpose, ':', 1)));
  end if;
  return query select v_link.org_id, v_link.purpose, v_link.target;
end
$$;
