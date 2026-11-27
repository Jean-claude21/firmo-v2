# Exploitation — Firmo

## Vue d'ensemble

| Environnement | Base Neon | Coolify | Adresse | Branche git |
|---|---|---|---|---|
| staging | `staging` (`br-blue-union-b9zi60ox`) | projet `Firmo`, env. `staging`, app `firmo-staging` | https://firmo-staging.kete.digital | `dev` |
| production | `main` (protégée, jamais touchée par un agent) | à créer à la mise en production | domaine à choisir | `main` |

Une seule image Docker (`Dockerfile`) : le web (port 3000) relaie `/v1` et `/health` vers l'API +
worker (port 8790) du même conteneur (décision 0005).

## Neon

- Projet `firmo`, id `quiet-shape-35108334`, région `aws-eu-central-1`, Postgres 18.
- Politique : `neon.ts` (Neon Auth, bucket privé `firmo-files`, durée des branches).

```bash
export NEON_API_KEY=…   # Doppler personal-keys / NEON_API_TOKEN, jamais affiché
P=quiet-shape-35108334
npx neonctl deploy --project-id $P --branch staging --no-env-pull           # applique neon.ts
URL="$(npx neonctl connection-string staging --project-id $P)"
node db/scripts/firmo-db.mjs migrate --url "$URL"                           # avant chaque déploiement

# pgTAP sur une branche jetable (Neon Auth hérité de staging), puis suppression
npx neonctl branches create --project-id $P --name test-spec-NNN --parent staging
node db/scripts/firmo-db.mjs test --url "$(npx neonctl connection-string test-spec-NNN --project-id $P)"
npx neonctl branches delete test-spec-NNN --project-id $P

# Variables de la branche (base, Neon Auth, clés S3) → fichier hors dépôt
npx neonctl env pull --project-id $P --branch staging   # écrit .env.local : le déplacer dans ../.secrets/

# Domaines autorisés par Neon Auth (connexion de l'équipe)
npx neonctl neon-auth domain add https://firmo-staging.kete.digital --project-id $P --branch staging
```

## Secrets (Doppler)

Projet `firmo`, configs `stg` et `prd`. Les clés personnelles (OpenAI…) sont des références
`${personal-keys.prd.NOM}`, jamais des copies. Coolify reçoit les valeurs calculées.

