# Spec 012 — Site et espace artisan au niveau de la v1

- Branche : `feat/012-web-v1` (empilée sur `feat/011-offre-v1`)
- Source : `docs/product/PARITE_V1.md` §5 (P-60 à P-69) ; v1 : `design.md` validé et
  `references/validated/` (landing, client/home, client/editor, client/identity).
- Fonctionnalités : ART-1 à ART-7, DOC-5, CH-4
- Statut : terminée (landing : voir la fin)

## Ce qui a été fait

| ID | Exigence | Vérifié par |
|---|---|---|
| P-60 | Système v1 : achromatique, Inter Tight et JetBrains Mono embarquées, rayon 5 px sur ce qui s'actionne, 0 sur le contenu, aucune ombre | captures `web/e2e/ui-*.mjs` |
| P-62 | Accueil « Vos documents » : créer dans la messagerie, bande du mois (x / quota), à continuer, récents avec téléchargement | `ui-artisan.mjs` |
| P-63 | Éditeur : groupes repliables, sous-totaux, lignes qté × prix / forfait / texte, onglets Détail · Conditions · Totaux, enregistrement automatique, aperçu PDF, émission avec numéro particulier et quota, dupliquer, en proforma, en facture, réviser, réponse du client, paiements, reçus | `ui-artisan.mjs`, `flow.mjs` |
| P-64 | Présentation : aperçu en direct (rendu réel dans une transaction annulée), logo, nom, métier, téléphone, couleur, modèle, format des numéros avec aperçu, informations professionnelles, valeurs par défaut, clauses | `flow.mjs` (logo vérifié dans le PDF), `ui-artisan.mjs` |
| P-65 | Abonnement : offre, quota, recharge, paiement, conditions | `ui-artisan.mjs`, `billing.db` |
| P-66 | Confidentialité, Conditions (conditions d'abonnement avec les valeurs réelles), Suppression des données, Contact | `ui-public.mjs` |
| P-67 | Formats : aperçus publics réels (4 formats, 14 options), rendus par le vrai gabarit | `ui-public.mjs` |
| P-68 | Liens réutilisables pendant leur durée (60 min, réglable), lien expiré / inconnu / compte suspendu expliqué (décision 0007) | pgTAP 005, `flow.mjs`, `ui-artisan.mjs` |
| P-69 | États vide, chargement, erreur, lien expiré, accès refusé | captures |

## Défauts trouvés et corrigés en testant

- L'ancien éditeur perdait chantier, acompte, garantie, délais, hypothèses, clauses, titres de
  groupes et lignes forfaitaires à l'enregistrement : remplacé.
- Quand l'IA tombait (quota épuisé), le chat renvoyait l'accueil trois fois puis abandonnait :
  bascule en lecture simplifiée, accueil dit une fois.
- La lecture simplifiée prenait « Devis pour X : 3 climatiseurs à 285000 » pour une seule ligne.
- Document avec acompte et paiements : deux « Solde restant » différents ; un seul désormais.
- La page `/confidentialite`, envoyée dès le premier message du chat, n'existait pas.

## Landing (P-61)

Faite après les specs 013 et 014, avec des captures réelles de l'application.

## Non vérifié

- Lecture par l'IA réelle : la clé OpenAI de développement n'a plus de crédit ; le parcours a été
  testé en lecture simplifiée et le passage en mode dégradé vérifié.
- Éditeur et coordonnées publiques (`VITE_PUBLISHER_*`, `VITE_SUPPORT_*`) : à fournir.
