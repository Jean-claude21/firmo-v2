# Parité avec la v1 — Firmo

> Exigence du porteur (2026-11-14) : la v2 offre **au minimum** toutes les fonctionnalités de la v1,
> au même niveau de qualité. L'implémentation peut évoluer, le résultat ne peut pas régresser.
>
> Source : dépôt `Jean-claude21/firmo`, branche `dev` (commit `ea13635`), lue en entier :
> `model.md`, `decisions.md`, `voix.md`, `design.md`, `referentiels.md`, `exploitation.md`,
> `contenus.md`, `roadmap.md`, le code `backend/app` et `web/src`, les maquettes
> `references/validated/` et les dix cas `document/fixtures/cases/`.
>
> Chaque ligne est cochée seulement quand sa vérification passe. Une ligne ne se coche pas « à peu près ».

Légende : ✅ fait et vérifié · ⬜ à faire · ➕ la v2 fait plus que la v1 (conservé).

## 1. Document (spec 009 ✅)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-01 | Un document est une suite de **sections** (titre optionnel, ordre, sous-total affiché au choix) ; une section sans titre rend une liste plate | pgTAP + cas 03, 04 | ✅ |
| P-02 | Ligne : libellé libre jamais normalisé, **description** (sous-titre gris), unité optionnelle, quantité décimale, prix unitaire, **montant forfaitaire**, **ligne descriptive non calculée** | pgTAP + cas 04 | ✅ |
| P-03 | **Ajustements ordonnés** : libellé, mode `pourcentage` \| `montant` (jamais converti l'un en l'autre), signe, base explicite (section, total des postes, base taxable), pourcentage > 100 admis | pgTAP + cas 03, 05 | ✅ |
| P-04 | Ordre de calcul déterministe : lignes → sous-totaux → total des postes → ajustements → base taxable → taxe → total → acompte → solde indicatif ; une remise ne rend jamais une base négative | pgTAP | ✅ |
| P-05 | **Champs latents** rendus seulement s'ils sont remplis : objet, résumé, chantier, délai, garantie, hypothèses, acompte (%) | pgTAP + rendu | ✅ |
| P-06 | **Valeurs par défaut de l'organisation** reposées sur chaque nouveau document : validité, délai, garantie, acompte | pgTAP | ✅ |
| P-07 | **Clauses** écrites une fois (titre, corps, par défaut), activées par document, **figées à l'émission** | pgTAP | ✅ |
| P-08 | **Numérotation configurable** par organisation et par type : préfixe, séparateur, année, largeur, séquence continue ou annuelle ; changer le format ne remet jamais un compteur à zéro | pgTAP | ✅ |
| P-09 | **Numéro manuel** choisi avant émission : unique, valide, audité | pgTAP | ✅ |
| P-10 | **Révision** = nouveau document lié, numéro `/R2`, `/R3` sans consommer la série | pgTAP | ✅ |
| P-11 | **Conversion** devis/proforma → facture sans ressaisie, lien vers l'original affiché sur le PDF | pgTAP + rendu | ✅ |
| P-12 | **Duplication** d'un document en nouveau brouillon | pgTAP | ✅ |
| P-13 | Instantané complet à l'émission (entête, lignes, clauses, totaux, version du gabarit) ; aucune dérive après émission | pgTAP | ✅ |
| P-14 | **Consultations du lien direct** : première, dernière ouverture, compteur ; aucune IP ni empreinte | pgTAP | ✅ |
| P-15 | États : brouillon, émis, accepté, refusé, **sans réponse**, annulé ; **expiré calculé**, jamais stocké | pgTAP | ✅ |
| P-16 | Paiements simples d'une facture (montant, date, moyen, référence), solde ; jamais au-delà du total | pgTAP | ✅ |
| P-17 | Aucun document émis tant qu'une quantité ou un prix reste nul ou à confirmer | pgTAP | ✅ |
| P-18 | Les **dix cas de référence** v1 donnent exactement leurs totaux attendus | test API | ✅ |
| ➕ | Reçu de paiement, bon de livraison, décision du client en ligne, montant en lettres, QR | conservé | ✅ |

