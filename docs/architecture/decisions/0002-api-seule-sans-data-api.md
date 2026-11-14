# 0002 — Le web passe uniquement par l'API

- Date : 2026-11-14
- Statut : acceptée

## Contexte

Les artisans n'ont pas de compte Neon Auth : leur identité est l'identifiant de messagerie. Les
clients des artisans n'ont aucun compte.

## Décision

La Data API n'est pas activée. L'API émet ses propres JWT (artisan, admin) et appelle des fonctions
SQL avec l'organisation de la session. Toutes les tables gardent RLS activé sans droit accordé aux
rôles de la Data API, pour qu'une activation accidentelle n'expose rien. Neon Auth reste le
référentiel des comptes admin.

## Conséquences

- Une seule surface à sécuriser (l'API), testée par vitest et pgTAP.
- Pas de cookie tiers dans le navigateur.
