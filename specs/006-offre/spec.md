# Spec 006 — Offre et abonnement

- Branche : `feat/006-offre`
- Fonctionnalités : OFF-1, OFF-3, ART-6
- Statut : terminée

## Règles

1. Le montant d'un paiement vient de l'offre active dans la devise de l'organisation (SQL).
2. Une clé d'idempotence par paiement ; même clé, même paiement.
3. La confirmation du fournisseur est vérifiée (signature, puis relecture chez Moneroo), appliquée
   une seule fois (`payment_events`), refusée si montant ou devise diffèrent.
4. Réussite : période payée (renouvellement anticipé : à la suite de la période en cours),
   `subscription_paid`, audit, message dans le chat de l'artisan.
5. Simulateur seulement hors production ; Moneroo dès que la clé est configurée et le fournisseur
   activé en base.

## Vérification

- pgTAP 017 ; vitest : simulateur de bout en bout, Moneroo factice (e-mail exigé, signature,
  relecture, doublon ignoré) ; capture de la page Abonnement.

## Non vérifié

- Moneroo réel (compte de l'entreprise à créer par le porteur).
