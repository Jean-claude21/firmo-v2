-- 0001 — Socle (spec 001).
-- Schéma interne `app`, horodatage, droits par défaut fermés (décision 0002).

-- Rôles de la Data API. Firmo ne l'active pas, mais les rôles existent pour que la garde
-- (db/tests/000_security_guard.sql) prouve qu'aucune table ne leur est accordée.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anonymous') then
    create role anonymous nologin;
  end if;
end
$$;

-- Fonctions internes : appelées par l'API (propriétaire de la base), jamais exposées.
create schema if not exists app;
revoke all on schema app from public;

-- Trigger : `updated_at = now()` à chaque mise à jour.
create or replace function app.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Rien n'est accordé par défaut aux rôles de la Data API.
revoke all on schema public from anonymous, authenticated;
alter default privileges in schema public revoke all on tables from authenticated, anonymous;
alter default privileges in schema public revoke all on sequences from authenticated, anonymous;
alter default privileges revoke execute on functions from public;

-- Texte localisé : {"fr": "...", "en": "..."} ; au moins une langue.
create or replace function app.is_labels(value jsonb) returns boolean
language sql immutable
as $$
  select jsonb_typeof(value) = 'object'
     and value <> '{}'::jsonb
     and not exists (
       select 1 from jsonb_each(value) e
       where e.key !~ '^[a-z]{2}$' or jsonb_typeof(e.value) <> 'string' or e.value #>> '{}' = ''
     )
$$;

-- Libellé dans une langue, repli sur le français puis sur la première langue.
create or replace function app.label(value jsonb, locale text) returns text
language sql immutable
as $$
  select coalesce(
    value ->> split_part(locale, '-', 1),
    value ->> 'fr',
    (select e.value #>> '{}' from jsonb_each(value) e order by e.key limit 1)
  )
$$;
