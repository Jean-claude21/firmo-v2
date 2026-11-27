# Architecture — Firmo

## Vue d'ensemble

```text
 WhatsApp / Telegram / simulateur              Navigateur (artisan, client, admin)
            │ webhooks signés                              │ HTTPS
            ▼                                              ▼
 ┌──────────── Coolify (serveur kete-contabo), un couple par environnement ────────────┐
 │  une image : web TanStack Start (:3000, relaie /v1) + API Hono et worker (:8790)       │
 │   ├─ HTTP : webhooks, portail artisan, page client, admin, santé                      │
 │   └─ worker : file `jobs` en Postgres (SKIP LOCKED) → IA, rendu Typst, envois          │
 └───────────────┬──────────────────────────────┬──────────────────────────┬────────────┘
                 ▼                              ▼                          ▼
       Neon Postgres (règles SQL,      Neon Object Storage (S3)       Neon Auth (admins)
       RLS, pgTAP, branches)           inbox · brand · documents
```

- **API et worker dans le même conteneur.** Un webhook enregistre le message, crée une tâche et
  répond tout de suite. Le worker réclame les tâches (`app.claim_job`, `FOR UPDATE SKIP LOCKED`),
  avec reprises et délai croissant ; un `NOTIFY` le réveille sans attendre. Les tâches planifiées
  (expirations, rappels) tournent dans le même processus.
- **Pas de Data API** : le web ne parle qu'à l'API. Toutes les tables ont RLS, aucun droit pour
  `anonymous`/`authenticated` (garde pgTAP, décision 0002).
- **Règles en SQL** (schéma `app`) : l'API vérifie l'identité, puis appelle une fonction SQL
  transactionnelle avec l'organisation de la session.
- **Pourquoi Coolify** (décision 0005) : traitements longs (IA + rendu), paquets natifs, worker
  permanent, serveur déjà payé ; Neon garde les données, l'identité admin et les fichiers.

## Dépôt

```text
firmo/
├── db/            migrations (NNNN_*.sql), tests pgTAP, imitations Neon locales, firmo-db.mjs
├── api/           Hono + worker : src/, templates/ (Typst + polices), test/, Dockerfile
├── web/           TanStack Start : site, /app (artisan), /d/:token (client), /admin, Dockerfile
├── neon.ts        politique Neon (auth, buckets, branches)
├── docs/          product/, architecture/, design/, OPERATIONS.md
├── specs/         une spec Spec Kit par dossier
└── scripts/       secrets.mjs (Doppler)
```

## Identité et sessions

| Qui | Comment | Jeton |
|---|---|---|
| Artisan dans le chat | identifiant de messagerie (`channel_identities`) | — |
| Artisan sur le web | lien réutilisable pendant sa durée (60 min, haché en base) envoyé dans le chat → échange | JWT Firmo `scope=org`, 7 jours |
| Équipe depuis le chat | « ADMIN » depuis une identité autorisée → lien à usage unique (10 min) | JWT Firmo `scope=staff` |
| Client de l'artisan | jeton de partage du document (non devinable, révocable) | — |
| Admin | e-mail + mot de passe Neon Auth, vérifiés par l'API, rôle en SQL | JWT Firmo `scope=staff`, 12 h |

JWT Firmo signés HS256 avec `FIRMO_SESSION_SECRET`.

## Conversation

1. Webhook → vérification → `app.receive_message` (idempotent sur `channel` + `external_id`) +
   tâche `process_message`.
2. Worker : média téléchargé dans `inbox`, transcription si vocal.
3. Intention (règles rapides, puis IA) : nouveau document, correction, validation, conversion,
   paiement noté, liste, réglages, aide.
4. Lecture structurée (schéma zod) ; **garde anti-invention** : un nombre lu dans un texte ou une
   transcription doit y figurer, sinon la valeur devient « à confirmer ».
5. Brouillon et corrections en SQL ; réponses rédigées par `voix` (fr, en).
6. Émission (`app.issue_document`) → rendu Typst → stockage → envoi du PNG, du PDF et du lien.

## Rendu

Un gabarit Typst par modèle (`classic`, `modern`, `clean`) reçoit un JSON préparé par
`render/model.ts` (montants formatés selon la devise, montant en lettres, QR en SVG). Sorties : PDF,
SVG (aperçu web), PNG de la première page (aperçu dans le chat). Polices dans `api/templates/fonts`.

## Environnements

| Environnement | Base | API | Web |
|---|---|---|---|
| local | Postgres 17 local (`firmo-db local start`, port 54330), fichiers sur disque | `npm run dev` (:8790) | `npm run dev` (:3000) |
| staging | branche Neon `staging` | Coolify `firmo-staging` (une image) | même image |
| production | branche Neon `main` | Coolify `firmo` (une image) | même image |
