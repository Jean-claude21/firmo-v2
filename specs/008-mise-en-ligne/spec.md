# Spec 008 — Mise en ligne (staging)

- Branche : `feat/008-mise-en-ligne`
- Statut : terminée pour le staging ; production à ouvrir par le porteur

## Réalisé

- Image Docker unique (web :3000 relaie `/v1` vers l'API + worker :8790), `deploy/start.mjs`,
  curl pour le contrôle de santé.
- Doppler : projet `firmo`, config `stg` (clés personnelles référencées).
- Coolify : projet `Firmo`, environnement `staging`, application `firmo-staging` (branche `dev`,
  clé de déploiement en lecture seule), https://firmo-staging.kete.digital.
- Neon : branche `staging` migrée, Neon Auth (domaine du staging autorisé), stockage S3.
- Guide d'exploitation : `docs/OPERATIONS.md`.

## Vérifié

- `/health` : base et worker actifs ; offre publique en XOF ; site et console servis ;
  captures du site en ligne relues.

## Reste à faire (porteur)

- Compte admin de la console du staging (choix de l'adresse e-mail).
- Bot Telegram, compte WhatsApp vérifié, compte Moneroo, DSN Sentry, puis production (`main`).