| Variable | Rôle |
|---|---|
| `FIRMO_ENV` | `staging` ou `production` (le simulateur de paiement est refusé en production) |
| `DATABASE_URL` | branche Neon (connexion poolée) |
| `FIRMO_SESSION_SECRET`, `FIRMO_SHARE_SECRET` | sessions, liens de partage (les changer révoque tout) |
| `WEB_URL`, `API_URL`, `ALLOWED_ORIGINS` | adresse publique (identique pour le web et l'API) |
| `NEON_AUTH_URL` | connexion de l'équipe |
| `S3_*` | stockage objet de la branche |
| `OPENAI_API_KEY` | lecture IA (vide : lecture simplifiée, signalée) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` | canal Telegram |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_FLOW_PROFILE_ID` | canal WhatsApp |
| `WHATSAPP_NOTICE_TEMPLATE` | modèle Meta des avis hors fenêtre de 24 h (`firmo_avis` par défaut ; vide : aucun) |
| `MONEROO_SECRET_KEY`, `MONEROO_WEBHOOK_SECRET` | paiement de l'abonnement (Moneroo) |
| `CHARIOW_API_KEY`, `CHARIOW_PULSE_SECRET` | paiement de l'abonnement (Chariow) ; plusieurs secrets Pulse séparés par des virgules |
| `ERROR_REPORTING_DSN` | Sentry (projet `firmo`, organisation Kete, données en Allemagne) |
| `VITE_WHATSAPP_NUMBER`, `VITE_TELEGRAM_BOT` | variables de construction du site (boutons « Commencer », liens vers la conversation) |
| `VITE_PUBLISHER_NAME`, `VITE_PUBLISHER_DETAILS` | éditeur affiché sur Conditions et Confidentialité (rien d'affiché sans valeur) |
| `VITE_SUPPORT_EMAIL`, `VITE_SUPPORT_WHATSAPP`, `VITE_SUPPORT_HOURS` | page Contact (seuls les canaux renseignés sont affichés) |
| `UMAMI_URL`, `UMAMI_WEBSITE_ID` | relais des événements serveur vers l'Umami de Kete (sans valeur : aucun envoi) |
| `VITE_UMAMI_SCRIPT_URL`, `VITE_UMAMI_WEBSITE_ID` | mesure des pages publiques, sans cookie (variables de construction du web) |

## Déployer le staging

1. Fusionner dans `dev` (CI verte).
2. Migrer la branche Neon `staging` (`firmo-db migrate`).
3. Lancer le déploiement Coolify de `firmo-staging` (bouton Deploy ou API `GET /api/v1/deploy?uuid=<app>`).
4. Vérifier `https://firmo-staging.kete.digital/health` (base et worker à `true`).

## Brancher les canaux

- **Telegram** : créer le bot avec BotFather, mettre `TELEGRAM_BOT_TOKEN` et un
  `TELEGRAM_WEBHOOK_SECRET` aléatoire, redéployer, puis
  `https://api.telegram.org/bot<jeton>/setWebhook?url=<API_URL>/v1/webhooks/telegram&secret_token=<secret>`.
  Activer le canal `telegram` dans la console (Configuration → Canaux).
- **WhatsApp** (Meta, compte vérifié) : webhook `<API_URL>/v1/webhooks/whatsapp`, jeton de
  vérification = `WHATSAPP_VERIFY_TOKEN`, abonnement au champ `messages`. Activer le canal
  `whatsapp`. Flows : publier le Flow « profil », mettre son identifiant dans
  `WHATSAPP_FLOW_PROFILE_ID` et activer le drapeau `whatsapp_flows`.
- **Moneroo** : webhook `<API_URL>/v1/billing/webhooks/moneroo` ; activer le fournisseur
  `moneroo` dans la console (Configuration → Canaux et paiement).
- **Chariow** (paiement de l'abonnement, activation automatique). La console l'affiche aussi
  (Paiements → « Paiement de l'abonnement : Chariow ») avec l'adresse à copier et les avis reçus :
  1. Produit au prix de l'offre dans la boutique (v1 : `prd_s1bcdqkm`, 2 000 F CFA) ; son
     identifiant va dans la version d'offre (console → Offres → Produit Chariow).
  2. Chariow → Automatisations → Pulses → Nouveau Pulse : URL
     `https://firmo.kete.digital/v1/billing/webhooks/chariow` (staging :
     `https://firmo-staging.kete.digital/v1/billing/webhooks/chariow`), événement « Vente réussie »
     (`successful.sale`). Un seul Pulse peut couvrir toute la boutique : les ventes sans
     `firmo_payment_id` sont ignorées.
  3. Copier le secret de signature du Pulse (`whsec_…`) dans `CHARIOW_PULSE_SECRET` (plusieurs
     Pulses : secrets séparés par des virgules) et la clé d'API dans `CHARIOW_API_KEY`, redéployer.
  4. Activer Chariow depuis la console, tester avec le bouton de test du Pulse : l'avis apparaît
     dans la console. Après une vraie vente, la période s'ouvre seule et l'artisan est prévenu
     dans sa conversation. Chaque avis est relu chez Chariow avant d'être appliqué.
  Un paiement resté « en attente » se rapproche depuis la fiche de l'organisation (« Relire chez le
  fournisseur », motif obligatoire).
- **Modèle WhatsApp des avis** : hors de la fenêtre de 24 h après le dernier message de l'artisan,
  WhatsApp n'accepte qu'un modèle approuvé. Créer dans Meta (WhatsApp Manager → Modèles) le modèle
  `firmo_avis`, catégorie « Utilitaire », en français et en anglais, avec un seul paramètre :
  - fr : `Bonjour, voici un message de Firmo : {{1}} Réponds ici pour continuer.`
  - en : `Hello, here is a message from Firmo: {{1}} Reply here to continue.`
  Il sert aux confirmations d'abonnement, rappels de fin et messages de l'équipe. Les réponses aux
  messages de l'artisan restent du texte libre.
- **Umami** : site « Firmo » dans l'Umami de Kete ; son identifiant va dans `UMAMI_WEBSITE_ID` et
  `VITE_UMAMI_WEBSITE_ID`, l'adresse dans `UMAMI_URL` et `VITE_UMAMI_SCRIPT_URL`
  (`<umami>/script.js`). Seules les pages publiques sont mesurées.

## Offre et conditions

- Prix, quota, recharge (taille et prix), grâce et produit Chariow : console → Offres. Publier crée
  une version ; les périodes déjà payées gardent la leur.
- Rappel avant la fin : réglage `subscription_warn_days` (3 par défaut), puis la veille. Il vaut
  pour les périodes créées après le changement.

## Équipe

Créer le compte dans Neon Auth (`npx neonctl neon-auth user create …` ou inscription), puis
`node db/scripts/firmo-db.mjs grant-staff <email> admin --url "$URL"`. Ensuite, les admins gèrent
l'équipe depuis la console.
