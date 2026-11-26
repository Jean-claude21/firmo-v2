# 0008 — Firmo ne suit pas les paiements des clients

- Date : 2026-11-27
- Statut : acceptée (décision du porteur)
- Amende : 0003

## Décision

Le client de l'artisan paie l'artisan directement, par les moyens que l'artisan imprime sur ses
documents. Firmo produit le devis, la facture proforma au besoin et la facture finale ; il ne prend
aucun paiement, n'en note aucun et n'émet plus de reçu.

- `app.record_payment` et `app.issue_receipt` refusent (migration 0020) ; le type « reçu » n'est
  plus proposé. Les paiements notés avant 0020 restent lisibles dans l'historique des documents.
- Dans la conversation, « payé 50 000 » ou « reçu » reçoivent une réponse claire, sans rien noter
  ni créer de ligne.
- L'espace artisan n'affiche plus de suivi d'encaissement ; la facture reste « émise ».

## Pourquoi

L'artisan gère son argent lui-même. Un suivi partiel des paiements donnait l'impression que Firmo
s'en occupait. Il n'en a pas le rôle. Moins de surface, une promesse plus nette : « Firmo ne
touche jamais à l'argent de tes clients. »

## Conséquences

- La facture n'a plus les statuts « acompte reçu » ni « payée » pour les nouveaux documents.
- Le seul paiement que Firmo traite est l'abonnement de l'artisan (décision 0006, Chariow).
