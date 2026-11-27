# Firmo Constitution

## Core Principles

### I. Périmètre de la vision et specs

- Tout travail DOIT correspondre à une spec listée dans `docs/product/ROADMAP.md` et citer ses
  identifiants de fonctionnalités (CH-\*, DOC-\*, ART-\*, ADM-\*, OFF-\*).
- Seules les fonctionnalités de `docs/product/VISION.md` sont construites. Firmo produit et suit des
  documents commerciaux ; il n'encaisse jamais l'argent des clients de l'artisan (décision 0003).
- Aucune limite à un pays, une ville, une langue ou un métier : ce sont des données.
- Pas de refactoring de code fonctionnel sans spec qui le justifie.

### II. Le calcul est à lui, la présentation est à nous (NON NÉGOCIABLE)

- Firmo ne suggère, ne corrige, n'arrondit et n'invente JAMAIS un prix, une quantité ou une remise.
- Une valeur lue par l'IA qui n'est pas présente dans le message source est refusée et demandée à
  l'artisan. Une ligne sans prix reste « à compléter » ; le document n'est pas émis.
- Firmo maîtrise la langue, la structure, l'alignement et la mise en page.

### III. Postgres est la source de vérité

- Montants, totaux, taxes, numérotation, transitions de statut, quotas et droits vivent en SQL :
  contraintes, fonctions transactionnelles, RLS. Tests pgTAP écrits avec la règle.
- L'API (Hono) porte les effets externes : canaux de messagerie, IA, rendu, stockage, paiement de
  l'abonnement, tâches planifiées. Elle NE DOIT PAS dupliquer une règle SQL.
- Le web ne calcule aucun montant et ne décide aucune transition.

### IV. Générique par configuration

- Pays, devises, taxes, mentions légales, métiers, types de documents, modèles de mise en page,
  offres, fournisseurs de paiement, canaux et modèles d'IA sont des données de référence.
- Tout montant est `amount_minor bigint` + `currency_code` (ISO 4217). Aucun flottant pour l'argent.
- Les fournisseurs externes (canaux, IA, paiement, stockage) sont derrière une interface ; un
  fournisseur indisponible est simulé derrière la même interface et signalé à l'écran.
- Aucun texte visible en dur : messages du chat dans `api/src/voix`, textes du web dans
  `web/src/l10n`.

### V. Sécurité par défaut (NON NÉGOCIABLE)

- Toute table de `public` active RLS ; aucune n'est accordée à `anonymous` ou `authenticated`
  (le web passe exclusivement par l'API). Garde : `db/tests/000_security_guard.sql`.
- Aucun secret dans le dépôt ni dans le web : Doppler, puis variables d'environnement Coolify.
- Tout webhook (WhatsApp, Telegram, paiement) est vérifié par signature ou secret, traité de façon
  idempotente et journalisé brut.
- Les liens envoyés dans le chat sont courts et stockés hachés : réutilisables pendant leur durée
  pour l'espace artisan, à usage unique pour l'administration (décision 0007).
- Toute action d'administration écrit dans `audit_log` (qui, quoi, quand, avant, après).
- Un document émis est immuable : toute correction produit une nouvelle version.

### VI. Architecture en couches

- API : `routes → services → ports (interfaces) → adapters (pg, OpenAI, canaux, S3)`.
  Dépendances injectées dans `createApp` ; tests avec des doubles, sans réseau.
- Web : routes TanStack Start sans logique métier ; un client API typé ; composants du design system.

### VII. Qualité vérifiable

- Une spec est terminée si : `npm run check` et `npm test` passent dans `api` et `web`,
  pgTAP passe en local et sur une branche Neon jetable, la CI est verte, et le parcours nominal est
  couvert par un test de bout en bout.
- Le rendu des documents est couvert par des cas difficiles comparés visuellement.
- Nouvelle tentative réseau seulement sur erreur réseau ou 5xx, jamais sur 4xx.

### VIII. Conçu pour le terrain

- Le chat est l'entrée principale : un artisan doit pouvoir tout faire sans ouvrir le web.
- Le web est mobile d'abord, utilisable de 360 px à grand écran, contraste AA, cibles ≥ 44 px,
  états vide, chargement, erreur et hors ligne sur chaque écran.
- Réseau lent : pages légères, aperçu image du document dans le chat.

### IX. Mesurer et tracer

- Les événements de `docs/product/METRICS.md` sont émis côté serveur, sans donnée personnelle.
- Coût IA mesuré par tâche et par document. Erreurs remontées au suivi d'erreurs.

## Stack et contraintes techniques

| Domaine | Choix |
|---|---|
| Base | Neon Postgres (projet `firmo`, Francfort), branches `main` (production) et `staging` |
| Identité admin | Neon Auth (Better Auth managé), session Firmo émise par l'API |
| API | Hono sur Node 24 (TypeScript), conteneur Docker sur Coolify ; worker de traitement dans le même processus, file en Postgres (`FOR UPDATE SKIP LOCKED`) |
| Stockage | Neon Object Storage (S3, clés `neon credentials` par branche) ; disque local en développement |
| Rendu | Typst (`@myriaddreamin/typst-ts-node-compiler`) → PDF, SVG, PNG (`@resvg/resvg-js`) |
| IA | AI SDK (`ai` + `@ai-sdk/openai`), modèles configurés en base par tâche |
| Canaux | WhatsApp Cloud API, Telegram Bot API, simulateur — interface `Channel` |
| Web | TanStack Start + Tailwind CSS, conteneur Docker sur Coolify |
| Hébergement | Coolify (serveur `kete-contabo`), une application API et une application web par environnement |
| Paiement de l'abonnement | interface `PaymentProvider` : simulateur (hors production), Moneroo, Chariow (décision 0006) |
| Secrets | Doppler (`firmo-api`, `firmo-web`, références `personal-keys`) |

Changer un élément de ce tableau exige une décision dans `docs/architecture/decisions/`.

## Flux de développement

- Spec Kit : spec → plan → tâches → implémentation, une branche `feat/NNN-<slug>` par spec, créée
  depuis `dev`.
- `main` : production, ne reçoit que `dev` (release) ou `hotfix/*`. `dev` : intégration.
- Aucun commit direct sur `main` ni `dev` : une pull request à chaque fois. L'agent relit le diff,
  fait passer analyse, tests, pgTAP (branche Neon jetable) et CI, puis fusionne dans `dev`.
- Une migration appliquée ne se modifie jamais. La branche Neon `main` n'est jamais touchée par un
  agent.
- Commits conventionnels.

## Governance

- Cette constitution prévaut sur toute autre pratique du dépôt. Guide opérationnel : `AGENTS.md`.
- Amendement : proposition écrite, décision dans `docs/architecture/decisions/` si elle touche
  l'architecture, version mise à jour (MAJEUR : principe retiré ou redéfini ; MINEUR : ajouté ;
  CORRECTIF : clarification).

**Version**: 1.1.0 | **Ratified**: 2026-11-14 | **Last Amended**: 2026-11-26
