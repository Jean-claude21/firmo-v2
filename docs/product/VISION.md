# Vision — Firmo

## 1. Pourquoi

Un artisan, un prestataire ou un commerçant est comparé à des concurrents qu'il ne voit pas, sur un
document qu'il n'a pas les moyens de produire seul. Il perd des marchés sans savoir pourquoi.

**Firmo est le bureau administratif du petit professionnel, dans sa messagerie.** Il dicte sa vente,
envoie la photo de son devis papier ou l'écrit ; Firmo lui renvoie un document professionnel, le
suit jusqu'à l'acceptation et la facture. Le client paie l'artisan directement.

## 2. La règle qui gouverne tout

> **Le calcul est à lui. La présentation est à nous.**

Firmo ne propose jamais un prix. Il lit, structure, met en page et demande ce qui manque.

## 3. Pour qui

- Celui qui vend à des **clients formels** (entreprises, ONG, administrations, hôtels, écoles,
  maîtres d'ouvrage) et doit fournir devis et factures : artisans du bâtiment, menuisiers,
  chaudronniers, couturiers, mécaniciens, traiteurs, réparateurs, consultants.
- Partout en Afrique d'abord ; aucun pays, langue ou métier n'est codé.

## 4. Fonctionnalités validées

### Canaux (CH)
- **CH-1** Recevoir texte, note vocale et photo sur WhatsApp, Telegram et le simulateur.
- **CH-2** Compte créé en silence au premier message ; l'identité est l'identifiant de messagerie.
- **CH-3** Réponses courtes, numérotées, avec l'aperçu image du document et le PDF.
- **CH-4** Formulaires depuis le chat : lien signé vers un formulaire web ; WhatsApp Flows quand le
  compte Meta est vérifié (même définition de formulaire).
- **CH-5** Webhooks vérifiés, idempotents, journalisés.

### Documents (DOC)
- **DOC-1** Lecture d'une dictée, d'un texte ou d'une photo en lignes (désignation, quantité, unité,
  prix unitaire), chaque valeur marquée « lue » ou « à confirmer ».
- **DOC-2** Corrections en un mot (« ligne 2 prix 15000 », « enlève la 3 », « client Hôtel du Lac »).
- **DOC-3** Types configurables : devis, facture proforma, facture, bon de livraison.
- **DOC-4** Totaux, remise, taxes et numérotation sans trou calculés en SQL.
- **DOC-5** Émission : version immuable, PDF + aperçu PNG, lien de partage et QR code.
- **DOC-6** Cycle : devis envoyé → accepté ou refusé par le client (lien) → proforma au besoin →
  facture. L'encaissement reste à l'artisan : Firmo ne note aucun paiement (décision 0008).
- **DOC-7** Mémoire : clients et lignes habituelles (désignation, unité), jamais de prix proposé.
- **DOC-8** Trois modèles de mise en page (Classique, Moderne, Épuré), couleur tirée du logo,
  montant en lettres, mentions légales du pays, moyens de paiement de l'artisan.

### Espace artisan (ART)
- **ART-1** Accès par lien signé depuis le chat, sans mot de passe.
- **ART-2** Tableau de bord : documents du mois, devis en attente, montants facturés.
- **ART-3** Documents : liste, filtres, aperçu, actions (envoyer, convertir, dupliquer, réviser).
- **ART-4** Clients.
- **ART-5** Profil et en-tête : nom, métier, pays, coordonnées, identifiants légaux, logo, couleur,
  modèle, moyens de paiement, mentions.
- **ART-6** Abonnement : offre, quota, historique, paiement.
- **ART-7** Page publique du document pour le client de l'artisan : consultation, téléchargement,
  acceptation ou refus.

### Offre (OFF)
- **OFF-1** Essai gratuit (3 documents émis), puis abonnement mensuel avec quota ; valeurs
  versionnées par pays et devise.
- **OFF-2** Consommation : seule l'émission d'un document final consomme ; corrections et versions
  du même document sont gratuites. Avertissement à 80 %.
- **OFF-3** Paiement de l'abonnement par un `PaymentProvider` (simulateur hors production, Moneroo).

### Administration (ADM)
- **ADM-1** Connexion Neon Auth, rôles `admin` et `support`, journal d'audit.
- **ADM-2** Tableau de bord : organisations actives, documents émis, conversion devis → facture,
  fidélité de lecture, coût IA, revenus.
- **ADM-3** Organisations : liste, fiche, documents, abonnement, suspension.
- **ADM-4** Console des conversations : messages reçus, traitements, durées, erreurs, relance.
- **ADM-5** Configuration : pays, devises, taxes, métiers, types de documents, modèles, offres,
  modèles d'IA, canaux, drapeaux.
- **ADM-6** Simulateur de chat pour tester tout le parcours sans WhatsApp.
- **ADM-7** Coûts IA et santé des services.

## 5. Hors périmètre

Encaissement pour le compte de l'artisan, comptabilité, stock, paie, bibliothèque automatique de
prix, équipes multi-utilisateurs, attestations d'activité (plus tard, avec consentement).

## 6. L'indicateur qui décide

Un artisan émet et partage lui-même un document à un vrai client, sans aide, dans la semaine qui
suit son premier message (`document_shared`).
