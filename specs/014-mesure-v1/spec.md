# Spec 014 — Mesure et données au niveau de la v1

- Branche : `feat/012-web-v1` (même pile)
- Source : `docs/product/PARITE_V1.md` §7 (P-80 à P-83).
- Statut : terminée

| ID | Exigence | Vérifié par |
|---|---|---|
| P-80 | Événements relayés à l'outil de mesure (Umami depuis la spec 015) sans nom, téléphone, prix ni contenu (liste blanche de propriétés en SQL) ; sans clé, rien n'est envoyé ; relayé une seule fois | pgTAP 023, `data.db` |
| P-81 | Vocaux et photos sources supprimés du stockage après `media_retention_days` (30) ; le texte lu reste | pgTAP 023, `data.db` |
| P-82 | Export depuis l'espace : archive ZIP (données JSON, liste CSV, PDF émis) | `data.db`, `ui-data.mjs` |
| P-83 | Suppression sur demande (chat, espace) exécutée par l'équipe avec motif : conversations, identités, médias, brouillons, clients sans document, présentation et logo effacés ; documents émis et paiements conservés | pgTAP 023, `data.db`, `ui-data.mjs` |

## Non vérifié

- Outil de mesure : PostHog remplacé par l'Umami de Kete dans la spec 015 (`UMAMI_URL`, `UMAMI_WEBSITE_ID`).
