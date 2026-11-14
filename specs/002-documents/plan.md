# Plan — 002 Documents

## Constitution Check

| Principe | Respect |
|---|---|
| II Le calcul est à lui | valeurs nulles = à demander ; aucun prix proposé ; mémoire sans prix |
| III SQL | totaux, numéros, transitions, quota en fonctions `app.*` |
| IV Générique | types, taxes, préfixes, validité, offres en données |
| V Sécurité | garde d'immuabilité, jeton de partage haché, accès vérifié par organisation |

## Structure

- `db/migrations/0006_offers.sql`, `0007_documents.sql`
- `api/src/documents/{money,words,store}.ts`
- Tests : `db/tests/010–013`, `api/test/money.test.ts`, `api/test/documents.db.test.ts`
