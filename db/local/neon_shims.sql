-- Imitation locale de Neon Auth (Managed Better Auth) : table des utilisateurs.
-- NE JAMAIS appliquer sur une branche Neon où Neon Auth est actif (staging, production) :
-- la table y existe déjà et n'est pas modifiable. Appliqué par `firmo-db local start`, la CI et
-- une branche de test jetable créée depuis `main` (`--neon-shims`).
do $shim$
begin
  if to_regclass('neon_auth."user"') is not null then
    return;
  end if;
  create schema if not exists neon_auth;
  create table neon_auth."user" (
    id uuid primary key default gen_random_uuid(),
    name text not null default '',
    email text not null unique,
    "emailVerified" boolean not null default false,
    image text,
    "createdAt" timestamptz not null default now(),
    "updatedAt" timestamptz not null default now(),
    role text,
    banned boolean,
    "banReason" text,
    "banExpires" timestamptz
  );
end
$shim$;

-- La garde de sécurité endosse ces rôles (créés aussi par la migration 0001).
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
