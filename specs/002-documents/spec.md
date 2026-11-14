# Spec 002 — Documents

- Branche : `feat/002-documents`
- Fonctionnalités : DOC-3, DOC-4, DOC-6, DOC-7, OFF-1 (essai), OFF-2
- Statut : terminée

## Objectif

Le modèle documentaire entièrement en SQL : brouillons, lignes (valeurs lues ou à confirmer),
totaux, remise, taxe, numérotation sans trou par type et par année, émission immuable avec en-tête
et client figés, révisions, conversion devis → facture, partage par jeton, décision du client,
paiements notés, reçus, mémoire des désignations, essai et quota.

## Règles

1. Une ligne sans quantité ou sans prix bloque l'émission ; le nom de l'entreprise aussi.
2. Totaux : Σ round(quantité × prix) ; remise en %% ou en montant (plafonnée) ; taxe sur le net.
3. Numéro `PRÉFIXE-AAAA-NNNN` attribué à l'émission seulement (un refus ne consomme rien).
4. Seule l'émission d'un type `counts_quota` consomme une unité ; révision et reçu non.
5. Un document émis ne change plus (garde SQL) : seuls statut, suivi et version de rendu évoluent.
6. Paiement noté ≤ reste à payer ; statut partiellement payé puis payé ; un reçu par paiement.
7. Mémoire : désignations et unités, jamais les prix.

## Vérification

- pgTAP : 010 totaux, 011 émission, 012 cycle, 013 offres.
- vitest : argent (formatage, lecture, lettres), parcours complet sur Postgres.
