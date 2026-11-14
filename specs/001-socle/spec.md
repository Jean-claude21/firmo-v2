# Spec 001 — Socle

- Branche : `feat/001-socle`
- Fonctionnalités : CH-2, CH-5 (base), ADM-1 (base), ADM-5 (données)
- Statut : en cours

## Objectif

Poser ce dont toutes les specs suivantes dépendent : base et outillage, référentiels génériques,
organisations créées en silence, équipe et audit, événements, file de traitement, liens à usage
unique, API Hono avec sessions, worker, CI.

## Récits

1. **Premier message** — Une identité de messagerie inconnue écrit : une organisation est créée
   sans question, avec le pays et la devise déduits du numéro (sinon le pays par défaut). Un second
   message retrouve la même organisation. `org_created` est émis.
2. **Lien d'accès** — L'API crée un lien à usage unique (15 min) pour une organisation ; il s'échange
   une seule fois contre une session web, jamais pour une organisation suspendue.
3. **Équipe** — Le premier admin est nommé en ligne de commande ; ensuite seul un admin nomme ou
   retire un membre ; tout est audité.
4. **Traitement fiable** — Une tâche est réclamée par un seul worker, retentée avec délai croissant,
   reprise si le processus meurt, marquée échouée après le nombre maximal d'essais.
5. **Santé** — `GET /health` indique l'état de l'API, de la base et du worker.

## Critères d'acceptation

- pgTAP : garde de sécurité, référentiels, identités, équipe, file, liens — verts en local et sur
  une branche Neon jetable.
- vitest : sessions (signature, expiration, portée), routes de santé et d'échange de lien, worker.
- CI GitHub verte (Postgres 17, migrations, pgTAP, `npm run check`, `npm test`).

## Hors périmètre

Documents (002), rendu (003), canaux et IA (004), web (005).
