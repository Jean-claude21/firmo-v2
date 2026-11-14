# 0004 — Rendu des documents avec Typst

- Date : 2026-11-14
- Statut : acceptée

## Décision

Typst via `@myriaddreamin/typst-ts-node-compiler` (paquet natif, installé dans l'image Docker de
l'API). Un gabarit, trois sorties : PDF, SVG, PNG (`@resvg/resvg-js`).
Trois modèles paramétrés plutôt que des réglages libres. Cas difficiles rendus et comparés en test.

## Alternatives écartées

Chromium (Gotenberg) : lourd, service supplémentaire. react-pdf : typographie inférieure.
Prince/DocRaptor : payant.
