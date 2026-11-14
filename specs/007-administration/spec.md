# Spec 007 — Administration

- Branche : `feat/007-administration`
- Fonctionnalités : ADM-1 à ADM-7
- Statut : terminée

## Objectif

Console de l'équipe : connexion Neon Auth (e-mail et mot de passe vérifiés par l'API, rôle en base),
tableau de bord (indicateur décisif, fidélité de lecture, acceptation, conversion, coût IA, revenus,
activité par jour), organisations (fiche, suspension, période offerte), console des conversations et
des tâches (relance), simulateur de chat, IA et coûts, configuration générique (offres versionnées,
modèles d'IA et prix, drapeaux, réglages, canaux, fournisseurs de paiement, pays, devises, métiers,
types, modèles), équipe, journal d'audit.

## Règles

1. Lecture : admin et support. Écriture : admin seulement, vérifiée en SQL (`app.require_staff`).
2. Configuration : seuls les champs listés par table sont modifiables ; tout est audité.
3. Une offre modifiée = une nouvelle version ; les abonnements gardent la leur.
4. En local sans Neon Auth : connexion par e-mail d'un membre (jamais en ligne).

## Vérification

- pgTAP 018 ; vitest : connexion, droits admin/support, tableau de bord, configuration, offres,
  organisations, journal.
- Captures de la console (téléphone, ordinateur) ; parcours complet du simulateur dans le navigateur
  avec l'IA réelle (vente → nom → émission → aperçu, PDF et lien) ; page publique relue.
