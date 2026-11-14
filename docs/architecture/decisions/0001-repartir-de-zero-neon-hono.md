# 0001 — Repartir de zéro sur Neon et Hono

- Date : 2026-11-14
- Statut : acceptée

## Contexte

La première version (dépôt `firmo`, Supabase + FastAPI + TanStack) a atteint un staging mais n'a
jamais été utilisée. Le porteur travaille désormais avec Neon et Hono sur ses autres projets (DYM).

## Décision

Nouveau dépôt `firmo-v2`, nouveau projet Neon `firmo` (Francfort). API en Hono (hébergement : décision 0005),
règles en SQL, rendu Typst conservé. L'ancien dépôt reste une archive en lecture seule.

## Conséquences

- Un seul langage (TypeScript) pour l'API et le web, mêmes patrons que DYM.
- Rien n'est repris de l'ancien code ; seules les leçons produit le sont.
