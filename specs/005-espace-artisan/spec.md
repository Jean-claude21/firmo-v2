# Spec 005 — Espace artisan et page publique

- Branche : `feat/005-espace-artisan`
- Fonctionnalités : ART-1 à ART-5, ART-7, CH-4 (formulaires web)
- Statut : terminée

## Objectif

Le web complète le chat : site public, accès par lien signé, tableau de bord, documents (liste,
création, brouillon, émission, partage, conversion, paiements, reçus), clients, profil et en-tête
(logo, couleur tirée du logo, modèle, mentions légales du pays), page publique du document pour
le client (consultation, PDF, acceptation ou refus).

## Architecture

- TanStack Start + Tailwind v4 (`web/`). Une image : le serveur web relaie `/v1` vers l'API
  (décision 0005, précision du 2026-11-14).
- API : `routes/portal.ts` (session artisan), `/v1/public/*` (jeton de partage, offre).
- SQL : `0010_portal.sql` (profil validé et audité, clients, tableau de bord).
- Textes : `web/src/l10n` (fr, en, mêmes clés vérifiées par test).

## Vérification

- pgTAP 016 ; vitest API : parcours web complet sur Postgres (profil, logo, création avec prix
  tapés, émission, rendu, partage, page publique, décision, conversion, paiement, reçu).
- Web : build, types, tests ; captures téléphone et ordinateur relues (accueil, tableau de bord,
  documents, profil, clients) sans débordement.

## Non vérifié

- Démo sur un vrai Android d'entrée de gamme.
