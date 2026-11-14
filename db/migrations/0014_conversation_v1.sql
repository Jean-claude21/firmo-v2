-- 0014 — Conversation au niveau de la v1 (spec 010, PARITE_V1 §3).

-- Demandes sur les données (P-42, P-82, P-83) : faites depuis le chat ou l'espace, traitées par
-- l'équipe, chaque étape journalisée.
create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  identity_id uuid references public.channel_identities (id) on delete set null,
  kind text not null check (kind in ('deletion', 'export')),
  status text not null default 'pending' check (status in ('pending', 'done', 'rejected')),
  origin text not null check (origin in ('chat', 'web', 'staff')),
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by text
);
create index data_requests_pending on public.data_requests (status, created_at) where status = 'pending';
create unique index data_requests_one_pending on public.data_requests (org_id, kind) where status = 'pending';
alter table public.data_requests enable row level security;

create or replace function app.request_data(p_org uuid, p_identity uuid, p_kind text, p_origin text) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.data_requests where org_id = p_org and kind = p_kind and status = 'pending';
  if v_id is not null then
    return v_id;
  end if;
  insert into public.data_requests (org_id, identity_id, kind, origin) values (p_org, p_identity, p_kind, p_origin)
  returning id into v_id;
  perform app.audit('org', p_org::text, 'data_request', 'data_request', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'origin', p_origin));
  perform app.emit('data_' || p_kind || '_requested', p_org, jsonb_build_object('origin', p_origin));
  return v_id;
end
$$;

-- Statistiques demandées dans le chat (« combien de devis ce mois ? »).
create or replace function app.org_chat_stats(p_org uuid) returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'drafts', count(*) filter (where d.status = 'draft'),
    'issued', count(*) filter (where d.status not in ('draft', 'cancelled', 'replaced') and d.type_code <> 'receipt'),
    'quotes', count(*) filter (where d.type_code = 'quote' and d.status not in ('draft', 'cancelled', 'replaced')),
    'invoices', count(*) filter (where d.type_code = 'invoice' and d.status not in ('draft', 'cancelled', 'replaced')),
    'accepted', count(*) filter (where d.type_code = 'quote' and d.status = 'accepted')
  )
  from public.documents d where d.org_id = p_org
$$;
