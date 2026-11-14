# Exploitation — Firmo

## Neon

- Projet `firmo`, id `quiet-shape-35108334`, région `aws-eu-central-1`, Postgres 18.
- Branches : `main` (production, protégée, jamais touchée par un agent), `staging`
  (`br-blue-union-b9zi60ox`), branches de test jetables (expirent après 2 jours).
- Politique : `neon.ts` (Neon Auth, bucket privé `firmo-files`, durée des branches).

```bash
export NEON_API_KEY=…   # Doppler personal-keys / NEON_API_TOKEN, jamais affiché
P=quiet-shape-35108334
npx neonctl deploy --project-id $P --branch staging --no-env-pull          # applique neon.ts
URL="$(npx neonctl connection-string staging --project-id $P)"
node db/scripts/firmo-db.mjs migrate --url "$URL"

# pgTAP sur une branche jetable (Neon Auth hérité de staging), puis suppression
npx neonctl branches create --project-id $P --name test-spec-NNN --parent staging
node db/scripts/firmo-db.mjs test --url "$(npx neonctl connection-string test-spec-NNN --project-id $P)"
npx neonctl branches delete test-spec-NNN --project-id $P

# Clés S3 du stockage objet d'une branche (pour l'API sur Coolify)
npx neonctl credentials create --project-id $P --branch staging --name firmo-api --scope storage:read --scope storage:write

# Premier admin : créer le compte dans Neon Auth (console ou /admin/inscription), puis
node db/scripts/firmo-db.mjs grant-staff <email> admin --url "$URL"
```

## Coolify

Serveur `kete-contabo` (Coolify Cloud). Une application API et une application web par
environnement, construites depuis les Dockerfile de `api/` et `web/`. Domaines provisoires sous
`*.kete.digital`. Détails de déploiement : spec 008.

## Secrets

Doppler est la référence ; les clés personnelles (OpenAI, Neon…) restent dans `personal-keys` et
sont référencées. Aucune valeur dans le dépôt.
