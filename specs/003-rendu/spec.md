# Spec 003 — Rendu des documents

- Branche : `feat/003-rendu`
- Fonctionnalités : DOC-5, DOC-8
- Statut : terminée

## Objectif

Un gabarit Typst, trois modèles (Classique, Moderne, Épuré), trois sorties : PDF (envoi),
SVG (aperçu web) et PNG de la première page (aperçu dans le chat). Le rendu est déclenché par
l'émission (tâche `render_document`), stocké de façon immuable et enregistré en base.

## Règles

1. Le gabarit ne calcule rien : montants, dates et libellés arrivent formatés (`render/model.ts`).
2. Couleur de marque : fond tel quel, texte posé dessus noir ou blanc (meilleur contraste), textes
   colorés sur blanc assombris jusqu'au contraste AA.
3. Montant en lettres (fr, en), mentions légales du pays, moyens de paiement de l'artisan.
4. QR code vers la page publique du document ; le jeton est dérivé (HMAC) de l'identifiant, seule
   son empreinte est en base.
5. Tampon de statut (accepté, payé, acompte, refusé, annulé) ; filigrane « BROUILLON » en aperçu.
6. Tableau sur plusieurs pages : en-tête répété ; pied de page légal et pagination.

## Vérification

- Cas difficiles rendus et relus : sans client, nom très long, 60 lignes, remise + taxe + acompte,
  reçu, anglais en dollars, couleur claire (`api/test/render.test.ts`).
- Émission → tâche → rendu stocké → écouteur prévenu → lien du QR valide (`render.db.test.ts`).
- pgTAP 014 : enregistrement idempotent des rendus.
