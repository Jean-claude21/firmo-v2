-- Aides de test, chargées par `firmo-db test` au début de chaque transaction de test (annulée
-- ensuite) : rien ne persiste, y compris sur une branche Neon.

create schema tests;

-- Crée un utilisateur Neon Auth et renvoie son identifiant.
create function tests.create_user(p_email text) returns uuid
language sql
as $$
  insert into neon_auth."user" (name, email, "emailVerified")
  values (split_part(p_email, '@', 1), p_email, true)
  returning id
$$;

-- Organisation créée par un premier message sur le simulateur.
create function tests.new_org(p_external_id text, p_phone text default '+22890000000')
returns uuid
language sql
as $$
  select org_id from app.ensure_identity('simulator', p_external_id, 'Test', p_phone, null)
$$;
