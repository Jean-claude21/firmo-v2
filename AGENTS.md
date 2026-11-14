# AGENTS.md — Guide opérationnel

Les règles non négociables sont dans `.specify/memory/constitution.md` : elles priment.

## Avant de commencer une tâche

1. Lire la constitution, puis la ligne concernée de `docs/product/ROADMAP.md`.
2. Vérifier que la tâche appartient à une spec (`specs/NNN-*`). Sinon : `/speckit-specify`.
3. Pour une tâche d'interface : `docs/design/DESIGN.md`.

## Où trouver quoi

| Besoin | Fichier |
|---|---|
| Pourquoi Firmo, fonctionnalités | `docs/product/VISION.md` |
| Specs et état | `docs/product/ROADMAP.md` |
| Événements et KPIs | `docs/product/METRICS.md` |
| Architecture, sessions, conversation, rendu | `docs/architecture/ARCHITECTURE.md` |
| Décisions | `docs/architecture/decisions/` |
| Design system du web et des documents | `docs/design/DESIGN.md` |
| Exploitation (déployer, secrets, canaux) | `docs/OPERATIONS.md` |

## Commandes

Base de données (PostgreSQL 17 installé, jamais de conteneur) :

```bash
node db/scripts/firmo-db.mjs local start     # cluster .local/pgdata, port 54330, imitations Neon
node db/scripts/firmo-db.mjs migrate         # db/migrations (empreintes vérifiées)
node db/scripts/firmo-db.mjs test            # pgTAP, chaque fichier en transaction annulée
node db/scripts/firmo-db.mjs local reset
node db/scripts/firmo-db.mjs grant-staff <email> admin|support [--url <url>]
```

API (`api/`, Node ≥ 22) :

```bash
cd api && npm ci
npm run check      # types
npm test           # vitest (sans réseau)
npm run dev        # API + worker sur :8790 (base locale, canal simulateur)
```

Web (`web/`) :

```bash
cd web && npm ci
npm run check && npm test
npm run dev        # http://localhost:3000, API sur VITE_API_URL
```

Neon (projet `firmo`, id `quiet-shape-35108334`, Francfort) et Coolify : voir `docs/OPERATIONS.md`.

## Branches

| Branche | Rôle | Créée depuis | Fusionnée dans |
|---|---|---|---|
| `main` | Production | — | — |
| `dev` | Intégration | `main` | `main` (release) |
| `feat/NNN-<slug>` | Une spec | `dev` | `dev` |
| `feat/<slug>` | Hors spec (docs, design) | `dev` | `dev` |
| `hotfix/<slug>` | Correctif urgent | `main` | `main`, puis `dev` |

Pas de commit direct sur `main` ou `dev` : une pull request à chaque fois.

## Règles de code

- **Où mettre une règle :** montant, statut, numérotation, quota, permission → SQL (fonction + test
  pgTAP). Appel externe → API. Affichage → web ou `voix`.
- **Argent :** `amount_minor` (entier) + `currency_code`. Jamais de `number` flottant pour un montant
  stocké ; quantités en `numeric(14,3)`.
- **Jamais de prix inventé** : toute valeur lue est vérifiée par la garde anti-invention.
- **Générique :** aucune liste de pays, devise, taxe, métier ou modèle d'IA dans le code.
- **Texte :** messages du chat dans `api/src/voix`, textes du web dans `web/src/l10n`.
- **Ports et adapters :** chaque service externe a une interface et un double de test.
- **Réseau :** nouvelle tentative seulement sur erreur réseau ou 5xx ; idempotence sur toute création.

## Zones sensibles (relecture renforcée)

Migrations, RLS, sessions, webhooks, émission et numérotation des documents, quotas, paiement de
l'abonnement, secrets. L'agent relit le diff, fait passer analyse, tests, pgTAP sur une branche Neon
jetable et la CI, puis fusionne dans `dev`. La branche Neon `main` n'est jamais modifiée par un agent.

## Interdits

- Ajouter une fonctionnalité absente de la spec en cours.
- Utiliser des données fictives dans un flux de production.
- Committer un secret ou un `.env`.
- Désactiver une vérification pour faire passer un changement.

## Fin de tâche

Analyse et tests verts, pgTAP si le schéma change, événements de `METRICS.md` émis, `ROADMAP.md` à
jour, résumé de ce qui a été vérifié et de ce qui ne l'a pas été.
