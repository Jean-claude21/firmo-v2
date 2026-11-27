# Roadmap — Firmo

> État réel du projet. Chaque spec terminée est cochée et datée.
> Parité avec la v1 exigée par le porteur le 2026-11-14 : `PARITE_V1.md` (liste vérifiable).
> Hypothèses produit : considérées validées par le porteur le 2026-11-14 (voir `HYPOTHESES.md`).

| Spec | Contenu | Fonctionnalités | État |
|---|---|---|---|
| 001-socle | Dépôt, outillage base (migrations, pgTAP), référentiels, organisations, identités, équipe, audit, file de tâches, liens, API Hono + worker, CI, Neon staging | CH-2, CH-5, ADM-1, ADM-5 (données) | ✅ 2026-11-14 |
| 002-documents | Modèle documentaire en SQL : lignes, totaux, taxes, numérotation, transitions, paiements notés, reçus, essai et quotas | DOC-3, DOC-4, DOC-6, DOC-7, OFF-1 (essai), OFF-2 | ✅ 2026-11-14 |
| 003-rendu | Typst : trois modèles, PDF, SVG, PNG, QR, montant en lettres, cas difficiles, rendu à l'émission | DOC-5, DOC-8 | ✅ 2026-11-14 |
| 004-conversation | Canaux (simulateur, Telegram, WhatsApp), IA (transcription, lecture, intentions), garde anti-invention, moteur de conversation, voix | CH-1, CH-3, CH-4, CH-5, DOC-1, DOC-2 | ✅ 2026-11-14 |
| 005-espace-artisan | Web : site, lien signé, tableau de bord, documents, clients, profil, formulaires, page publique | ART-1 à ART-5, ART-7, CH-4 | ✅ 2026-11-14 |
| 006-offre | Essai, abonnement, quota, paiement (simulateur, Moneroo) | OFF-1, OFF-3, ART-6 | ✅ 2026-11-14 |
| 007-administration | Console : tableau de bord, organisations, conversations, configuration, simulateur, coûts | ADM-1 à ADM-7 | ✅ 2026-11-14 |
| 008-mise-en-ligne | Staging Neon + Coolify (https://firmo-staging.kete.digital), image unique, Doppler, documentation d'exploitation | IX | ✅ staging 2026-11-14 · production à ouvrir |
| 009-document-v1 | Parité v1 du document et du PDF : sections, ajustements, acompte, champs latents, clauses, numérotation configurable, numéro manuel, révisions /R2, conversion, duplication, consultations ; gabarit validé de la v1, dix cas de référence | PARITE_V1 P-01 à P-27, P-43 | ✅ 2026-11-14 |
| 010-conversation-v1 | Parité v1 du chat : intentions, corrections sur tout le document avec preuve, contexte de 12 échanges, messages de la voix v1, aperçu filigrané, évaluation de dialogues | PARITE_V1 P-30 à P-42 | ✅ 2026-11-14 |
| 011-offre-v1 | Offre v1 (15 documents par mois), recharges, alerte à 80 %, versions d'offre, périodes, grâce, conditions de fin (Struo), Chariow, rapprochement, file de confirmation | PARITE_V1 P-50 à P-57 | ✅ 2026-11-26 · Chariow réel à brancher |
| 012-web-v1 | Système de design v1, accueil, éditeur complet, présentation avec aperçu en direct, abonnement, pages légales, Formats, liens réutilisables, landing | PARITE_V1 P-60 à P-69 | ✅ 2026-11-26 |
| 013-admin-v1 | Centre de commande, incidents, organisation et support, listes, actions sensibles sur motif, montants sur motif, accès « ADMIN » par le chat, recherche, pilotage | PARITE_V1 P-70 à P-78 | ✅ 2026-11-26 |
| 014-mesure-v1 | Relais des événements sans donnée personnelle, rétention des médias, export, suppression sur demande | PARITE_V1 P-80 à P-83 | ✅ 2026-11-26 |
| 015-lancement | Lancement en Afrique : pays européens retirés, mention « non assujetti à la TVA », aucun suivi des paiements clients (décision 0008), Chariow dans la console, avis WhatsApp hors fenêtre, changement de numéro, Umami, Sentry, pages légales Kete | DOC-3, DOC-6, OFF-3, ADM-2, IX | ✅ 2026-11-27 · staging déployé ; produit Chariow et modèle Meta à poser |

## Ce que le porteur doit fournir (hors code)

- Entreprise au Togo (RCCM, NIF) → vérification Meta → nom « Firmo » et WhatsApp Flows.
- Numéro de téléphone dédié à Firmo.
- Bot Telegram (BotFather) pour les essais réels immédiats.
- Compte Moneroo de l'entreprise pour l'abonnement.
- Clé d'API et secret « pulse » Chariow de Firmo ; prix d'une recharge (jamais fixé dans la v1).
- Clé OpenAI avec crédit (celle de développement est épuisée).
- Modèle WhatsApp `firmo_avis` à faire approuver chez Meta (texte dans `docs/OPERATIONS.md`).
