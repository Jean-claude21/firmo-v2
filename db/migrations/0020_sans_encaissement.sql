-- 0020 — Firmo ne suit pas l'argent des clients de l'artisan (spec 015, décision du porteur).
--
-- Le client paie l'artisan directement, par le moyen que l'artisan imprime sur son document.
-- Firmo produit le devis, la proforma et la facture ; il n'encaisse rien, ne note aucun paiement
-- et n'émet plus de reçu. Les fonctions restent (une migration appliquée ne se modifie pas) mais
-- refusent ; les paiements déjà notés restent lisibles dans l'historique des documents.

update public.document_types set active = false where code = 'receipt';

create or replace function app.record_payment(
  p_org uuid, p_doc uuid, p_amount bigint, p_paid_on date default current_date,
  p_method text default null, p_note text default null
) returns uuid
language plpgsql
as $$
begin
  raise exception 'Firmo ne note pas les paiements des clients : l''artisan les gère lui-même'
    using errcode = '42501', hint = 'payments_not_offered';
end
$$;

create or replace function app.issue_receipt(p_org uuid, p_payment uuid) returns uuid
language plpgsql
as $$
begin
  raise exception 'Firmo n''émet pas de reçu de paiement : l''artisan les gère lui-même'
    using errcode = '42501', hint = 'payments_not_offered';
end
$$;
