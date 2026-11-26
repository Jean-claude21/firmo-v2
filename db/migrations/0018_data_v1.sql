-- 0018 — Mesure et données au niveau de la v1 (spec 014, PARITE_V1 §7).

-- ---------------------------------------------------------------- P-81 rétention des médias

-- Les vocaux et photos sources ne servent qu'à la lecture : ils sont supprimés après une durée
-- réglable. Le texte lu (transcription) et le document restent.
insert into public.settings (key, value, description) values
  ('media_retention_days', '30', 'Jours pendant lesquels les vocaux et photos sources sont gardés après réception.')
on conflict (key) do nothing;

alter table public.messages add column media_purged_at timestamptz;

create or replace function app.check_setting() returns trigger
language plpgsql
as $$
declare
  v_bounds jsonb := '{
    "portal_link_minutes": [5, 1440], "admin_link_minutes": [2, 60], "org_session_days": [1, 90],
    "staff_session_hours": [1, 72], "price_reveal_minutes": [1, 120], "subscription_warn_days": [0, 30],
    "trial_documents": [0, 100], "quota_warning_percent": [50, 99], "media_retention_days": [1, 365]
  }';
  v_n numeric;
begin
  if v_bounds ? new.key then
    if jsonb_typeof(new.value) <> 'number' then
      raise exception 'valeur numérique attendue pour %', new.key using errcode = '22023';
    end if;
    v_n := (new.value #>> '{}')::numeric;
    if v_n <> trunc(v_n) or v_n < (v_bounds -> new.key ->> 0)::numeric or v_n > (v_bounds -> new.key ->> 1)::numeric then
      raise exception '% doit être un entier entre % et %', new.key, v_bounds -> new.key ->> 0, v_bounds -> new.key ->> 1 using errcode = '22023';
    end if;
  end if;
  return new;
end
$$;

-- Médias à supprimer du stockage (le plus ancien d'abord).
create or replace function app.media_to_purge(p_limit integer default 200)
returns table (message_id uuid, media_key text)
language sql stable
as $$
  select m.id, m.media_key from public.messages m
  where m.direction = 'in' and m.media_key is not null and m.media_purged_at is null
    and m.kind in ('audio', 'image')
    and m.created_at < now() - make_interval(days => coalesce((app.setting('media_retention_days') #>> '{}')::int, 30))
  order by m.created_at
  limit greatest(p_limit, 1)
$$;

-- Fichiers effacés du stockage : la référence part, la date reste.
create or replace function app.mark_media_purged(p_ids uuid[]) returns integer
language plpgsql
as $$
declare
  v_n integer;
begin
  update public.messages set media_key = null, media_ref = null, media_purged_at = now()
  where id = any(p_ids) and media_purged_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ---------------------------------------------------------------- P-83 suppression des données

alter table public.organizations drop constraint organizations_status_check;
alter table public.organizations add constraint organizations_status_check check (status in ('active', 'suspended', 'deleted'));

-- Exécute une demande de suppression. Supprimé : conversations, identités, médias, clients sans
-- document émis, brouillons, clauses, mémoire des postes, présentation et logo. Conservé (obligation
-- légale ou comptable, accès limité) : documents émis avec leur en-tête figé, paiements notés,
-- abonnements et paiements de l'abonnement, journal d'audit. L'organisation passe à « deleted ».
-- Renvoie les clés de stockage à effacer (médias, logo), que l'API supprime ensuite.
create or replace function app.execute_deletion(p_staff uuid, p_request uuid, p_reason text) returns jsonb
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
  v_req public.data_requests;
  v_org public.organizations;
  v_media text[];
  v_counts jsonb;
begin
  perform app.require_staff(p_staff, true);
  select * into v_req from public.data_requests where id = p_request for update;
  if not found or v_req.kind <> 'deletion' then
    raise exception 'demande de suppression introuvable' using errcode = 'P0002';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'demande déjà traitée' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = v_req.org_id for update;

  select coalesce(array_agg(media_key), '{}') into v_media from public.messages where org_id = v_org.id and media_key is not null;
  v_counts := jsonb_build_object(
    'messages', (select count(*) from public.messages where org_id = v_org.id),
    'drafts', (select count(*) from public.documents where org_id = v_org.id and status = 'draft'),
    'clients', (select count(*) from public.clients c where c.org_id = v_org.id
                and not exists (select 1 from public.documents d where d.client_id = c.id and d.status <> 'draft')),
    'kept_documents', (select count(*) from public.documents where org_id = v_org.id and status <> 'draft'));

  delete from public.messages where org_id = v_org.id;
  delete from public.conversation_states where identity_id in (select id from public.channel_identities where org_id = v_org.id);
  delete from public.access_links where org_id = v_org.id;
  -- Brouillons : leurs lignes d'abord (la garde des documents émis lit le statut du parent).
  delete from public.document_lines where document_id in (select id from public.documents where org_id = v_org.id and status = 'draft');
  delete from public.document_adjustments where document_id in (select id from public.documents where org_id = v_org.id and status = 'draft');
  delete from public.document_sections where document_id in (select id from public.documents where org_id = v_org.id and status = 'draft');
  delete from public.document_clauses where document_id in (select id from public.documents where org_id = v_org.id and status = 'draft');
  delete from public.documents where org_id = v_org.id and status = 'draft';
  delete from public.clients c where c.org_id = v_org.id
    and not exists (select 1 from public.documents d where d.client_id = c.id);
  delete from public.clauses where org_id = v_org.id;
  delete from public.memory_items where org_id = v_org.id;
  -- Les identités (identifiant de messagerie = téléphone) partent ; les demandes gardent leur trace.
  update public.data_requests set identity_id = null where org_id = v_org.id;
  delete from public.channel_identities where org_id = v_org.id;
  update public.organizations set
    name = null, phone = null, email = null, address = null, legal_ids = '{}', logo_key = null,
    payment_methods = null, footer_note = null, trade_label = null, status = 'deleted'
  where id = v_org.id;

  update public.data_requests set status = 'done', handled_at = now(), handled_by = p_staff::text, note = v_reason where id = p_request;
  perform app.audit('staff', p_staff::text, 'execute_deletion', 'organization', v_org.id::text,
    v_counts, jsonb_build_object('reason', v_reason, 'request', p_request));
  perform app.emit('data_deleted', v_org.id, jsonb_build_object('kept_documents', v_counts -> 'kept_documents'));
  return jsonb_build_object('media_keys', to_jsonb(v_media), 'logo_key', v_org.logo_key, 'counts', v_counts);
end
$$;

-- Une demande refusée (titulaire non vérifié, demande en double) : motif au journal.
create or replace function app.reject_data_request(p_staff uuid, p_request uuid, p_reason text) returns void
language plpgsql
as $$
declare
  v_reason text := app.require_reason(p_reason);
begin
  perform app.require_staff(p_staff, true);
  update public.data_requests set status = 'rejected', handled_at = now(), handled_by = p_staff::text, note = v_reason
  where id = p_request and status = 'pending';
  if not found then
    raise exception 'demande introuvable ou déjà traitée' using errcode = 'P0002';
  end if;
  perform app.audit('staff', p_staff::text, 'reject_data_request', 'data_request', p_request::text, null, jsonb_build_object('reason', v_reason));
end
$$;

-- ---------------------------------------------------------------- P-80 relais des événements

-- Propriétés relayées : seulement des clés techniques connues (aucun nom, téléphone, prix, texte).
create or replace function app.analytics_batch(p_limit integer default 500)
returns table (id bigint, name text, org_id uuid, props jsonb, created_at timestamptz)
language sql stable
as $$
  select e.id, e.name, e.org_id,
         coalesce((select jsonb_object_agg(k, v) from jsonb_each(e.props) as x(k, v)
                   where k in ('channel', 'kind', 'lines', 'to_confirm', 'duration_ms', 'cost_micro_usd', 'field', 'doc_type', 'template',
                               'currency_code', 'via', 'purpose', 'partial', 'plan_code', 'plan_version', 'provider', 'units', 'stage',
                               'origin', 'country_code', 'sections', 'kept_documents')
                     and jsonb_typeof(v) in ('number', 'boolean', 'string')
                     and (jsonb_typeof(v) <> 'string' or length(v #>> '{}') <= 40)), '{}'::jsonb),
         e.created_at
  from public.analytics_events e
  where e.forwarded_at is null
  order by e.id
  limit greatest(p_limit, 1)
$$;

create or replace function app.mark_forwarded(p_ids bigint[]) returns void
language sql
as $$
  update public.analytics_events set forwarded_at = now() where id = any(p_ids)
$$;
