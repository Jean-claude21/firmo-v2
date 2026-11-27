# 0006 — Chariow, fournisseur de paiement de l'abonnement

- Date : 2026-11-26
- Statut : acceptée (spec 011)

## Contexte

La constitution nomme deux fournisseurs pour le paiement de l'abonnement : le simulateur et
Moneroo. La v1 encaissait ses abonnements avec Chariow (Mobile Money et carte), et un vrai
paiement y a été rapproché en 2026-08. La parité v1 (P-56) exige Chariow.

## Décision

Chariow s'ajoute derrière la même interface `PaymentProvider`, à côté de Moneroo et du simulateur :

- passage en caisse créé côté serveur, pour le produit Chariow de la version d'offre
  (`plans.provider_products.chariow`), avec e-mail, téléphone et pays pré-remplis ;
- avis « pulse » signés HMAC-SHA256 (`x-chariow-signature: sha256=…`), événement de l'en-tête
  identique à celui du corps ;
- chaque vente est relue chez Chariow (statut, montant, devise, produit) avant d'être appliquée par
  `app.settle_subscription_payment`, qui reste la seule règle ;
- rapprochement par un administrateur : la vente est relue chez Chariow, jamais saisie à la main.

Chariow n'est proposé que si `CHARIOW_API_KEY` est configurée **et** le fournisseur activé en base.
Moneroo reste disponible.

## Conséquences

- Ligne « Paiement de l'abonnement » de la constitution : simulateur, Moneroo, Chariow.
- Secrets `CHARIOW_API_KEY`, `CHARIOW_PULSE_SECRET` (Doppler `firmo-api`).
- Firmo n'encaisse toujours rien pour les clients des artisans (décision 0003) : Chariow ne sert
  qu'à l'abonnement à Firmo.
