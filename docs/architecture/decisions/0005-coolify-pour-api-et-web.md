# 0005 — API et web sur Coolify, données sur Neon

- Date : 2026-11-14
- Statut : acceptée (remplace l'hypothèse initiale des Neon Functions)

## Contexte

Chaque message déclenche un traitement long : média, transcription, lecture IA, rendu Typst, envoi.
Le porteur dispose d'un serveur Coolify (Contabo, `*.kete.digital`) qui héberge déjà Pono et Jarvis
en Docker.

## Comparaison

| Point | Neon Functions | Coolify |
|---|---|---|
| Traitements longs | `waitUntil`, 15 min max | sans limite, worker permanent |
| Paquets natifs (Typst, resvg) | à empaqueter pour linux-arm64 | image Docker classique |
| File et reprises | aucune | file Postgres, reprises |
| Démarrage à froid | oui | non |
| Coût | à l'usage | serveur déjà payé |
| Maintenance | aucune | serveur à tenir |

## Décision

API Hono (Node 24) et web TanStack Start en conteneurs Docker sur Coolify, un couple par
environnement. Neon garde Postgres (branches), Neon Auth (admins) et Object Storage (clés S3 par
branche). Le code Hono reste portable.
