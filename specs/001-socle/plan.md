# Plan — 001 Socle

## Constitution Check

| Principe | Respect |
|---|---|
| III Postgres source de vérité | identités, liens, file, équipe : fonctions `app.*` testées pgTAP |
| IV Générique | pays, devises, taxes, métiers, unités, types, modèles, canaux, IA : tables de référence |
| V Sécurité | RLS partout, aucun droit Data API (garde), liens hachés, audit des rôles |
| VI Couches | `routes → services → ports → adapters`, dépendances injectées |
| VII Qualité | pgTAP + vitest + CI |

## Choix

- `firmo-db.mjs` repris de DYM (port 54330, schéma `firmo_meta`), commande `grant-staff`.
- Tables en `public` avec RLS et aucun droit ; fonctions dans `app` (schéma fermé).
- File `jobs` : `claim_jobs` (`FOR UPDATE SKIP LOCKED`, reprise après 15 min), `fail_job`
  (délai 10·n² s), `NOTIFY firmo_jobs` pour réveiller le worker.
- Liens : jeton aléatoire 32 octets (base64url) généré par l'API, empreinte SHA-256 en base.
- Sessions : JWT HS256 (`jose`), `scope` = `org` ou `staff`, durée lue dans `settings`.
- API : Hono + `@hono/node-server`, worker dans le même processus (`WORKER_ENABLED`).

## Structure

```text
db/{migrations,tests,local,scripts}
api/src/{index.ts,app.ts,config.ts,lib/,worker/,routes/}
api/test/
.github/workflows/ci.yml
```
