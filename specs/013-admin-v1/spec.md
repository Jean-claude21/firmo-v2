# Spec 013 — Console au niveau de la v1

- Branche : `feat/012-web-v1` (même pile)
- Source : `docs/product/PARITE_V1.md` §6 (P-70 à P-78) ; v1 : `references/validated/admin/`.
- Fonctionnalités : ADM-1 à ADM-7
- Statut : terminée

| ID | Exigence | Vérifié par |
|---|---|---|
| P-70 | Centre de commande : traitements en cours, incidents, webhooks valides, PDF p95, file filtrable, services, événements | `ui-admin.mjs` |
| P-71 | Incidents : liste, chronologie, entrée reçue, relance, demande d'un nouveau vocal ou d'une nouvelle photo, clôture avec note | `ui-admin.mjs`, pgTAP 022 |
| P-72 | Organisation : en-tête, onglets, support (lien d'accès, quota, message, période offerte, suspension) | `ui-admin.mjs`, pgTAP 022 |
| P-73 | Listes : documents, conversations, paiements, abonnements, offres, clients, identités | `ui-admin.mjs` |
| P-74 | Motif obligatoire puis reconfirmation ; journal en ajout seul (déclencheur) ; montants des artisans masqués, affichés sur motif quelques minutes | pgTAP 022, `ui-admin.mjs` |
| P-75 | Durées réglables et bornées | pgTAP 022 |
| P-76 | « ADMIN » depuis une identité autorisée → lien d'administration à usage unique (10 min) | pgTAP 022, `ui-admin.mjs` |
| P-77 | Recherche globale | pgTAP 022, `ui-admin.mjs` |
| P-78 | Pilotage sur agrégats réels | `ui-admin.mjs` |

## Défauts trouvés et corrigés

- Le rôle de l'équipe paraissait vide dans les pages découpées par le build : la console se
  croyait en lecture seule. Contexte déplacé dans `web/src/lib/staff.tsx`.
- « ADMIN » dans le chat répondait toujours « Cette identité n'ouvre pas l'administration » : le
  lien n'était pas branché.
- Les routes `file.:kind` cessaient de répondre selon l'ordre des routes : paramètre explicite.
