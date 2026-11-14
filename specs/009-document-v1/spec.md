# Spec 009 — Document et PDF au niveau de la v1

- Branche : `feat/009-document-v1`
- Source : `docs/product/PARITE_V1.md` §1 et §2 (P-01 à P-27, P-43), dépôt v1 `firmo` (`model.md`,
  `design.md`, `references/validated/documents`, `document/fixtures/cases`).
- Statut : terminée

## Pourquoi

La v2 ne savait produire qu'une liste de lignes avec une remise. La v1 produisait le devis d'un
artisan tel qu'il le pense : des ouvrages groupés en sections, la main-d'œuvre en pourcentage ou
en montant, un acompte, un objet, un chantier, des conditions écrites une fois. Et son PDF suivait
une direction validée sur maquettes. Cette spec ramène les deux, sans régression.

## Exigences

| ID | Exigence | Vérifié par |
|---|---|---|
| P-01 | Sections : titre et sous-total facultatifs ; sans titre = liste plate | `019_document_v1.sql`, cas 03/04 |
| P-02 | Ligne quantité × prix, forfaitaire ou descriptive ; description ; unité libre | `019`, cas 04/10 |
| P-03 | Ajustements ordonnés : pourcentage OU montant, signe, base (total des postes, section, base taxable), > 100 % admis | `010`, `019`, cas 03/05/10 |
| P-04 | Ordre de calcul déterministe ; base négative = blocage, jamais une erreur en pleine correction | `010`, `019` |
| P-05 | Champs latents : objet, résumé, chantier, délai, garantie, hypothèses, validité, acompte | `019`, rendu |
| P-06 | Valeurs par défaut de l'organisation reposées sur chaque devis / proforma | `019`, `portal.db` |
| P-07 | Clauses écrites une fois, par défaut ou non, copiées puis figées à l'émission | `019`, `portal.db` |
| P-08 | Numérotation par organisation et par type (préfixe, séparateur, année, largeur, continue ou annuelle), compteur jamais remis à zéro, changement audité | `019`, `portal.db` |
| P-09 | Numéro manuel : format contrôlé, unique, audité | `019`, `portal.db` |
| P-10 | Révision `/R2`, `/R3` sans consommer la série ni le quota | `019` |
| P-11 | Conversion devis → proforma / facture, proforma → facture, origine imprimée | `019`, cas 08 |
| P-12 | Duplication en brouillon indépendant | `019`, `portal.db` |
| P-13 | Émis = immuable (sections, lignes, ajustements, clauses), entête et version du gabarit figées | `019` |
| P-14 | Consultations du lien : première, dernière, compteur, sans IP | `019` |
| P-15 | État « sans réponse » ; expiré calculé | `019`, `portal.db` |
| P-16, P-17 | Paiements, solde ; émission bloquée tant qu'une valeur manque | `011`, `012`, `019` |
| P-18 | Les dix cas v1 donnent leurs totaux exacts | `v1-cases.db.test.ts` |
| P-20 à P-27 | Gabarit validé v1 : entête, filet, destinataire / cadre, objet, sections, totaux, bloc total, acompte, conditions, bon pour accord ; achromatique ; Inter Tight + JetBrains Mono ; multipage ; filigrane du brouillon ; mentions légales seulement si remplies | dix rendus relus (`api/test/__output__/cases`), niveaux de gris |
| P-43 | Mémoire : libellé, unité, dernier prix constaté (jamais proposé) | `019` |

## Choix d'implémentation

- Base : migration `0013_document_v1.sql`. Tables `document_sections`, `document_adjustments`,
  `clauses`, `document_clauses`, `numbering_settings`, `document_views` (RLS, aucun droit
  exposé). Reprise des documents existants : une section sans titre, remise → ajustement négatif,
  montants émis inchangés.
- Le recalcul ne lève jamais d'erreur : une valeur manquante ou une base négative devient un
  blocage d'émission (`issue_blockers`), affiché ou demandé.
- `set_content` remplace le contenu d'un brouillon en un appel et recalcule une seule fois.
- PDF : `api/templates/document.typ` reprend le gabarit v1 (version 4) ; libellés génériques par
  langue (`voix/document.ts`), montants et devise formatés par l'API, couleur assombrie en silence
  jusqu'au contraste AA. Un seul gabarit actif (les trois modèles v2 sont retirés).
- Ajouts v2 conservés : QR code vers la page publique, montant en lettres, reçus, bon de livraison.

## Défauts trouvés et corrigés en route

- Montant en lettres : « cent troi mille » (le s de « trois » tombait devant « mille »).
- SVG multipage : le fond de la page 2 recouvrait la page 1 (aperçu PNG blanc).
- Reconnaissance des numéros dans le chat limitée au format `XXX-AAAA-0000`.

## Hors de cette spec

Conversation complète (spec 010), offre (011), site et espace artisan aux maquettes v1 (012),
administration (013). L'éditeur web actuel est seulement adapté pour ne rien casser.
