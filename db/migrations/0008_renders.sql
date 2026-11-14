-- 0008 — Rendus des documents (spec 003 : DOC-5).
-- Chaque version émise est rendue une fois (PDF, PNG, SVG) ; les fichiers sont immuables.

create table public.document_renders (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  version integer not null check (version >= 1),
  pdf_key text not null,
  png_key text not null,
  svg_key text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  pages integer not null check (pages >= 1),
  pdf_bytes integer not null check (pdf_bytes > 0),
  duration_ms integer not null check (duration_ms >= 0),
  created_at timestamptz not null default now(),
  unique (document_id, version)
);
alter table public.document_renders enable row level security;

-- Enregistre un rendu ; idempotent (une tâche rejouée ne crée pas de doublon).
create or replace function app.record_render(
  p_doc uuid, p_version integer, p_pdf text, p_png text, p_svg text, p_sha text, p_pages integer,
  p_bytes integer, p_ms integer
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.document_renders (document_id, version, pdf_key, png_key, svg_key, sha256, pages, pdf_bytes, duration_ms)
  values (p_doc, p_version, p_pdf, p_png, p_svg, p_sha, p_pages, p_bytes, p_ms)
  on conflict (document_id, version) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.document_renders where document_id = p_doc and version = p_version;
  end if;
  return v_id;
end
$$;

-- Le rendu d'un document émis est-il prêt ?
create or replace function app.latest_render(p_doc uuid) returns public.document_renders
language sql stable
as $$
  select r.* from public.document_renders r
  join public.documents d on d.id = r.document_id and r.version = d.render_version
  where r.document_id = p_doc
$$;
