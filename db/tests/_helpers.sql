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

-- Organisation nommée, prête à émettre.
create function tests.ready_org(p_external_id text, p_phone text default '+22890000000')
returns uuid
language plpgsql
as $$
declare
  v_org uuid := tests.new_org(p_external_id, p_phone);
begin
  update public.organizations set name = 'Atelier ' || p_external_id where id = v_org;
  return v_org;
end
$$;

-- Ligne JSON complète.
create function tests.line(p_label text, p_qty numeric, p_price bigint, p_unit text default 'unit')
returns jsonb
language sql immutable
as $$
  select jsonb_build_object('label', p_label, 'quantity', p_qty, 'unit', p_unit, 'unit_price_minor', p_price)
$$;