## 2. PDF (spec 009 ✅)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-20 | Gabarit validé : entête monogramme ou logo, filet couleur court, bloc destinataire / cadre, bandeau **objet** avec résumé, table à filets horizontaux, chiffres en chasse fixe alignés à droite, conditions en colonne, **total général dans le bloc couleur** et le plus gros de la page, acompte et solde, « Bon pour accord » / émetteur | comparaison aux 3 PNG validés | ✅ |
| P-21 | Achromatique ; la couleur de l'artisan n'occupe que ses emplacements ; couleur claire assombrie en silence ; lisible en noir et blanc | rendu de 3 couleurs + niveaux de gris | ✅ |
| P-22 | Polices Inter Tight + JetBrains Mono embarquées | rendu | ✅ |
| P-23 | Composition qui se referme : blocs absents sans trou (cas 01 minimal) | cas 01 | ✅ |
| P-24 | **Multipage** : entête de colonnes répété, pagination « n / N » | cas 06 | ✅ |
| P-25 | **Aperçu brouillon filigrané** « APERÇU · BROUILLON », gratuit, sans numéro | test | ✅ |
| P-26 | Mentions RCCM / NIF / mentions libres de l'émetteur et NIF du client, seulement si remplis | rendu | ✅ |
| P-27 | Les dix cas rendus en PDF + PNG, relus | `test/__output__/cases` | ✅ |

## 3. Conversation (spec 010 ✅)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-30 | Vocal principal, photo, texte ; la liste lue est **toujours montrée avant composition** (sections, ajustements, total provisoire, détails) | test conversation | ✅ |
| P-31 | **Corrections en langage naturel** sur tout le document : lignes, sections, ajustements, champs (objet, client, chantier, délai, validité, garantie, TVA, acompte, conditions), paiements ; tout nombre corrigé exige sa **preuve textuelle** | tests + garde | ✅ |
| P-32 | Une question à la fois, sur le premier champ manquant | test | ✅ |
| P-33 | Seule question au premier document : « Sous quel nom doit partir ce devis ? » | test | ✅ |
| P-34 | Intentions : salutation, admin, confirmer, finaliser, aperçu, réglages, dernier document, télécharger le dernier, liste, quota, abonnement, statistiques, recherche, conversion, duplication, partage, nouveau document, aide, nouvelle source, autre | test par intention | ✅ |
| P-35 | **Contexte de 12 échanges** + brouillon structuré durable | test | ✅ |
| P-36 | Un brouillon actif par conversation ; « nouveau » l'abandonne et en ouvre un autre | test | ✅ |
| P-37 | Aperçu PDF filigrané gratuit dans le chat, puis émission confirmée (consomme 1 document) | test | ✅ |
| P-38 | Messages de `voix.md` (tutoiement, sans point d'exclamation, mots bannis) : accusé de réception, panne, limite, rien à montrer | test des mots bannis | ✅ |
| P-39 | Mode dégradé réel : IA indisponible → brouillon conservé, saisie `quantité \| libellé \| prix` | test | ✅ |
| P-40 | Webhooks idempotents, reprise, réponse livrée conservée | test | ✅ |
| P-41 | **Évaluation de dialogues** : artisan, BTP complexe, facture informelle + « télécharge le dernier », plus de 12 échanges | script + rapport | ✅ |
| P-42 | Demande de suppression des données depuis le chat (« Je demande la suppression de mes données ») | test | ✅ |
| P-43 | Mémoire des postes habituels : libellé + dernier prix **constaté**, jamais suggéré | pgTAP | ✅ |

## 4. Offre et paiement (spec 011)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-50 | Essai : 3 documents finaux sans carte | pgTAP | ✅ |
| P-51 | Forfait 2 000 F CFA / mois pour **15 documents finaux** (dernière décision de la v1, migration `20260817001000` ; ses documents disaient encore 30) | pgTAP | ✅ |
| P-52 | **Recharges** (taille et prix configurables) | pgTAP | ✅ |
| P-53 | **Avertissement à 80 %** du quota ; au plafond, brouillon conservé, proposition ABONNEMENT ou RECHARGE | test | ✅ |
| P-54 | **Versions d'offre** ; un abonnement garde sa version ; **périodes successives** sans réécrire l'historique ; période de grâce | pgTAP | ✅ |
| P-55 | Une correction ne consomme rien ; une conversion émise consomme 1 document | pgTAP | ✅ |
| P-56 | **Chariow** : checkout serveur, téléphone et pays pré-remplis, webhook signé, vente accordée une seule fois, rapprochement admin | test + doc | ✅ (Chariow factice ; réel à brancher) |
| P-57 | **File de confirmation** après paiement (tentatives, reprise) ; le paiement reste acquis si le message échoue | test | ✅ |
| ➕ | Moneroo et simulateur derrière la même interface | conservé | ✅ |
| ➕ | Conditions de fin reprises de Struo : rappels avant la fin, à la fin et à la fin de la grâce, une fois chacun, coupés par un renouvellement ; conditions affichées sur la page Abonnement | pgTAP + test | ✅ |

## 5. Espace artisan et site (spec 012)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-60 | Système de design validé : achromatique, Inter Tight, JetBrains Mono, rayons 0/5 px, aucune ombre | captures | ✅ |
| P-61 | **Landing** de la référence : « Tu parles. Firmo rédige. », feuille qui se retourne en document, messagerie, ce qui se passe vraiment, couleurs, « Ce qu'on ne fera jamais », prix, appel final | capture vs référence | ⬜ |
| P-62 | **Accueil** : documents disponibles ce mois (x / 30), à continuer, récents, téléchargement | capture vs référence | ✅ |
| P-63 | **Document** : objet, sections repliables, sous-totaux, onglets détail / conditions / totaux, aperçu PDF, émission avec numéro particulier et quota, dupliquer, en proforma, en facture, partager, télécharger | capture vs référence | ✅ |
| P-64 | **Présentation** : aperçu PDF en direct, logo, nom, métier, téléphone, couleur, format des numéros avec aperçu, informations professionnelles (RCCM, NIF, adresse, e-mail), clauses, valeurs par défaut | capture vs référence | ✅ |
| P-65 | **Abonnement** : offre, quota, recharge, paiement | capture | ✅ |
| P-66 | Pages **Confidentialité**, **Conditions**, **Suppression des données**, **Contact** | captures | ✅ |
| P-67 | Page **Formats** : aperçus publics réels du PDF selon les options | capture | ✅ |
| P-68 | Liens réutilisables pendant leur durée (configurable dans l'admin), lien expiré expliqué | test | ✅ |
| P-69 | États vide, chargement, erreur, lien expiré, accès refusé sur chaque écran | captures | ✅ |

## 6. Administration (spec 013)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-70 | **Centre de commande** : traitements en cours, incidents ouverts, santé des canaux, temps de génération, file de traitement filtrable, services essentiels, événements récents | capture vs référence | ✅ |
| P-71 | **Incidents** : liste, détail avec chronologie du traitement, entrée reçue, relance | capture vs référence | ✅ |
| P-72 | **Organisation** : entête, offre, utilisation, canal, activité ; onglets vue générale, documents, paiements, journal ; support : lien d'accès, réinitialiser le quota, message, suspendre | capture vs référence | ✅ |
| P-73 | Listes **Documents**, **Conversations** (+ détail), **Paiements**, **Abonnements**, **Offres** (versions), **Clients**, **Identités** | captures | ✅ |
| P-74 | **Actions sensibles** : motif obligatoire, reconfirmation, journal append-only ; **affichage des prix** sur motif | pgTAP | ✅ |
| P-75 | Configuration des durées d'accès (liens client, admin) | pgTAP | ✅ |
| P-76 | **Accès admin depuis le chat** : « ADMIN » depuis une identité autorisée → lien à usage unique de 10 minutes | test | ✅ |
| P-77 | Recherche globale (organisation, téléphone, document) | test | ✅ |
| P-78 | Pilotage : vues alimentées par des agrégats réels (activation, conversion, coûts, échecs par étape) | capture | ✅ |

## 7. Mesure et exploitation (spec 014)

| ID | Fonctionnalité v1 | Vérification | État |
|---|---|---|---|
| P-80 | Événements envoyés à **PostHog** (sans nom, téléphone, prix, contenu) ; sans clé : rien n'est envoyé | test | ✅ (PostHog réel à brancher) |
| P-81 | Audios et photos sources supprimés après une durée configurable | pgTAP + worker | ✅ |
| P-82 | Export des données depuis l'espace artisan | test | ✅ |
| P-83 | Suppression des données sur demande (chat, espace) avec conservation légale limitée | pgTAP | ✅ |

## Ce qui n'est pas repris, et pourquoi

| Élément v1 | Raison |
|---|---|
| Page `/avancement`, gates PowerShell, dossiers `preuves/` | Outillage du processus de fabrication v1, pas une fonctionnalité produit. La v2 trace l'avancement dans `ROADMAP.md`, ce fichier et la CI. |
| Projection Kairos (`contenus.md`) | Système de contenus marketing externe, hors du produit. |
